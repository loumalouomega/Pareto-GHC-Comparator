import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AvailableModel, Rates } from "./types";

/** Providers whose zero-cost CLI rates mean a documented free tier (Zen gateway). */
export const zenGatewayProviders = ["opencode", "opencode-go"];

/** Explicit benchmark-family aliases keyed by `provider/model` (without source prefix or variant). */
export const opencodeBenchmarkFamilies: Record<string, string[]> = {
  "opencode-go/gpt-5.6-luna": ["GPT-5.6 Luna"],
  "opencode-go/kimi-k2.7-code": ["Kimi K2.7 Code"],
  "opencode-go/kimi-k3": ["Kimi K3"],
  "opencode-go/qwen3.7-max": ["Qwen3.7 Max"],
  "openai/gpt-5.4": ["GPT-5.4"],
};

export type OpenCodeFailure =
  | "missing"
  | "command"
  | "parse"
  | "empty";

export class OpenCodeError extends Error {
  constructor(
    message: string,
    public kind: OpenCodeFailure,
  ) {
    super(message);
  }
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const money = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const variantKey = (v: string): boolean =>
  /^[A-Za-z0-9][\w\-.]*$/.test(v) && v.length <= 100;

function tierRates(raw: unknown): { threshold: number; rates: Rates } | undefined {
  if (!object(raw)) return undefined;
  const cache = object(raw.cache) ? raw.cache : undefined;
  const tier = object(raw.tier) ? raw.tier : undefined;
  if (
    !money(raw.input) ||
    !money(raw.output) ||
    !cache ||
    !money(cache.read) ||
    !money(cache.write) ||
    !tier ||
    tier.type !== "context" ||
    typeof tier.size !== "number" ||
    !Number.isSafeInteger(tier.size) ||
    tier.size <= 0
  )
    return undefined;
  const write = cache.write as number;
  return {
    threshold: tier.size,
    rates: {
      input: raw.input as number,
      read: cache.read as number,
      write: write === 0 ? null : write,
      output: raw.output as number,
    },
  };
}

/** Split `opencode models --verbose` text into (header, body) pairs using brace-aware scanning. */
function splitBlocks(output: string): { ref: string; body: string }[] {
  const lines = output.split("\n");
  const blocks: { ref: string; body: string }[] = [];
  const refPattern = /^[A-Za-z0-9][\w\-.]*\/[\w][\w\-.#]*$/;
  let i = 0;
  while (i < lines.length) {
    const ref = lines[i].trim();
    if (!refPattern.test(ref)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j >= lines.length || !lines[j].includes("{")) {
      i++;
      continue;
    }
    let depth = 0,
      inString = false,
      escaped = false,
      started = false;
    const collected: string[] = [];
    let k = j;
    for (; k < lines.length; k++) {
      const line = lines[k];
      collected.push(line);
      for (const ch of line) {
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") {
          depth++;
          started = true;
        } else if (ch === "}") depth--;
      }
      if (started && depth === 0 && !inString) break;
    }
    if (!started || depth !== 0) throw new OpenCodeError("OpenCode returned unrecognized model data. Retry; the previous listing is retained.", "parse");
    blocks.push({ ref, body: collected.join("\n") });
    i = k + 1;
  }
  return blocks;
}

/**
 * Parse `opencode models --verbose` text into namespaced models.
 * Only whitelisted fields cross the boundary; raw provider configs never do.
 */
export function parseModels(output: unknown): AvailableModel[] {
  if (typeof output !== "string")
    throw new OpenCodeError("OpenCode returned unrecognized model data. Retry; the previous listing is retained.", "parse");
  if (output.trim() === "") return [];
  const blocks = splitBlocks(output);
  if (!blocks.length)
    throw new OpenCodeError("OpenCode returned unrecognized model data. Retry; the previous listing is retained.", "parse");
  const models: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const { body } of blocks) {
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      throw new OpenCodeError("OpenCode returned unrecognized model data. Retry; the previous listing is retained.", "parse");
    }
    if (!object(raw) || !str(raw.id) || !str(raw.providerID, 100) || !str(raw.name)) continue;
    if (!/^[\w\-.]+$/.test(raw.providerID)) continue;
    const providerID = raw.providerID;
    const modelId = raw.id;
    const name = raw.name;
    const family =
      typeof raw.family === "string" && raw.family.length > 0 && raw.family.length <= 200
        ? raw.family
        : modelId;
    const baseRef = `${providerID}/${modelId}`;
    const limit = object(raw.limit) ? raw.limit : {};
    const maxInputTokens =
      (typeof limit.input === "number" && Number.isSafeInteger(limit.input) && limit.input >= 0
        ? limit.input
        : typeof limit.context === "number" && Number.isSafeInteger(limit.context) && limit.context >= 0
          ? limit.context
          : 0);
    // Pricing from live CLI cost fields (dynamic; no static OpenCode price catalog).
    let rates: Rates | undefined;
    let long: { threshold: number; rates: Rates } | undefined;
    let freeTier = false;
    const pricingNotes: string[] = [];
    const cost = object(raw.cost) ? raw.cost : undefined;
    const cache = cost && object(cost.cache) ? cost.cache : undefined;
    if (
      cost &&
      money(cost.input) &&
      money(cost.output) &&
      cache &&
      money(cache.read) &&
      money(cache.write)
    ) {
      const write = cache.write as number;
      if (cost.input === 0 && cost.output === 0 && cache.read === 0 && write === 0) {
        if (zenGatewayProviders.includes(providerID)) {
          freeTier = true;
          rates = { input: 0, read: 0, write: null, output: 0 };
        } else {
          rates = undefined; // BYOK: zero means unpriced, not free.
        }
      } else {
        rates = {
          input: cost.input as number,
          read: cache.read as number,
          write: write === 0 ? null : write,
          output: cost.output as number,
        };
        const tiers = Array.isArray(cost.tiers) ? cost.tiers : [];
        for (const t of tiers) {
          const parsed = tierRates(t);
          if (parsed) {
            long = parsed;
            break;
          }
        }
        if (tiers.length && !long)
          pricingNotes.push("Unrecognized pricing tier; using base rates.");
      }
    } else {
      pricingNotes.push("Unrecognized cost shape; pricing unavailable.");
    }
    const variants =
      object(raw.variants) && !Array.isArray(raw.variants) ? raw.variants : {};
    const names = Object.keys(variants).filter(variantKey);
    const push = (id: string, display: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      models.push({
        id,
        name: display,
        family,
        maxInputTokens,
        source: "opencode",
        ...(rates ? { rates: { ...rates } } : {}),
        ...(long ? { long: { threshold: long.threshold, rates: { ...long.rates } } } : {}),
        ...(freeTier ? { freeTier: true } : {}),
        ...(pricingNotes.length ? { pricingNotes: [...pricingNotes] } : {}),
      });
    };
    if (!names.length) {
      push(`opencode:${baseRef}`, name);
    } else {
      for (const v of names) push(`opencode:${baseRef}#${v}`, `${name} (${v})`);
    }
  }
  return models;
}

