import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, win32, posix } from "node:path";
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
  "missing" | "timeout" | "command" | "parse" | "empty";

export class OpenCodeError extends Error {
  constructor(
    message: string,
    public kind: OpenCodeFailure,
    /**
     * Content-free shape counters as a ready-to-quote string, set when the
     * failure came from a parser. Carried structurally rather than left inside
     * the message so CI can report them without printing diagnostics.
     */
    public fingerprint?: string,
    /**
     * Set when the 2.x surface also failed, so both listing surfaces' outcomes
     * are readable without parsing the message.
     */
    public fallbackKind?: OpenCodeFailure,
  ) {
    super(message);
  }
}

/**
 * Content-free fingerprint of `opencode models --verbose` output: block and
 * field-presence counters only, never ids, names, rates, or paths. Safe to
 * paste into an issue alongside the CLI version.
 */
export interface OpenCodeSchemaFingerprint {
  version: 1;
  blocks: number;
  jsonFailures: number;
  missingId: number;
  missingProvider: number;
  missingName: number;
  invalidProvider: number;
}
export function fingerprintOpenCodeOutput(
  output: unknown,
): OpenCodeSchemaFingerprint {
  const empty: OpenCodeSchemaFingerprint = {
    version: 1,
    blocks: 0,
    jsonFailures: 0,
    missingId: 0,
    missingProvider: 0,
    missingName: 0,
    invalidProvider: 0,
  };
  if (typeof output !== "string") return empty;
  let blocks: { ref: string; body: string }[];
  try {
    blocks = splitBlocks(output);
  } catch {
    // A fingerprint is a diagnostic and must be computable from inside the
    // parser's own failure path, so it never rethrows. `splitBlocks` failing
    // means the blocks were unreadable, which the caller reports separately.
    return { ...empty, jsonFailures: 1 };
  }
  const fp: OpenCodeSchemaFingerprint = { ...empty, blocks: blocks.length };
  for (const { body } of blocks) {
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      fp.jsonFailures++;
      continue;
    }
    if (!object(raw)) {
      fp.jsonFailures++;
      continue;
    }
    if (!str(raw.id)) fp.missingId++;
    if (!str(raw.providerID, 100)) fp.missingProvider++;
    else if (!/^[\w\-.]+$/.test(raw.providerID as string))
      fp.invalidProvider++;
    if (!str(raw.name)) fp.missingName++;
  }
  return fp;
}
export const formatOpenCodeFingerprint = (
  fp: OpenCodeSchemaFingerprint,
): string =>
  `schema v1 blocks=${fp.blocks} jsonFailures=${fp.jsonFailures} missingId=${fp.missingId} missingProvider=${fp.missingProvider} missingName=${fp.missingName} invalidProvider=${fp.invalidProvider}`;

/**
 * Validate `opencode --version` output. Returns the dotted version without a
 * leading `v` (e.g. "1.18.30"), or undefined when unrecognized. Bounded and
 * value-only: no paths, environment, or model data cross this boundary.
 */
export function parseOpenCodeVersion(output: unknown): string | undefined {
  if (typeof output !== "string") return undefined;
  // 1.x prints a bare `1.18.30`; 2.x prints `opencode v2.0.16`. Take the first
  // version-shaped token rather than assuming a position, so a v2 failure is
  // still attributed to the version that produced it.
  for (const token of output.trim().split(/\s+/).slice(0, 10)) {
    if (!token || token.length > 50) continue;
    const match = token.match(/^v?(\d+\.\d+\.\d+[A-Za-z0-9.\-+]*)$/);
    if (match) return match[1].slice(0, 50);
  }
  return undefined;
}
const openCodeVersionLabel = (version: string | undefined): string =>
  version ? `OpenCode CLI ${version}` : "OpenCode CLI (version unavailable)";
const withOpenCodeVersion = (
  message: string,
  version: string | undefined,
): string => `${message} (${openCodeVersionLabel(version)}.)`;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const money = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const variantKey = (v: string): boolean =>
  /^[A-Za-z0-9][\w\-.]*$/.test(v) && v.length <= 100;
const isEnoent = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT" ||
  (error instanceof Error && /ENOENT/i.test(error.message));

/** A model family, falling back to the bare model id when absent or unusable. */
const familyOf = (raw: unknown, modelId: string): string =>
  typeof raw === "string" && raw.length > 0 && raw.length <= 200
    ? raw
    : modelId;

