import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { usageMultiplier } from "./usageMultipliers";
import { estimate } from "./compare";
import { catalog } from "./catalog";
import {
  defaults,
  type Billing,
  type BudgetSuggestion,
  type CatalogEntry,
  type UsageDayStat,
  type UsageModelStat,
  type UsageRequest,
  type UsageSummary,
  type UsageWorkspaceStat,
} from "./types";
export const usageParserVersion = 1;
export interface UsageCandidate {
  workspaceId: string;
  workspacePath: string;
  filePath: string;
  size: number;
  mtime: number;
  legacy: boolean;
}
export function storageCandidates(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  let base: string;
  if (platform === "win32") base = env.APPDATA || join(homedir(), "AppData", "Roaming");
  else if (platform === "darwin") base = join(homedir(), "Library", "Application Support");
  else base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return [join(base, "Code", "User", "workspaceStorage"), join(base, "Code - Insiders", "User", "workspaceStorage")];
}
export function uriToPath(uri: string, storageRoot: string): string {
  if (uri.startsWith("file://")) {
    const decoded = decodeURIComponent(uri.slice("file://".length));
    return decoded.replace(/^\/([a-zA-Z]:)/, "$1");
  }
  if (uri.startsWith("vscode-userdata:///")) {
    const rel = decodeURIComponent(uri.slice("vscode-userdata:///".length));
    const parts = storageRoot.split(/[/\\]/);
    const base = parts.slice(0, Math.max(0, parts.length - 3)).join("/") || "/";
    return `${base}/${rel}`;
  }
  return decodeURIComponent(uri);
}
async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}
export async function resolveWorkspace(
  dir: string,
  storageRoot: string,
): Promise<{ id: string; path: string }> {
  const id = basename(dir);
  const raw = await readJson(join(dir, "workspace.json"));
  if (!raw || typeof raw !== "object") return { id, path: "" };
  const data = raw as Record<string, unknown>;
  const folder = typeof data.folder === "string" ? data.folder : "";
  const workspace = typeof data.workspace === "string" ? data.workspace : "";
  if (!folder && !workspace) return { id, path: "" };
  if (!workspace && folder) return { id, path: uriToPath(folder, storageRoot) };
  const resolved = uriToPath(workspace || folder, storageRoot);
  try {
    const ws = await readJson(resolved);
    if (ws && typeof ws === "object") {
      const folders = (ws as Record<string, unknown>).folders;
      if (Array.isArray(folders)) {
        const paths = folders
          .map((f) => {
            if (!f || typeof f !== "object") return "";
            const rec = f as Record<string, unknown>;
            const ref = typeof rec.uri === "string" ? rec.uri : typeof rec.path === "string" ? rec.path : "";
            if (!ref) return "";
            const p = uriToPath(ref, storageRoot);
            return ref.startsWith("file:///") || ref.includes("://") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)
              ? p
              : join(dirname(resolved), p);
          })
          .filter(Boolean);
        if (paths.length) return { id, path: paths.join("; ") };
      }
    }
  } catch {
    // Fall through to the raw workspace URI.
  }
  return { id, path: resolved };
}
export async function discoverUsageFiles(
  roots: string[] = storageCandidates(),
): Promise<UsageCandidate[]> {
  const out: UsageCandidate[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    let dirs: string[];
    try {
      dirs = await readdir(root);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const dirPath = join(root, dir);
      let entries: string[];
      try {
        entries = await readdir(join(dirPath, "chatSessions"));
      } catch {
        continue;
      }
      const { path: workspacePath } = await resolveWorkspace(dirPath, root);
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl") && !entry.endsWith(".json")) continue;
        const filePath = join(dirPath, "chatSessions", entry);
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const s = await stat(filePath);
          if (!s.isFile()) continue;
          out.push({
            workspaceId: dir,
            workspacePath,
            filePath,
            size: s.size,
            mtime: s.mtimeMs,
            legacy: entry.endsWith(".json"),
          });
        } catch {
          // Unreadable files are skipped, never fatal.
        }
      }
    }
  }
  return out;
}
export interface UsageIndex {
  version: 1;
  files: Record<string, { size: number; mtime: number; parser: number }>;
}
export function blankUsageIndex(): UsageIndex {
  return { version: 1, files: {} };
}
export interface StoredUsageFile {
  version: 1;
  scannedAt: number;
  index: UsageIndex;
  files: Record<
    string,
    { workspaceId: string; workspacePath: string; requests: UsageRequest[] }
  >;
}
export function validUsageFile(v: unknown): v is StoredUsageFile {
  if (!recordOf(v) || v.version !== 1) return false;
  if (typeof v.scannedAt !== "number" || !Number.isFinite(v.scannedAt)) return false;
  const index = v.index;
  if (!recordOf(index) || !recordOf(index.files)) return false;
  for (const entry of Object.values(index.files)) {
    if (
      !recordOf(entry) ||
      typeof entry.size !== "number" ||
      typeof entry.mtime !== "number" ||
      typeof entry.parser !== "number"
    )
      return false;
  }
  if (!recordOf(v.files)) return false;
  for (const file of Object.values(v.files)) {
    if (!recordOf(file) || !Array.isArray(file.requests)) return false;
    for (const r of file.requests) {
      if (
        !recordOf(r) ||
        typeof r.promptTokens !== "number" ||
        typeof r.outputTokens !== "number"
      )
        return false;
    }
  }
  return true;
}
export function selectChangedFiles(
  candidates: UsageCandidate[],
  index: UsageIndex,
): { changed: UsageCandidate[]; deleted: string[] } {
  const current = new Set(candidates.map((c) => c.filePath));
  const changed = candidates.filter((c) => {
    const prev = index.files[c.filePath];
    return (
      !prev ||
      prev.parser !== usageParserVersion ||
      prev.size !== c.size ||
      Math.abs(prev.mtime - c.mtime) > 0.001
    );
  });
  const deleted = Object.keys(index.files).filter((p) => !current.has(p));
  return { changed, deleted };
}
const recordOf = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const numOr = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
function normaliseResolvedModel(raw: string): string | null {
  if (!raw) return null;
  return `copilot/${raw.replace(/(-\d+)-(\d+)$/, "$1.$2")}`;
}
export interface ParsedUsageFile {
  anchor: { sessionId: string; creationDate?: number; modelId?: string };
  requests: UsageRequest[];
}
export function parseUsageJsonl(
  text: string,
  workspaceId: string,
  fileStem: string,
): ParsedUsageFile {
  let sessionId = fileStem;
  let creationDate: number | undefined;
  let anchorModel: string | undefined;
  const appends = new Map<number, { modelId?: string; requestId?: string; timestamp?: number }>();
  const results: { index: number; value: Record<string, unknown> }[] = [];
  let nextIndex = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!recordOf(obj)) continue;
    const kind = obj.kind;
    const v = recordOf(obj.v) ? obj.v : recordOf(obj) ? obj : undefined;
    if (kind === 0 && v) {
      if (typeof v.sessionId === "string" && v.sessionId) sessionId = v.sessionId;
      const cd = numOr(v.creationDate);
      if (cd !== undefined) creationDate = cd;
      const inputState = recordOf(v.inputState) ? v.inputState : undefined;
      const selected = inputState && recordOf(inputState.selectedModel) ? inputState.selectedModel : undefined;
      if (selected && typeof selected.identifier === "string") anchorModel = selected.identifier;
    } else if (kind === 2 && Array.isArray(obj.k) && obj.k.length === 1 && obj.k[0] === "requests" && Array.isArray(obj.v)) {
      for (const item of obj.v) {
        if (!recordOf(item)) {
          nextIndex++;
          continue;
        }
        appends.set(nextIndex, {
          modelId: typeof item.modelId === "string" ? item.modelId : undefined,
          requestId: typeof item.requestId === "string" ? item.requestId : undefined,
          timestamp: numOr(item.timestamp),
        });
        nextIndex++;
      }
    } else if (
      kind === 1 &&
      Array.isArray(obj.k) &&
      obj.k.length === 3 &&
      obj.k[0] === "requests" &&
      typeof obj.k[1] === "number" &&
      obj.k[2] === "result" &&
      recordOf(obj.v)
    ) {
      results.push({ index: obj.k[1] as number, value: obj.v });
    }
  }
  const requests: UsageRequest[] = results.map(({ index, value }) => {
    const md = recordOf(value.metadata) ? value.metadata : {};
    const usage = recordOf(value.usage) ? value.usage : {};
    const promptTokens = numOr(md.promptTokens) || numOr(usage.promptTokens) || 0;
    const outputTokens = numOr(md.outputTokens) || numOr(usage.completionTokens) || 0;
    const timings = recordOf(value.timings) ? value.timings : {};
    const rounds = Array.isArray(md.toolCallRounds) ? md.toolCallRounds : [];
    const firstRound = rounds.length > 0 && recordOf(rounds[0]) ? (rounds[0] as Record<string, unknown>) : {};
    const append = appends.get(index) ?? {};
    const resolved = typeof md.resolvedModel === "string" ? normaliseResolvedModel(md.resolvedModel) : null;
    return {
      sessionId,
      workspaceId,
      requestIndex: index,
      requestId: append.requestId,
      modelId:
        (typeof md.modelId === "string" && md.modelId) ||
        resolved ||
        append.modelId ||
        anchorModel ||
        null,
      timestampMs:
        numOr(timings.requestSent) ??
        numOr(timings.firstTokenReceived) ??
        numOr(firstRound.timestamp) ??
        append.timestamp ??
        creationDate ??
        null,
      promptTokens,
      outputTokens,
      toolCallRounds: rounds.length,
      tokensEstimated: false,
    };
  });
  return { anchor: { sessionId, creationDate, modelId: anchorModel }, requests };
}
function legacyText(value: unknown): string {
  if (typeof value === "string") return value;
  if (recordOf(value) && typeof value.content === "string") return value.content;
  return "";
}
export function parseUsageLegacyJson(
  text: string,
  workspaceId: string,
  fileStem: string,
): ParsedUsageFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { anchor: { sessionId: fileStem }, requests: [] };
  }
  if (!recordOf(parsed)) return { anchor: { sessionId: fileStem }, requests: [] };
  const sessionId = typeof parsed.sessionId === "string" && parsed.sessionId ? parsed.sessionId : fileStem;
  const creationDate = numOr(parsed.creationDate);
  const selected = recordOf(parsed.selectedModel) ? parsed.selectedModel : {};
  const anchorModel =
    typeof selected.id === "string" ? selected.id : typeof selected.identifier === "string" ? selected.identifier : undefined;
  const list = Array.isArray(parsed.requests) ? parsed.requests : [];
  const requests: UsageRequest[] = [];
  list.forEach((item, index) => {
    if (!recordOf(item)) return;
    const message = recordOf(item.message) ? item.message : {};
    const variables =
      recordOf(item.variableData) && Array.isArray(item.variableData.variables) ? item.variableData.variables : [];
    const promptText = [typeof message.text === "string" ? message.text : ""]
      .concat(variables.map((x) => (recordOf(x) && typeof x.value === "string" ? x.value : "")))
      .join("\n");
    const response = item.response;
    const result = recordOf(response) && recordOf(response.result) ? response.result : {};
    const md = recordOf(result.metadata) ? result.metadata : {};
    const usage = recordOf(result.usage) ? result.usage : {};
    let promptTokens = numOr(md.promptTokens) || numOr(usage.promptTokens) || 0;
    let outputTokens = numOr(md.outputTokens) || numOr(usage.completionTokens) || 0;
    let tokensEstimated = false;
    if (!promptTokens || !outputTokens) {
      const respText = Array.isArray(response)
        ? response.map(legacyText).join("\n")
        : typeof result.value === "string"
          ? result.value
          : "";
      if (!promptTokens && promptText.trim()) {
        promptTokens = Math.max(1, Math.floor(promptText.length / 4));
        tokensEstimated = true;
      }
      if (!outputTokens && respText.trim()) {
        outputTokens = Math.max(1, Math.floor(respText.length / 4));
        tokensEstimated = true;
      }
    }
    const rounds = Array.isArray(md.toolCallRounds) ? md.toolCallRounds : [];
    const timings = recordOf(result.timings) ? result.timings : {};
    requests.push({
      sessionId,
      workspaceId,
      requestIndex: index,
      modelId: (typeof md.modelId === "string" && md.modelId) || anchorModel || null,
      timestampMs: numOr(timings.requestSent) ?? numOr(timings.firstTokenReceived) ?? creationDate ?? null,
      promptTokens,
      outputTokens,
      toolCallRounds: rounds.length,
      tokensEstimated,
    });
  });
  return { anchor: { sessionId, creationDate, modelId: anchorModel }, requests };
}
export function premiumForRequest(request: UsageRequest): { value: number; estimated: boolean } {
  if (request.promptTokens + request.outputTokens <= 0) return { value: 0, estimated: false };
  const auto = request.modelId === "copilot/auto";
  return usageMultiplier(request.modelId, request.timestampMs, auto);
}
function dayOf(timestampMs: number | null | undefined): string | null {
  if (timestampMs === null || timestampMs === undefined) return null;
  return new Date(timestampMs).toISOString().slice(0, 10);
}
function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.min(100000000, Math.max(0, Math.round(median)));
}
function quantileOf(values: number[], q: number): number | null {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!positive.length) return null;
  return positive[Math.min(positive.length - 1, Math.ceil(q * positive.length) - 1)];
}
function stripCopilotPrefix(modelId: string | null): string | null {
  if (!modelId) return null;
  return modelId.startsWith("copilot/") ? modelId.slice("copilot/".length) : modelId;
}
export function normalizeUsageModelId(modelId: string | null): string | null {
  return stripCopilotPrefix(modelId);
}
export function aggregateUsage(
  files: { workspaceId: string; workspacePath: string; requests: UsageRequest[] }[],
  scannedAt = Date.now(),
  entries: CatalogEntry[] = catalog,
): UsageSummary {
  const models = new Map<string, UsageModelStat & { key: string }>();
  const days = new Map<string, UsageDayStat>();
  const workspaces = new Map<string, UsageWorkspaceStat>();
  const unknown = new Set<string>();
  let requestCount = 0,
    promptTokens = 0,
    outputTokens = 0,
    premiumEstimate = 0,
    estimatedTokens = 0,
    from: number | null = null,
    to: number | null = null;
  const bump = (
    map: Map<string, { requests: number; promptTokens: number; outputTokens: number; premiumEstimate: number }>,
    key: string,
    make: () => { requests: number; promptTokens: number; outputTokens: number; premiumEstimate: number },
    r: UsageRequest,
    premium: number,
  ) => {
    let row = map.get(key);
    if (!row) {
      row = make();
      map.set(key, row);
    }
    row.requests++;
    row.promptTokens += r.promptTokens;
    row.outputTokens += r.outputTokens;
    row.premiumEstimate += premium;
  };
  const totalFiles = files.length;
  for (const file of files) {
    let ws = workspaces.get(file.workspaceId);
    if (!ws) {
      ws = { id: file.workspaceId, path: file.workspacePath, requests: 0, promptTokens: 0, outputTokens: 0, premiumEstimate: 0 };
      workspaces.set(file.workspaceId, ws);
    }
    for (const r of file.requests) {
      requestCount++;
      promptTokens += r.promptTokens;
      outputTokens += r.outputTokens;
      if (r.tokensEstimated) estimatedTokens++;
      if (r.timestampMs !== null && r.timestampMs !== undefined) {
        from = from === null ? r.timestampMs : Math.min(from, r.timestampMs);
        to = to === null ? r.timestampMs : Math.max(to, r.timestampMs);
      }
      const premium = premiumForRequest(r);
      premiumEstimate += premium.value;
      if (premium.estimated && r.modelId) unknown.add(r.modelId);
      const key = r.modelId ?? "unknown";
      bump(models, key, () => ({ key, modelId: key, requests: 0, promptTokens: 0, outputTokens: 0, premiumEstimate: 0 }), r, premium.value);
      const day = dayOf(r.timestampMs);
      if (day) bump(days, day, () => ({ date: day, requests: 0, promptTokens: 0, outputTokens: 0, premiumEstimate: 0 }), r, premium.value);
      ws.requests++;
      ws.promptTokens += r.promptTokens;
      ws.outputTokens += r.outputTokens;
      ws.premiumEstimate += premium.value;
    }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const prompts: number[] = [];
  const outputs: number[] = [];
  const premiums: number[] = [];
  const credits: number[] = [];
  for (const file of files) {
    for (const r of file.requests) {
      if (r.promptTokens + r.outputTokens <= 0) continue;
      prompts.push(r.promptTokens);
      outputs.push(r.outputTokens);
      const premium = premiumForRequest(r);
      premiums.push(premium.value);
      const id = stripCopilotPrefix(r.modelId);
      const entry = id ? entries.find((e) => e.ids.includes(id)) : undefined;
      if (entry) {
        const price = estimate(entry, {
          ...defaults,
          tokens: {
            input: r.promptTokens,
            read: 0,
            write: 0,
            output: r.outputTokens,
          },
        });
        if (price.cost !== null) credits.push(price.cost);
      }
    }
  }
  const premiumP90 = quantileOf(premiums, 0.9);
  const creditP90 = quantileOf(credits, 0.9);
  const creditSample = credits.filter((v) => v > 0).length;
  return {
    scannedAt,
    fileCount: totalFiles,
    requestCount,
    promptTokens,
    outputTokens,
    premiumEstimate: round2(premiumEstimate),
    estimatedTokens,
    unknownModels: [...unknown].sort().slice(0, 50),
    dateRange: from !== null && to !== null ? { from, to } : null,
    medianPrompt: medianOf(prompts),
    medianOutput: medianOf(outputs),
    medianSample: prompts.length,
    premiumP90,
    creditP90: creditP90 === null ? null : round4(creditP90),
    creditSample,
    models: [...models.values()]
      .map((m) => ({ ...m, premiumEstimate: round2(m.premiumEstimate) }))
      .sort((a, b) => b.requests - a.requests || a.modelId.localeCompare(b.modelId)),
    days: [...days.values()]
      .map((d) => ({ ...d, premiumEstimate: round2(d.premiumEstimate) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    workspaces: [...workspaces.values()]
      .map((w) => ({ ...w, premiumEstimate: round2(w.premiumEstimate) }))
      .sort((a, b) => b.requests - a.requests || a.id.localeCompare(b.id)),
  };
}
export function suggestBudget(
  summary: UsageSummary | null,
  billing: Billing,
): BudgetSuggestion | null {
  if (!summary || summary.medianSample === 0) return null;
  const window =
    summary.dateRange
      ? `${new Date(summary.dateRange.from).toLocaleDateString()} – ${new Date(summary.dateRange.to).toLocaleDateString()}`
      : "undated requests";
  if (billing === "legacy") {
    if (summary.premiumP90 === null)
      return { value: null, note: `No priced legacy requests in ${summary.medianSample} sampled requests.` };
    return {
      value: summary.premiumP90,
      note: `p90 of ${summary.medianSample} requests · ${window}.`,
    };
  }
  if (billing === "credits") {
    if (summary.creditP90 === null)
      return { value: null, note: `No priced credit requests in ${summary.medianSample} sampled requests.` };
    return {
      value: summary.creditP90,
      note: `p90 of ${summary.creditSample} priced requests · ${window}.`,
    };
  }
  return { value: null, note: "Local history covers Copilot requests only." };
}
