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
  type UsageSchemaFingerprint,
  type UsageSummary,
  type UsageDiagnostics,
  type UsageWorkspaceStat,
} from "./types";
export const usageParserVersion = 3;
export const emptyUsageDiagnostics = (): UsageDiagnostics => ({
  malformed: 0,
  unsupported: 0,
  unreadable: 0,
  stale: 0,
  missingTokens: 0,
  estimatedTokens: 0,
});
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
  if (platform === "win32")
    base = env.APPDATA || join(homedir(), "AppData", "Roaming");
  else if (platform === "darwin")
    base = join(homedir(), "Library", "Application Support");
  else base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return [
    join(base, "Code", "User", "workspaceStorage"),
    join(base, "Code - Insiders", "User", "workspaceStorage"),
  ];
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
            const ref =
              typeof rec.uri === "string"
                ? rec.uri
                : typeof rec.path === "string"
                  ? rec.path
                  : "";
            if (!ref) return "";
            const p = uriToPath(ref, storageRoot);
            return ref.startsWith("file:///") ||
              ref.includes("://") ||
              p.startsWith("/") ||
              /^[a-zA-Z]:/.test(p)
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
  unreadable: string[] = [],
): Promise<UsageCandidate[]> {
  const out: UsageCandidate[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    let dirs: string[];
    try {
      dirs = await readdir(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        unreadable.push(root);
      continue;
    }
    for (const dir of dirs) {
      const dirPath = join(root, dir);
      let entries: string[];
      try {
        entries = await readdir(join(dirPath, "chatSessions"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          unreadable.push(join(dirPath, "chatSessions"));
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
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            unreadable.push(filePath);
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
export const maxUsageRetentionDays = 3650;
export function parseUsageRetentionDays(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" && typeof value !== "string")
    throw new Error("Invalid usage retention.");
  const text = typeof value === "string" ? value.trim() : value;
  if (text === "") return undefined;
  const days = typeof text === "number" ? text : Number(text);
  if (
    typeof days !== "number" ||
    !Number.isSafeInteger(days) ||
    days < 0 ||
    days > maxUsageRetentionDays
  )
    throw new Error("Invalid usage retention.");
  return days === 0 ? undefined : days;
}
export interface UsageRetentionPurge {
  files: StoredUsageFile["files"];
  index: UsageIndex;
  purgedRequests: number;
  purgedFiles: number;
}
export function purgeUsageRetention(
  files: StoredUsageFile["files"],
  index: UsageIndex,
  retentionDays: number | undefined,
  now: number = Date.now(),
): UsageRetentionPurge {
  const nextFiles: StoredUsageFile["files"] = {};
  const nextIndex: UsageIndex = { version: 1, files: { ...index.files } };
  let purgedRequests = 0,
    purgedFiles = 0;
  if (
    retentionDays === undefined ||
    !Number.isSafeInteger(retentionDays) ||
    retentionDays <= 0 ||
    typeof now !== "number" ||
    !Number.isFinite(now)
  )
    return {
      files: { ...files },
      index: nextIndex,
      purgedRequests,
      purgedFiles,
    };
  const cutoff = now - retentionDays * 86400000;
  for (const [path, file] of Object.entries(files)) {
    const kept = file.requests.filter(
      (r) => typeof r.timestampMs !== "number" || !(r.timestampMs < cutoff),
    );
    purgedRequests += file.requests.length - kept.length;
    if (kept.length === file.requests.length) {
      nextFiles[path] = file;
      continue;
    }
    if (kept.length > 0) {
      nextFiles[path] = { ...file, requests: kept };
      continue;
    }
    purgedFiles++;
    delete nextIndex.files[path];
  }
  return { files: nextFiles, index: nextIndex, purgedRequests, purgedFiles };
}
export interface StoredUsageFile {
  version: 2;
  scannedAt: number;
  index: UsageIndex;
  files: Record<
    string,
    {
      workspaceId: string;
      workspacePath: string;
      requests: UsageRequest[];
      diagnostics?: UsageDiagnostics;
      fingerprint?: UsageSchemaFingerprint;
    }
  >;
}
const validFingerprint = (v: unknown): v is UsageSchemaFingerprint => {
  if (!recordOf(v) || v.version !== 1) return false;
  if (v.format === "jsonl") {
    return (
      token(v.lines) !== undefined &&
      Array.isArray(v.kinds) &&
      v.kinds.length <= 10 &&
      v.kinds.every(
        (k): k is string => typeof k === "string" && k.length <= 20,
      ) &&
      typeof v.anchorSessionId === "boolean" &&
      typeof v.anchorCreationDate === "boolean" &&
      typeof v.anchorSelectedModel === "boolean" &&
      recordOf(v.envelopes) &&
      typeof v.envelopes.anchor === "boolean" &&
      typeof v.envelopes.append === "boolean" &&
      typeof v.envelopes.result === "boolean"
    );
  }
  if (v.format === "legacy-json") {
    return (
      typeof v.hasSessionId === "boolean" &&
      typeof v.hasCreationDate === "boolean" &&
      typeof v.hasSelectedModel === "boolean" &&
      typeof v.hasRequests === "boolean" &&
      typeof v.requestsIsArray === "boolean"
    );
  }
  return false;
};
export function validUsageFile(v: unknown): v is StoredUsageFile {
  if (
    !recordOf(v) ||
    v.version !== 2 ||
    !validTime(v.scannedAt) ||
    !recordOf(v.index) ||
    v.index.version !== 1 ||
    !recordOf(v.index.files) ||
    !recordOf(v.files)
  )
    return false;
  for (const entry of Object.values(v.index.files)) {
    if (
      !recordOf(entry) ||
      token(entry.size) === undefined ||
      !validTime(entry.mtime) ||
      !Number.isSafeInteger(entry.parser) ||
      (entry.parser as number) < 1
    )
      return false;
  }
  for (const file of Object.values(v.files)) {
    if (
      !recordOf(file) ||
      typeof file.workspaceId !== "string" ||
      typeof file.workspacePath !== "string" ||
      !Array.isArray(file.requests)
    )
      return false;
    if (
      !recordOf(file.diagnostics) ||
      Object.keys(emptyUsageDiagnostics()).some(
        (k) =>
          token((file.diagnostics as Record<string, unknown>)[k]) === undefined,
      )
    )
      return false;
    if (
      file.fingerprint !== undefined &&
      !validFingerprint(file.fingerprint)
    )
      return false;
    for (const r of file.requests) {
      if (
        !recordOf(r) ||
        typeof r.sessionId !== "string" ||
        typeof r.workspaceId !== "string" ||
        token(r.requestIndex) === undefined ||
        token(r.promptTokens) === undefined ||
        token(r.outputTokens) === undefined ||
        token(r.toolCallRounds) === undefined ||
        typeof r.tokensEstimated !== "boolean" ||
        (r.modelId !== null && typeof r.modelId !== "string") ||
        (r.timestampMs !== null && !validTime(r.timestampMs)) ||
        !["observed", "estimated", "missing"].includes(
          r.promptProvenance as string,
        ) ||
        !["observed", "estimated", "missing"].includes(
          r.outputProvenance as string,
        )
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
const validTime = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= 8640000000000000;
const numOr = (v: unknown): number | undefined =>
  validTime(v) ? v : undefined;
const token = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
function normaliseResolvedModel(raw: string): string | null {
  if (!raw) return null;
  return `copilot/${raw.replace(/(-\d+)-(\d+)$/, "$1.$2")}`;
}
export interface ParsedUsageFile {
  diagnostics: UsageDiagnostics;
  anchor: { sessionId: string; creationDate?: number; modelId?: string };
  requests: UsageRequest[];
  /** Set only when the file matches no known schema (unsupported). */
  fingerprint?: UsageSchemaFingerprint;
}
/** Bounded, content-free label for an observed `kind` value. */
const fingerprintKind = (kind: unknown): string => {
  if (typeof kind === "number" && Number.isSafeInteger(kind) && Math.abs(kind) <= 999)
    return String(kind);
  if (typeof kind === "string" && kind.length > 0 && kind.length <= 20 && /^[\w\-.]+$/.test(kind))
    return kind;
  if (kind === undefined) return "kind:absent";
  return "kind:other";
};
export function parseUsageJsonl(
  text: string,
  workspaceId: string,
  fileStem: string,
): ParsedUsageFile {
  const diagnostics = emptyUsageDiagnostics();
  let recognized = false;
  let sessionId = fileStem;
  let creationDate: number | undefined;
  let anchorModel: string | undefined;
  const appends = new Map<
    number,
    { modelId?: string; requestId?: string; timestamp?: number }
  >();
  const results: { index: number; value: Record<string, unknown> }[] = [];
  let nextIndex = 0;
  // Fingerprint inputs: shape only, never values or chat content.
  let fingerprintLines = 0;
  let unknownLines = 0;
  const fingerprintKinds = new Set<string>();
  let fpSessionId = false,
    fpCreationDate = false,
    fpSelectedModel = false;
  let fpAnchor = false,
    fpAppend = false,
    fpResult = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    fingerprintLines++;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      diagnostics.malformed++;
      continue;
    }
    if (!recordOf(obj)) {
      diagnostics.malformed++;
      continue;
    }
    if (fingerprintKinds.size < 10)
      fingerprintKinds.add(fingerprintKind(obj.kind));
    const kind = obj.kind;
    const v = recordOf(obj.v) ? obj.v : recordOf(obj) ? obj : undefined;
    if (kind === 0 && v) {
      recognized = true;
      fpAnchor = true;
      if (typeof v.sessionId === "string" && v.sessionId) {
        sessionId = v.sessionId;
        fpSessionId = true;
      }
      const cd = numOr(v.creationDate);
      if (cd !== undefined) {
        creationDate = cd;
        fpCreationDate = true;
      }
      const inputState = recordOf(v.inputState) ? v.inputState : undefined;
      const selected =
        inputState && recordOf(inputState.selectedModel)
          ? inputState.selectedModel
          : undefined;
      if (selected && typeof selected.identifier === "string") {
        anchorModel = selected.identifier;
        fpSelectedModel = true;
      }
    } else if (
      kind === 2 &&
      Array.isArray(obj.k) &&
      obj.k.length === 1 &&
      obj.k[0] === "requests" &&
      Array.isArray(obj.v)
    ) {
      recognized = true;
      fpAppend = true;
      for (const item of obj.v) {
        if (!recordOf(item)) {
          diagnostics.malformed++;
          nextIndex++;
          continue;
        }
        appends.set(nextIndex, {
          modelId: typeof item.modelId === "string" ? item.modelId : undefined,
          requestId:
            typeof item.requestId === "string" ? item.requestId : undefined,
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
      recognized = true;
      fpResult = true;
      if (token(obj.k[1]) === undefined) {
        diagnostics.malformed++;
        continue;
      }
      const requestIndex = obj.k[1] as number;
      const existing = results.findIndex((r) => r.index === requestIndex);
      const result = { index: obj.k[1] as number, value: obj.v };
      if (existing >= 0) results[existing] = result;
      else results.push(result);
    } else {
      // A well-formed line matching no known envelope: possible schema
      // drift. Counted separately from malformed lines so a partially
      // drifted file (known anchor, unknown request shape) cannot degrade
      // to a silent zero-request listing.
      unknownLines++;
    }
  }
  const requests: UsageRequest[] = results.map(({ index, value }) => {
    const md = recordOf(value.metadata) ? value.metadata : {};
    const usage = recordOf(value.usage) ? value.usage : {};
    const promptValue = token(md.promptTokens) ?? token(usage.promptTokens);
    const promptTokens = promptValue ?? 0;
    const outputValue = token(md.outputTokens) ?? token(usage.completionTokens);
    const outputTokens = outputValue ?? 0;
    const timings = recordOf(value.timings) ? value.timings : {};
    const rounds = Array.isArray(md.toolCallRounds) ? md.toolCallRounds : [];
    const firstRound =
      rounds.length > 0 && recordOf(rounds[0])
        ? (rounds[0] as Record<string, unknown>)
        : {};
    const append = appends.get(index) ?? {};
    const resolved =
      typeof md.resolvedModel === "string"
        ? normaliseResolvedModel(md.resolvedModel)
        : null;
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
      promptProvenance: promptValue === undefined ? "missing" : "observed",
      outputProvenance: outputValue === undefined ? "missing" : "observed",
      tokensEstimated: false,
    };
  });
  diagnostics.missingTokens = requests.filter(
    (r) => r.promptProvenance === "missing" || r.outputProvenance === "missing",
  ).length;
  // No known schema, or known framing but zero usable requests alongside
  // lines no known envelope explains: either way the file needs an
  // actionable fingerprint, never a silent zero.
  if (!recognized || (requests.length === 0 && unknownLines > 0))
    diagnostics.unsupported = 1;
  const fingerprint: UsageSchemaFingerprint | undefined =
    diagnostics.unsupported
      ? {
          format: "jsonl",
          version: 1,
          lines: fingerprintLines,
          kinds: [...fingerprintKinds].sort().slice(0, 10),
          anchorSessionId: fpSessionId,
          anchorCreationDate: fpCreationDate,
          anchorSelectedModel: fpSelectedModel,
          envelopes: { anchor: fpAnchor, append: fpAppend, result: fpResult },
        }
      : undefined;
  return {
    anchor: { sessionId, creationDate, modelId: anchorModel },
    requests,
    diagnostics,
    ...(fingerprint ? { fingerprint } : {}),
  };
}
function legacyText(value: unknown): string {
  if (typeof value === "string") return value;
  if (recordOf(value) && typeof value.content === "string")
    return value.content;
  return "";
}
export function parseUsageLegacyJson(
  text: string,
  workspaceId: string,
  fileStem: string,
): ParsedUsageFile {
  const diagnostics = emptyUsageDiagnostics();
  const legacyFingerprint = (
    parsed: unknown,
  ): UsageSchemaFingerprint => ({
    format: "legacy-json",
    version: 1,
    hasSessionId:
      recordOf(parsed) && typeof parsed.sessionId === "string",
    hasCreationDate: recordOf(parsed) && validTime(parsed.creationDate),
    hasSelectedModel: recordOf(parsed) && recordOf(parsed.selectedModel),
    hasRequests: recordOf(parsed) && parsed.requests !== undefined,
    requestsIsArray: recordOf(parsed) && Array.isArray(parsed.requests),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      anchor: { sessionId: fileStem },
      requests: [],
      diagnostics: { ...diagnostics, unsupported: 1, malformed: 1 },
      fingerprint: {
        format: "legacy-json",
        version: 1,
        hasSessionId: false,
        hasCreationDate: false,
        hasSelectedModel: false,
        hasRequests: false,
        requestsIsArray: false,
      },
    };
  }
  if (!recordOf(parsed) || !Array.isArray(parsed.requests))
    return {
      anchor: { sessionId: fileStem },
      requests: [],
      diagnostics: { ...diagnostics, unsupported: 1 },
      fingerprint: legacyFingerprint(parsed),
    };
  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId
      ? parsed.sessionId
      : fileStem;
  const creationDate = numOr(parsed.creationDate);
  const selected = recordOf(parsed.selectedModel) ? parsed.selectedModel : {};
  const anchorModel =
    typeof selected.id === "string"
      ? selected.id
      : typeof selected.identifier === "string"
        ? selected.identifier
        : undefined;
  const list = Array.isArray(parsed.requests) ? parsed.requests : [];
  const requests: UsageRequest[] = [];
  list.forEach((item, index) => {
    if (!recordOf(item)) {
      diagnostics.malformed++;
      return;
    }
    const message = recordOf(item.message) ? item.message : {};
    const variables =
      recordOf(item.variableData) && Array.isArray(item.variableData.variables)
        ? item.variableData.variables
        : [];
    const promptText = [typeof message.text === "string" ? message.text : ""]
      .concat(
        variables.map((x) =>
          recordOf(x) && typeof x.value === "string" ? x.value : "",
        ),
      )
      .join("\n");
    const response = item.response;
    const result =
      recordOf(response) && recordOf(response.result) ? response.result : {};
    const md = recordOf(result.metadata) ? result.metadata : {};
    const usage = recordOf(result.usage) ? result.usage : {};
    const promptValue = token(md.promptTokens) ?? token(usage.promptTokens);
    let promptTokens = promptValue ?? 0;
    let promptProvenance: UsageRequest["promptProvenance"] =
      promptValue === undefined ? "missing" : "observed";
    const outputValue = token(md.outputTokens) ?? token(usage.completionTokens);
    let outputTokens = outputValue ?? 0;
    let outputProvenance: UsageRequest["outputProvenance"] =
      outputValue === undefined ? "missing" : "observed";
    let tokensEstimated = false;
    if (promptValue === undefined || outputValue === undefined) {
      const respText = Array.isArray(response)
        ? response.map(legacyText).join("\n")
        : typeof result.value === "string"
          ? result.value
          : "";
      if (promptValue === undefined && promptText.trim()) {
        promptProvenance = "estimated";
        promptTokens = Math.max(1, Math.floor(promptText.length / 4));
        tokensEstimated = true;
      }
      if (outputValue === undefined && respText.trim()) {
        outputProvenance = "estimated";
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
      modelId:
        (typeof md.modelId === "string" && md.modelId) || anchorModel || null,
      timestampMs:
        numOr(timings.requestSent) ??
        numOr(timings.firstTokenReceived) ??
        creationDate ??
        null,
      promptTokens,
      outputTokens,
      toolCallRounds: rounds.length,
      promptProvenance,
      outputProvenance,
      tokensEstimated,
    });
  });
  diagnostics.missingTokens = requests.filter(
    (r) => r.promptProvenance === "missing" || r.outputProvenance === "missing",
  ).length;
  diagnostics.estimatedTokens = requests.filter(
    (r) => r.tokensEstimated,
  ).length;
  return {
    anchor: { sessionId, creationDate, modelId: anchorModel },
    requests,
    diagnostics,
  };
}
export function premiumForRequest(request: UsageRequest): {
  value: number;
  estimated: boolean;
} {
  if (request.promptTokens + request.outputTokens <= 0)
    return { value: 0, estimated: false };
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
  const priced = values
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  if (!priced.length) return null;
  return priced[Math.min(priced.length - 1, Math.ceil(q * priced.length) - 1)];
}
function stripCopilotPrefix(modelId: string | null): string | null {
  if (!modelId) return null;
  return modelId.startsWith("copilot/")
    ? modelId.slice("copilot/".length)
    : modelId;
}
export function normalizeUsageModelId(modelId: string | null): string | null {
  return stripCopilotPrefix(modelId);
}
export function aggregateUsage(
  files: {
    workspaceId: string;
    workspacePath: string;
    requests: UsageRequest[];
    diagnostics?: UsageDiagnostics;
    fingerprint?: UsageSchemaFingerprint;
  }[],
  scannedAt = Date.now(),
  entries: CatalogEntry[] = catalog,
): UsageSummary {
  const diagnostics = emptyUsageDiagnostics();
  for (const file of files)
    for (const key of Object.keys(diagnostics) as (keyof UsageDiagnostics)[])
      diagnostics[key] += file.diagnostics?.[key] ?? 0;
  const fingerprintGroups = new Map<
    string,
    { fingerprint: UsageSchemaFingerprint; files: number }
  >();
  for (const file of files) {
    if (!file.fingerprint || !validFingerprint(file.fingerprint)) continue;
    const key = JSON.stringify(file.fingerprint);
    const existing = fingerprintGroups.get(key);
    if (existing) existing.files++;
    else if (fingerprintGroups.size < 5)
      fingerprintGroups.set(key, { fingerprint: file.fingerprint, files: 1 });
  }
  const models = new Map<string, UsageModelStat & { key: string }>();
  const days = new Map<string, UsageDayStat>();
  const workspaces = new Map<string, UsageWorkspaceStat>();
  const unknown = new Set<string>();
  const emptyCompleteness = () => ({
    observedPairs: 0,
    observedZeroPairs: 0,
    missingPairs: 0,
    estimatedPairs: 0,
    fallbackMultipliers: 0,
  });
  const completeness = emptyCompleteness();
  const count = (c: ReturnType<typeof emptyCompleteness>, r: UsageRequest) => {
    const observed =
      r.promptProvenance === "observed" && r.outputProvenance === "observed";
    if (observed) {
      c.observedPairs++;
      if (r.promptTokens === 0 && r.outputTokens === 0) c.observedZeroPairs++;
    }
    // Missing and estimated categories may overlap for a partial legacy pair.
    if (
      !r.promptProvenance || !r.outputProvenance ||
      r.promptProvenance === "missing" || r.outputProvenance === "missing"
    ) c.missingPairs++;
    if (
      r.promptProvenance === "estimated" || r.outputProvenance === "estimated" ||
      r.tokensEstimated
    ) c.estimatedPairs++;
    if (premiumForRequest(r).estimated) c.fallbackMultipliers++;
  };
  let requestCount = 0,
    promptTokens = 0,
    outputTokens = 0,
    premiumEstimate = 0,
    estimatedTokens = 0,
    from: number | null = null,
    to: number | null = null;
  const bump = (
    map: Map<
      string,
      {
        requests: number;
        promptTokens: number;
        outputTokens: number;
        premiumEstimate: number;
        completeness?: ReturnType<typeof emptyCompleteness>;
      }
    >,
    key: string,
    make: () => {
      requests: number;
      promptTokens: number;
      outputTokens: number;
      premiumEstimate: number;
    },
    r: UsageRequest,
    premium: number,
  ) => {
    let row = map.get(key);
    if (!row) {
      row = make();
      map.set(key, row);
    }
    row.requests++;
    count(row.completeness ??= emptyCompleteness(), r);
    row.promptTokens += r.promptTokens;
    row.outputTokens += r.outputTokens;
    row.premiumEstimate += premium;
  };
  const totalFiles = files.length;
  for (const file of files) {
    let ws = workspaces.get(file.workspaceId);
    if (!ws) {
      ws = {
        id: file.workspaceId,
        path: file.workspacePath,
        requests: 0,
        promptTokens: 0,
        outputTokens: 0,
        premiumEstimate: 0,
      };
      workspaces.set(file.workspaceId, ws);
    }
    for (const r of file.requests) {
      requestCount++;
      count(completeness, r);
      promptTokens += r.promptTokens;
      outputTokens += r.outputTokens;
      if (r.tokensEstimated) estimatedTokens++;
      if (r.timestampMs !== null && r.timestampMs !== undefined) {
        from = from === null ? r.timestampMs : Math.min(from, r.timestampMs);
        to = to === null ? r.timestampMs : Math.max(to, r.timestampMs);
      }
      const premium = premiumForRequest(r);
      premiumEstimate += premium.value;
      if (premium.estimated) unknown.add(r.modelId ?? "unknown (missing model id)");
      const key = r.modelId ?? "unknown";
      bump(
        models,
        key,
        () => ({
          key,
          modelId: key,
          requests: 0,
          promptTokens: 0,
          outputTokens: 0,
          premiumEstimate: 0,
        }),
        r,
        premium.value,
      );
      const day = dayOf(r.timestampMs);
      if (day)
        bump(
          days,
          day,
          () => ({
            date: day,
            requests: 0,
            promptTokens: 0,
            outputTokens: 0,
            premiumEstimate: 0,
          }),
          r,
          premium.value,
        );
      ws.requests++;
      count(ws.completeness ??= emptyCompleteness(), r);
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
      if (
        r.promptProvenance !== "observed" ||
        r.outputProvenance !== "observed"
      )
        continue;
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
  const creditSample = credits.length;
  return {
    scannedAt,
    completeness,
    diagnostics,
    ...(fingerprintGroups.size
      ? { schemaFingerprints: [...fingerprintGroups.values()] }
      : {}),
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
      .sort(
        (a, b) => b.requests - a.requests || a.modelId.localeCompare(b.modelId),
      ),
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
  const window = summary.dateRange
    ? `${new Date(summary.dateRange.from).toLocaleDateString()} – ${new Date(summary.dateRange.to).toLocaleDateString()}`
    : "undated requests";
  if (billing === "legacy") {
    if (summary.premiumP90 === null)
      return {
        value: null,
        note: `No priced legacy requests in ${summary.medianSample} sampled requests.`,
      };
    return {
      value: summary.premiumP90,
      note: `p90 of ${summary.medianSample} requests · ${window}.` +
        (summary.completeness?.fallbackMultipliers
          ? " Unknown model — default multiplier applied in usage history." : ""),
    };
  }
  if (billing === "credits") {
    if (summary.creditP90 === null)
      return {
        value: null,
        note: `No priced credit requests in ${summary.medianSample} sampled requests.`,
      };
    return {
      value: summary.creditP90,
      note: `p90 of ${summary.creditSample} priced requests · ${window}.`,
    };
  }
  return { value: null, note: "Local history covers Copilot requests only." };
}