/** The widest input a model accepts: `limit.input`, else `limit.context`. */
function maxInputOf(limit: unknown): number {
  if (!object(limit)) return 0;
  for (const key of ["input", "context"] as const) {
    const value = limit[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      return value;
  }
  return 0;
}

/** The four disjoint token buckets of one rate entry, or undefined if any is unusable. */
function baseRates(raw: unknown): Rates | undefined {
  if (!object(raw)) return undefined;
  const cache = object(raw.cache) ? raw.cache : undefined;
  if (
    !money(raw.input) ||
    !money(raw.output) ||
    !cache ||
    !money(cache.read) ||
    !money(cache.write)
  )
    return undefined;
  const write = cache.write as number;
  return {
    input: raw.input as number,
    read: cache.read as number,
    write: write === 0 ? null : write,
    output: raw.output as number,
  };
}

/** True only when every bucket is a real, observed zero. */
function zeroCostEntry(raw: unknown): boolean {
  const rates = baseRates(raw);
  // `baseRates` normalizes a zero write rate to null (it then falls back to the
  // input rate), so a null write is the raw zero; a real write price is kept.
  return (
    !!rates &&
    rates.input === 0 &&
    rates.output === 0 &&
    rates.read === 0 &&
    rates.write === null
  );
}

interface CostFields {
  rates?: Rates;
  long?: { threshold: number; rates: Rates };
  freeTier?: boolean;
  note?: string;
}

/**
 * Resolve one base rate entry plus its long-context tier candidates into the
 * pricing a row carries. Shared by both listing surfaces so a zero rate, a
 * missing bucket, and a tier are interpreted identically on 1.x and 2.x.
 */
function priceEntry(
  base: unknown,
  tiers: unknown[],
  providerID: string,
): CostFields {
  const rates = baseRates(base);
  if (!rates) return { note: "Unrecognized cost shape; pricing unavailable." };
  // Zero cost is a documented free tier only on the Zen gateway. Anywhere else
  // it means the provider bills directly, so the model is unpriced (BYOK).
  if (zeroCostEntry(base))
    return zenGatewayProviders.includes(providerID)
      ? { freeTier: true, rates: { input: 0, read: 0, write: null, output: 0 } }
      : {};
  let long: { threshold: number; rates: Rates } | undefined;
  for (const tier of tiers) {
    const parsed = tierRates(tier);
    if (parsed) {
      long = parsed;
      break;
    }
  }
  return {
    rates,
    ...(long ? { long } : {}),
    ...(tiers.length && !long
      ? { note: "Unrecognized pricing tier; using base rates." }
      : {}),
  };
}

/** One normalized model, independent of which listing surface reported it. */
interface ModelFields {
  providerID: string;
  modelId: string;
  name: string;
  family: string;
  maxInputTokens: number;
  variants: string[];
  cost: CostFields;
}

/**
 * Append one model, expanding its thinking levels into one row each. Only the
 * whitelisted fields of `ModelFields` are ever copied onto a row, so a raw
 * provider config (keys, headers, request bodies) cannot cross this boundary.
 */
function pushModel(
  models: AvailableModel[],
  seen: Set<string>,
  f: ModelFields,
): void {
  const baseRef = `${f.providerID}/${f.modelId}`;
  const push = (id: string, display: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    models.push({
      id,
      name: display,
      family: f.family,
      maxInputTokens: f.maxInputTokens,
      source: "opencode",
      ...(f.cost.rates ? { rates: { ...f.cost.rates } } : {}),
      ...(f.cost.long
        ? {
            long: {
              threshold: f.cost.long.threshold,
              rates: { ...f.cost.long.rates },
            },
          }
        : {}),
      ...(f.cost.freeTier ? { freeTier: true } : {}),
      ...(f.cost.note ? { pricingNotes: [f.cost.note] } : {}),
    });
  };
  if (!f.variants.length) push(`opencode:${baseRef}`, f.name);
  else
    for (const v of f.variants) push(`opencode:${baseRef}#${v}`, `${f.name} (${v})`);
}

function tierRates(
  raw: unknown,
): { threshold: number; rates: Rates } | undefined {
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
    if (!started || depth !== 0)
      throw new OpenCodeError(
        "OpenCode returned unrecognized model data. Retry; the previous listing is retained.",
        "parse",
      );
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
  const fingerprint = formatOpenCodeFingerprint(
    fingerprintOpenCodeOutput(output),
  );
  const parseFailure = (): OpenCodeError =>
    new OpenCodeError(
      `OpenCode returned unrecognized model data (${fingerprint}). ` +
        "This output doesn't match any known `opencode models --verbose` schema — " +
        "please file an issue with the fingerprint and your OpenCode CLI version (`opencode --version`). " +
        "Retry; the previous listing is retained.",
      "parse",
      fingerprint,
    );
  if (typeof output !== "string") throw parseFailure();
  if (output.trim() === "") return [];
  let blocks: { ref: string; body: string }[];
  try {
    blocks = splitBlocks(output);
  } catch (error) {
    // Unbalanced braces: report it through the same fingerprinted path as every
    // other unrecognized shape, so this failure mode carries counters too.
    if (error instanceof OpenCodeError && error.kind === "parse")
      throw new OpenCodeError(`${error.message} (${fingerprint})`, "parse", fingerprint);
    throw error;
  }
  if (!blocks.length) throw parseFailure();
  const models: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const { body } of blocks) {
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      throw parseFailure();
    }
    if (
      !object(raw) ||
      !str(raw.id) ||
      !str(raw.providerID, 100) ||
      !str(raw.name)
    )
      continue;
    if (!/^[\w\-.]+$/.test(raw.providerID)) continue;
    const cost = object(raw.cost) ? raw.cost : undefined;
    // Pricing from live CLI cost fields (dynamic; no static OpenCode price catalog).
    pushModel(models, seen, {
      providerID: raw.providerID,
      modelId: raw.id,
      name: raw.name,
      family: familyOf(raw.family, raw.id),
      maxInputTokens: maxInputOf(raw.limit),
      variants: object(raw.variants) && !Array.isArray(raw.variants)
        ? Object.keys(raw.variants).filter(variantKey)
        : [],
      cost: priceEntry(
        cost,
        cost && Array.isArray(cost.tiers) ? cost.tiers : [],
        raw.providerID,
      ),
    });
  }
  return models;
}