export interface OpenCodeRunResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type OpenCodeRunner = (args: string[]) => Promise<OpenCodeRunResult>;

function execOnce(binary: string, args: string[]): Promise<OpenCodeRunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout: 20000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(Object.assign(new Error(`ENOENT: ${binary}`), { code: "ENOENT" }));
        return;
      }
      const code =
        error && typeof (error as { code?: unknown }).code === "number"
          ? ((error as { code: number }).code ?? 1)
          : error
            ? 1
            : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
    void child;
  });
}

function defaultRunner(args: string[]): Promise<OpenCodeRunResult> {
  const fallback = join(homedir(), ".opencode", "bin", "opencode");
  return (async () => {
    for (const binary of ["opencode", fallback]) {
      try {
        return await execOnce(binary, args);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
        throw error;
      }
    }
    throw new OpenCodeError(
      "OpenCode CLI not found. Install OpenCode 1.18.30 or newer with the `opencode` binary on PATH (default ~/.opencode/bin/), then refresh.",
      "missing",
    );
  })();
}

/** Run discovery and parse the listing; throws OpenCodeError with actionable messages. */
export async function discoverOpenCode(
  runner: OpenCodeRunner = defaultRunner,
): Promise<AvailableModel[]> {
  let result: OpenCodeRunResult;
  try {
    result = await runner(["models", "--verbose"]);
  } catch (error) {
    if (error instanceof OpenCodeError) throw error;
    if (
      (error as NodeJS.ErrnoException)?.code === "ENOENT" ||
      (error instanceof Error && /ENOENT/i.test(error.message))
    )
      throw new OpenCodeError(
        "OpenCode CLI not found. Install OpenCode 1.18.30 or newer with the `opencode` binary on PATH (default ~/.opencode/bin/), then refresh.",
        "missing",
      );
    throw new OpenCodeError(
      "OpenCode discovery failed. Retry; the previous listing is retained.",
      "command",
    );
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().slice(0, 200);
    throw new OpenCodeError(
      `OpenCode discovery failed (exit ${result.code}).${detail ? ` ${detail}` : ""} Retry; the previous listing is retained.`,
      "command",
    );
  }
  const models = parseModels(result.stdout);
  if (!models.length)
    throw new OpenCodeError(
      "No OpenCode models listed. Connect a provider (`opencode providers login` or /connect), then refresh.",
      "empty",
    );
  return models;
}