/**
 * Content-free fingerprint of an `opencode api model.list` response: record and
 * field-presence counters only, never ids, names, rates, or headers. `envelope`
 * separates "this was not our shape at all" — a 1.x binary rejecting the
 * subcommand, or a background service that had not finished starting — from a
 * genuine listing of zero models, which must never be reported as a parse
 * failure or as "no models connected".
 */
export interface OpenCodeListFingerprint {
  version: 1;
  envelope: boolean;
  records: number;
  jsonFailures: number;
  missingId: number;
  missingProvider: number;
  missingName: number;
  invalidProvider: number;
}
export function fingerprintModelList(payload: unknown): OpenCodeListFingerprint {
  const empty: OpenCodeListFingerprint = {
    version: 1,
    envelope: false,
    records: 0,
    jsonFailures: 0,
    missingId: 0,
    missingProvider: 0,
    missingName: 0,
    invalidProvider: 0,
  };
  if (typeof payload !== "string") return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return empty;
  }
  if (!object(raw) || !Array.isArray(raw.data)) return { ...empty, envelope: true };
  const fp: OpenCodeListFingerprint = { ...empty, records: raw.data.length };
  for (const entry of raw.data) {
    if (!object(entry)) {
      fp.jsonFailures++;
      continue;
    }
    if (!str(entry.modelID)) fp.missingId++;
    if (!str(entry.providerID, 100)) fp.missingProvider++;
    else if (!/^[\w\-.]+$/.test(entry.providerID as string)) fp.invalidProvider++;
    if (!str(entry.name)) fp.missingName++;
  }
  return fp;
}
export const formatModelListFingerprint = (
  fp: OpenCodeListFingerprint,
): string =>
  `list schema v1 envelope=${fp.envelope} records=${fp.records} jsonFailures=${fp.jsonFailures} missingId=${fp.missingId} missingProvider=${fp.missingProvider} missingName=${fp.missingName} invalidProvider=${fp.invalidProvider}`;

/**
 * Parse an `opencode api model.list` response (OpenCode 2.x) into namespaced
 * models. 2.x dropped `models --verbose` but carries the same identity, limits,
 * per-million rates, long-context tiers, and variants in `Model.Info` — with
 * `cost` and `variants` as arrays rather than 1.x's nested object. Only
 * whitelisted fields cross the boundary; `settings`, `headers`, `body`,
 * `package`, and `compatibility` are read by neither path.
 */
export function parseModelList(payload: unknown): AvailableModel[] {
  const fingerprint = formatModelListFingerprint(
    fingerprintModelList(payload),
  );
  const failure = (): OpenCodeError =>
    new OpenCodeError(
      `OpenCode returned unrecognized model data (${fingerprint}). ` +
        "This response doesn't match any known `opencode api model.list` schema — " +
        "please file an issue with the fingerprint and your OpenCode CLI version (`opencode --version`). " +
        "Retry; the previous listing is retained.",
      "parse",
      fingerprint,
    );
  if (typeof payload !== "string") throw failure();
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw failure();
  }
  if (!object(raw) || !Array.isArray(raw.data)) throw failure();
  const models: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const entry of raw.data) {
    if (!object(entry)) continue;
    // 2.x `id` is the composed `providerID/modelID`; the bare id is `modelID`.
    if (!str(entry.modelID) || !str(entry.providerID, 100) || !str(entry.name))
      continue;
    if (!/^[\w\-.]+$/.test(entry.providerID)) continue;
    const entries = Array.isArray(entry.cost) ? entry.cost : [];
    const cost: CostFields = !Array.isArray(entry.cost)
      ? { note: "Unrecognized cost shape; pricing unavailable." }
      : entries.length === 0
        ? { note: "No published rates; supply a BYOK rate." }
        : priceEntry(
            entries.find((c) => object(c) && c.tier === undefined),
            entries.filter((c) => object(c) && c.tier !== undefined),
            entry.providerID,
          );
    pushModel(models, seen, {
      providerID: entry.providerID,
      modelId: entry.modelID,
      name: entry.name,
      family: familyOf(entry.family, entry.modelID),
      maxInputTokens: maxInputOf(entry.limit),
      variants: Array.isArray(entry.variants)
        ? entry.variants
            .map((v) => (object(v) && str(v.id) ? v.id : ""))
            .filter((v) => variantKey(v))
        : [],
      cost,
    });
  }
  return models;
}

export interface OpenCodeRunResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type OpenCodeRunner = (args: string[]) => Promise<OpenCodeRunResult>;

export function execOnce(
  binary: string,
  args: string[],
  execute: typeof execFile = execFile,
): Promise<OpenCodeRunResult> {
  return new Promise((resolve, reject) => {
    const child = execute(
      binary,
      args,
      { timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            Object.assign(new Error(`ENOENT: ${binary}`), { code: "ENOENT" }),
          );
          return;
        }
        if (error && error.killed) {
          reject(
            new OpenCodeError(
              "OpenCode discovery timed out after 20 seconds. Retry; the previous listing is retained.",
              "timeout",
            ),
          );
          return;
        }
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code ?? 1)
            : error
              ? 1
              : 0;
        resolve({
          code,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
    void child;
  });
}

export function executableCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string[] {
  const paths = platform === "win32" ? win32 : posix;
  const binary = platform === "win32" ? "opencode.exe" : "opencode";
  const pathValue =
    Object.entries(env).find(([key]) =>
      platform === "win32" ? key.toLowerCase() === "path" : key === "PATH",
    )?.[1] ?? "";
  const pathDirs = pathValue
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .map((p) => p.replace(/^"|"$/g, ""));
  // `npm install -g opencode-ai` on Windows only puts .cmd/.ps1 shims on PATH;
  // the real opencode.exe (per that package's "bin" field) sits under
  // <npm prefix>\node_modules\opencode-ai\bin\, i.e. directly under each PATH
  // entry that is itself an npm prefix. Unix npm symlinks a real executable
  // straight into the PATH bin dir, so no extra candidate is needed there.
  const dirCandidates = (dir: string) =>
    platform === "win32"
      ? [
          paths.join(dir, binary),
          paths.join(dir, "node_modules", "opencode-ai", "bin", binary),
        ]
      : [paths.join(dir, binary)];
  return [
    ...new Set([
      ...pathDirs.flatMap(dirCandidates),
      paths.join(home, ".opencode", "bin", binary),
    ]),
  ];
}
export function createOpenCodeRunner(
  config: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    home?: string;
    execute?: typeof execOnce;
  } = {},
): OpenCodeRunner {
  return async (args) => {
    for (const binary of executableCandidates(
      config.platform,
      config.env,
      config.home,
    )) {
      try {
        return await (config.execute ?? execOnce)(binary, args);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
        throw error;
      }
    }
    throw new OpenCodeError(
      "OpenCode CLI not found. Put the native opencode executable on PATH (opencode.exe on Windows, including npm global installs' node_modules\\opencode-ai\\bin\\opencode.exe) or in ~/.opencode/bin, then refresh. Script-only .cmd/.bat/.ps1 shims are unsupported; expose a native executable.",
      "missing",
    );
  };
}
const defaultRunner: OpenCodeRunner = (args) => createOpenCodeRunner()(args);

/** Best-effort `opencode --version` probe; never throws, never blocks discovery. */
export async function getOpenCodeVersion(
  runner: OpenCodeRunner,
): Promise<string | undefined> {
  try {
    const result = await runner(["--version"]);
    if (result.code !== 0) return undefined;
    return parseOpenCodeVersion(result.stdout);
  } catch {
    return undefined;
  }
}

const CLI_MISSING =
  "OpenCode CLI not found. Install OpenCode with the `opencode` binary on PATH (default ~/.opencode/bin/), then refresh.";
const DISCOVERY_FAILED =
  "OpenCode discovery failed. Retry; the previous listing is retained.";
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run one listing surface, mapping spawn/timeout/exit/parse states to guidance. */
async function runSurface(
  runner: OpenCodeRunner,
  args: string[],
  parse: (output: string) => AvailableModel[],
  version: () => Promise<string | undefined>,
): Promise<AvailableModel[]> {
  let result: OpenCodeRunResult;
  try {
    result = await runner(args);
  } catch (error) {
    if (error instanceof OpenCodeError) throw error;
    if (isEnoent(error)) throw new OpenCodeError(CLI_MISSING, "missing");
    throw new OpenCodeError(DISCOVERY_FAILED, "command");
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().slice(0, 200);
    throw new OpenCodeError(
      withOpenCodeVersion(
        `OpenCode discovery failed (exit ${result.code}).${detail ? ` ${detail}` : ""} Retry; the previous listing is retained.`,
        await version(),
      ),
      "command",
    );
  }
  try {
    return parse(result.stdout);
  } catch (error) {
    if (error instanceof OpenCodeError && error.kind === "parse")
      throw new OpenCodeError(
        withOpenCodeVersion(error.message, await version()),
        "parse",
      );
    throw error;
  }
}

/**
 * Discover OpenCode models across both listing surfaces.
 *
 * 1.x exposes `opencode models --verbose`; 2.x removed that flag but exposes
 * `opencode api model.list`, whose OpenAPI `Model.Info` carries the same
 * identity, limits, rates, tiers, and variants. Neither version supports the
 * other's surface, so this tries the 1.x command first — keeping every
 * currently-working install on exactly the path it uses today — and falls back
 * to the 2.x one when the first yields nothing. A missing binary or a timeout
 * is an environment failure rather than a shape change, so it never falls back.
 *
 * When neither surface produces a listing, the first surface's failure is
 * reported, since that is the one we prefer, with the second named alongside it.
 */
export async function discoverOpenCode(
  runner: OpenCodeRunner = defaultRunner,
  config: { retryDelayMs?: number } = {},
): Promise<AvailableModel[]> {
  let probed: string | undefined | null = null;
  const version = async (): Promise<string | undefined> =>
    (probed ??= await getOpenCodeVersion(runner));
  // 0 disables the retry, which keeps the failure path free of timers; the
  // extension host and the smoke script opt into a real delay.
  const retryDelayMs = config.retryDelayMs ?? 0;

  let primary: AvailableModel[] | undefined;
  let primaryError: OpenCodeError | undefined;
  try {
    primary = await runSurface(
      runner,
      ["models", "--verbose"],
      parseModels,
      version,
    );
    if (primary.length) return primary;
  } catch (error) {
    if (!(error instanceof OpenCodeError)) throw error;
    if (error.kind === "missing" || error.kind === "timeout") throw error;
    primaryError = error;
  }

  // 2.x. A background service that has not finished starting answers with an
  // error envelope and a non-zero exit, which is indistinguishable from real
  // drift, so one retry separates the two.
  let fallbackError: OpenCodeError | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      const models = await runSurface(
        runner,
        ["api", "model.list"],
        parseModelList,
        version,
      );
      if (models.length) return models;
      break;
    } catch (error) {
      if (!(error instanceof OpenCodeError)) throw error;
      if (error.kind === "missing") {
        fallbackError = error;
        break;
      }
      if (attempt === 0 && retryDelayMs > 0 && error.kind !== "empty") {
        await delay(retryDelayMs);
        continue;
      }
      fallbackError = error;
      break;
    }
  }

  const base =
    primaryError ??
    new OpenCodeError(
      withOpenCodeVersion(
        "No OpenCode models listed. Connect a provider (`opencode providers login` or /connect), then refresh.",
        await version(),
      ),
      "empty",
    );
  if (!fallbackError) throw base;
  // Both surfaces' outcomes are carried structurally so CI can classify the
  // failure without reading the message.
  throw new OpenCodeError(
    `${base.message} The OpenCode 2.x listing surface also failed (${fallbackError.kind}).`,
    base.kind,
    base.fingerprint ?? fallbackError.fingerprint,
    fallbackError.kind,
  );
}
