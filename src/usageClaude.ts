import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UsageRoot, UsageIndex } from "./usage";
import { claudeCodeRoot } from "./usage";
import { claudeUnmappedWorkspace } from "./workspaceLabel";
import {
  type ClaudeSchemaFingerprint,
  type ClaudeUsageDayStat,
  type ClaudeUsageExclusions,
  type ClaudeUsageModelStat,
  type ClaudeUsageRequest,
  type ClaudeUsageSummary,
  type ClaudeUsageTotals,
  type ClaudeUsageWorkspaceStat,
  type UsageDiagnostics,
} from "./types";

/**
 * Claude Code local transcripts — a second local usage source beside Copilot's,
 * never merged with it.
 *
 * Claude Code bills as an Anthropic subscription or API usage in USD; Copilot
 * bills in premium requests or AI credits. Nothing here produces a premium
 * estimate, a credit figure, a percentile, or a budget suggestion, and no
 * client-reported cost is ever adopted as a rate. The unit is tokens, and the
 * four buckets are the disjoint ones `estimate` already models.
 *
 * The transcript schema is **not published by the vendor** (see
 * docs/other-client-usage-investigation.md), so this ships with the same drift
 * machinery as Copilot's unversioned sessions: a content-free fingerprint, a
 * fail-closed `unsupported` verdict, and file-an-issue guidance.
 */

/** Bumped when parsing changes, forcing one consented rescan of older caches. */
export const claudeParserVersion = 1;

/** The 14 record `type` values observed in Claude Code 2.1.280 transcripts. */
export const knownClaudeRecordTypes = [
  "ai-title",
  "assistant",
  "attachment",
  "atis-latch",
  "bridge-session",
  "cost-state",
  "file-history-delta",
  "file-history-snapshot",
  "last-prompt",
  "mode",
  "pr-link",
  "queue-operation",
  "system",
  "user",
] as const;
const knownTypes = new Set<string>(knownClaudeRecordTypes);

const emptyDiagnostics = (): UsageDiagnostics => ({
  malformed: 0,
  unsupported: 0,
  unreadable: 0,
  stale: 0,
  missingTokens: 0,
  estimatedTokens: 0,
});

export const claudeUnmapped = claudeUnmappedWorkspace;

export interface ClaudeCandidate {
  /** The project directory name, used only as a fallback workspace label. */
  projectSlug: string;
  filePath: string;
  size: number;
  mtime: number;
}

/**
 * Every transcript under the consented Claude roots.
 *
 * Only `*.jsonl` files directly inside a project directory are taken. The
 * `projects/` tree also holds Claude Code's auto memory (`memory/MEMORY.md` and
 * topic files) per the vendor's own directory reference; those are never opened,
 * because reading them would be reading the user's stored memory rather than
 * usage. Unreadable directories are reported, never silently skipped.
 */
export async function discoverClaudeFiles(
  roots: UsageRoot[] = [claudeCodeRoot()],
  unreadable: string[] = [],
): Promise<ClaudeCandidate[]> {
  const out: ClaudeCandidate[] = [];
  const seen = new Set<string>();
  for (const { path: root, layout } of roots) {
    if (layout !== "claude-transcripts") continue;
    let projects: string[];
    try {
      projects = await readdir(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") unreadable.push(root);
      continue;
    }
    for (const project of projects) {
      const projectPath = join(root, project);
      let entries: string[];
      try {
        entries = await readdir(projectPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          unreadable.push(projectPath);
        continue;
      }
      for (const entry of entries) {
        // Transcripts only: `memory/MEMORY.md` and every other file in a
        // project directory is user content, not usage.
        if (!entry.endsWith(".jsonl")) continue;
        const filePath = join(projectPath, entry);
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const s = await stat(filePath);
          if (!s.isFile()) continue;
          out.push({ projectSlug: project, filePath, size: s.size, mtime: s.mtimeMs });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            unreadable.push(filePath);
        }
      }
    }
  }
  return out;
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** A non-negative, finite, safe-integer token count, or undefined. */
const token = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.min(Math.trunc(v), Number.MAX_SAFE_INTEGER)
    : undefined;
const text = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;

/** The envelope's `version`, kept only when it is a short dotted token. */
const clientVersionOf = (v: unknown): string | null => {
  const raw = text(v, 50);
  return raw && /^\d+\.\d+\.\d+[A-Za-z0-9.\-+]*$/.test(raw) ? raw : null;
};

const parseTimestamp = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    // Observed envelopes carry ISO strings; a bare number is accepted only when
    // it is plainly epoch milliseconds, never seconds.
    return v > 1e11 ? Math.trunc(v) : null;
  }
  if (typeof v !== "string" || v.length > 40) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

export interface ParsedClaudeFile {
  diagnostics: UsageDiagnostics;
  requests: ClaudeUsageRequest[];
  /** The `cwd` of the last record that carried one; the workspace path. */
  workspacePath: string;
  /** Set only when the transcript matches no known schema. */
  fingerprint?: ClaudeSchemaFingerprint;
}

const emptyFingerprint = (): ClaudeSchemaFingerprint => ({
  version: 1,
  format: "claude-jsonl",
  clientVersion: null,
  lines: 0,
  kinds: [],
  assistant: false,
  envelopeCwd: false,
  envelopeTimestamp: false,
  envelopeIsSidechain: false,
  envelopeSessionId: false,
  messageModel: false,
  messageUsage: false,
  usageInput: false,
  usageOutput: false,
  usageCacheRead: false,
  usageCacheWrite: false,
  unknownLines: 0,
});

export function fingerprintClaudeTranscript(
  lines: string[],
): ClaudeSchemaFingerprint {
  const fp = emptyFingerprint();
  const kinds = new Set<string>();
  for (const line of lines) {
    fp.lines++;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record(raw)) continue;
    const kind = text(raw.type, 40);
    if (kind) {
      if (kinds.size < 20) kinds.add(kind);
      if (!knownTypes.has(kind)) fp.unknownLines++;
    }
    if (kind !== "assistant") continue;
    fp.assistant = true;
    fp.clientVersion ??= clientVersionOf(raw.version);
    if (text(raw.cwd)) fp.envelopeCwd = true;
    if (parseTimestamp(raw.timestamp) !== null) fp.envelopeTimestamp = true;
    if (typeof raw.isSidechain === "boolean") fp.envelopeIsSidechain = true;
    if (text(raw.sessionId)) fp.envelopeSessionId = true;
    const message = record(raw.message) ? raw.message : undefined;
    if (!message) continue;
    if (text(message.model)) fp.messageModel = true;
    const usage = record(message.usage) ? message.usage : undefined;
    if (!usage) continue;
    fp.messageUsage = true;
    if (token(usage.input_tokens) !== undefined) fp.usageInput = true;
    if (token(usage.output_tokens) !== undefined) fp.usageOutput = true;
    if (token(usage.cache_read_input_tokens) !== undefined) fp.usageCacheRead = true;
    if (token(usage.cache_creation_input_tokens) !== undefined)
      fp.usageCacheWrite = true;
  }
  fp.kinds = [...kinds].sort();
  return fp;
}

/**
 * Parse one Claude Code transcript. Keyed on `type`: only `assistant` records
 * carry usage, and the other known record types are *ignored* rather than
 * counted malformed — in the observed sample they outnumber assistant records
 * roughly two to one, so treating them as errors would make diagnostics
 * meaningless.
 *
 * `unsupported` follows the existing rule: no usable `assistant` record matched
 * **and** at least one line's `type` matched no known value, so a recognized
 * anchor can never mask drifted records into a silent zero.
 */
export function parseClaudeTranscript(
  text_: string,
  projectSlug: string,
): ParsedClaudeFile {
  const diagnostics = emptyDiagnostics();
  const rawLines = text_.split("\n");
  const lines: string[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  const fingerprint = fingerprintClaudeTranscript(lines);
  const out: ParsedClaudeFile = { diagnostics, requests: [], workspacePath: "" };

  const usable = lines.filter((line) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      diagnostics.malformed++;
      return false;
    }
    if (!record(raw)) {
      diagnostics.malformed++;
      return false;
    }
    const kind = text(raw.type, 40);
    // A record with no recognizable `type` is unknown, not a usage record.
    if (!kind || !knownTypes.has(kind)) return false;
    if (kind !== "assistant") return false;
    const message = record(raw.message) ? raw.message : undefined;
    const usage = message && record(message.usage) ? message.usage : undefined;
    if (!usage) return false;
    // A `usage` object carrying none of the four known buckets is not a usable
    // request. Treating it as one would let a renamed field pass as a recognized
    // anchor and mask drifted records into a silent zero.
    return (
      token(usage.input_tokens) !== undefined ||
      token(usage.output_tokens) !== undefined ||
      token(usage.cache_read_input_tokens) !== undefined ||
      token(usage.cache_creation_input_tokens) !== undefined
    );
  });

  if (fingerprint.assistant && usable.length === 0 && fingerprint.unknownLines > 0) {
    diagnostics.unsupported = 1;
    out.fingerprint = fingerprint;
    return out;
  }

  let index = 0;
  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record(raw)) continue;
    const kind = text(raw.type, 40);
    if (!kind || !knownTypes.has(kind) || kind !== "assistant") continue;
    // Workspace attribution: the last `cwd` wins, matching a session whose
    // working directory moved mid-conversation.
    const cwd = text(raw.cwd, 4000);
    if (cwd) out.workspacePath = cwd;
    const message = record(raw.message) ? raw.message : undefined;
    const usage = message && record(message.usage) ? message.usage : undefined;
    if (!message || !usage) continue;
    const input = token(usage.input_tokens);
    const output = token(usage.output_tokens);
    const read = token(usage.cache_read_input_tokens);
    const write = token(usage.cache_creation_input_tokens);
    // A record with no usable bucket at all is counted, never read as a zero.
    if (input === undefined && output === undefined && read === undefined && write === undefined) {
      diagnostics.missingTokens++;
      continue;
    }
    out.requests.push({
      sessionId: text(raw.sessionId, 100) ?? text(raw.uuid, 100) ?? projectSlug,
      requestIndex: index++,
      modelId: text(message.model, 200) ?? null,
      timestampMs: parseTimestamp(raw.timestamp),
      inputTokens: input ?? 0,
      outputTokens: output ?? 0,
      cacheReadTokens: read ?? 0,
      cacheWriteTokens: write ?? 0,
      sidechain: raw.isSidechain === true,
    });
  }
  return out;
}

export interface ClaudeStoredFile {
  projectSlug: string;
  workspacePath: string;
  requests: ClaudeUsageRequest[];
  diagnostics: UsageDiagnostics;
  fingerprint?: ClaudeSchemaFingerprint;
}
export interface ClaudeStoredUsageFile {
  version: 1;
  scannedAt: number;
  index: UsageIndex;
  files: Record<string, ClaudeStoredFile>;
}

const validClaudeFingerprint = (v: unknown): v is ClaudeSchemaFingerprint => {
  if (!record(v) || v.version !== 1 || v.format !== "claude-jsonl") return false;
  if (
    v.clientVersion !== null &&
    typeof v.clientVersion !== "string"
  )
    return false;
  if (typeof v.lines !== "number" || !Number.isSafeInteger(v.lines) || v.lines < 0)
    return false;
  if (!Array.isArray(v.kinds) || v.kinds.length > 20)
    return false;
  if (
    !v.kinds.every((k): k is string => typeof k === "string" && k.length <= 40)
  )
    return false;
  if (typeof v.unknownLines !== "number" || !Number.isSafeInteger(v.unknownLines) || v.unknownLines < 0)
    return false;
  return [
    "assistant",
    "envelopeCwd",
    "envelopeTimestamp",
    "envelopeIsSidechain",
    "envelopeSessionId",
    "messageModel",
    "messageUsage",
    "usageInput",
    "usageOutput",
    "usageCacheRead",
    "usageCacheWrite",
  ].every((k) => typeof (v as Record<string, unknown>)[k] === "boolean");
};

/**
 * Stored-file validation. Tolerant in the same direction as the Copilot store:
 * a structurally broken file is rejected wholesale (the caller then rescans),
 * never partially trusted.
 */
export function validClaudeUsageFile(v: unknown): v is ClaudeStoredUsageFile {
  if (!record(v) || v.version !== 1) return false;
  if (typeof v.scannedAt !== "number" || !Number.isFinite(v.scannedAt)) return false;
  if (!record(v.index) || v.index.version !== 1 || !record(v.index.files)) return false;
  for (const entry of Object.values(v.index.files)) {
    if (
      !record(entry) ||
      token(entry.size) === undefined ||
      typeof entry.mtime !== "number" ||
      !Number.isFinite(entry.mtime) ||
      !Number.isSafeInteger(entry.parser) ||
      (entry.parser as number) < 1
    )
      return false;
  }
  if (!record(v.files)) return false;
  for (const file of Object.values(v.files)) {
    if (
      !record(file) ||
      typeof file.projectSlug !== "string" ||
      typeof file.workspacePath !== "string" ||
      !Array.isArray(file.requests) ||
      !record(file.diagnostics) ||
      Object.keys(emptyDiagnostics()).some(
        (k) => token((file.diagnostics as Record<string, unknown>)[k]) === undefined,
      )
    )
      return false;
    if (file.fingerprint !== undefined && !validClaudeFingerprint(file.fingerprint))
      return false;
    for (const r of file.requests) {
      if (
        !record(r) ||
        typeof r.sessionId !== "string" ||
        // Our own written value, so it must be a whole number: a fractional
        // index means the store is not what we wrote.
        !Number.isSafeInteger(r.requestIndex) ||
        (r.requestIndex as number) < 0 ||
        typeof r.sidechain !== "boolean" ||
        (r.modelId !== null && typeof r.modelId !== "string") ||
        (r.timestampMs !== null &&
          (typeof r.timestampMs !== "number" || !Number.isFinite(r.timestampMs)))
      )
        return false;
      if (
        token(r.inputTokens) === undefined ||
        token(r.outputTokens) === undefined ||
        token(r.cacheReadTokens) === undefined ||
        token(r.cacheWriteTokens) === undefined
      )
        return false;
    }
  }
  return true;
}

export interface ClaudeFileInput extends ClaudeStoredFile {
  path: string;
}

const emptyTotals = (): ClaudeUsageTotals => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
const addTotals = (t: ClaudeUsageTotals, r: ClaudeUsageRequest): void => {
  t.requests++;
  t.inputTokens += r.inputTokens;
  t.outputTokens += r.outputTokens;
  t.cacheReadTokens += r.cacheReadTokens;
  t.cacheWriteTokens += r.cacheWriteTokens;
};

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Table caps, matching the Copilot Usage card so neither table dwarfs a panel. */
export const claudeTableCaps = { models: 12, days: 14, workspaces: 20 };

/**
 * Aggregate Claude transcripts into their own token ledger.
 *
 * Subagent (`isSidechain`) turns are **held out of the headline totals** and
 * counted in `exclusions.sidechain`, because a subagent's turns are the parent's
 * work seen twice; they are not dropped silently. Every other turn contributes
 * to `totals` and to the per-model, per-day, and per-workspace tables.
 *
 * Nothing here is comparable to Copilot's premium-request or credit figures, and
 * no consumer of `UsageSummary` reads this output.
 */
export function aggregateClaudeUsage(
  files: ClaudeFileInput[],
  scannedAt = Date.now(),
): ClaudeUsageSummary {
  const diagnostics = emptyDiagnostics();
  for (const file of files)
    for (const key of Object.keys(diagnostics) as (keyof UsageDiagnostics)[])
      diagnostics[key] += file.diagnostics?.[key] ?? 0;

  const fingerprints = new Map<
    string,
    { fingerprint: ClaudeSchemaFingerprint; files: number }
  >();
  for (const file of files) {
    if (!file.fingerprint || !validClaudeFingerprint(file.fingerprint)) continue;
    const key = JSON.stringify(file.fingerprint);
    const existing = fingerprints.get(key);
    if (existing) existing.files++;
    else if (fingerprints.size < 5)
      fingerprints.set(key, { fingerprint: file.fingerprint, files: 1 });
  }

  const totals = emptyTotals();
  const exclusions: ClaudeUsageExclusions = { sidechain: 0, missingTokens: 0 };
  const models = new Map<string, ClaudeUsageModelStat>();
  const days = new Map<string, ClaudeUsageDayStat>();
  const workspaces = new Map<string, ClaudeUsageWorkspaceStat>();
  const unknown = new Set<string>();
  let from: number | null = null;
  let to: number | null = null;

  for (const file of files) {
    const workspaceId = file.projectSlug;
    for (const r of file.requests) {
      if (r.sidechain) {
        exclusions.sidechain++;
        continue;
      }
      if (
        r.inputTokens === 0 &&
        r.outputTokens === 0 &&
        r.cacheReadTokens === 0 &&
        r.cacheWriteTokens === 0
      )
        exclusions.missingTokens++;
      addTotals(totals, r);
      if (typeof r.timestampMs === "number") {
        from = from === null ? r.timestampMs : Math.min(from, r.timestampMs);
        to = to === null ? r.timestampMs : Math.max(to, r.timestampMs);
        const key = dayKey(r.timestampMs);
        const day = days.get(key) ?? ({ date: key, ...emptyTotals() } as const);
        addTotals(day, r);
        days.set(key, day as ClaudeUsageDayStat);
      }
      const modelKey = r.modelId ?? "unknown";
      if (r.modelId === null) unknown.add(String(workspaceId));
      const model = models.get(modelKey) ?? ({ modelId: modelKey, ...emptyTotals() } as const);
      addTotals(model, r);
      models.set(modelKey, model as ClaudeUsageModelStat);
      const ws =
        workspaces.get(workspaceId) ??
        ({ id: workspaceId, path: file.workspacePath, ...emptyTotals() } as const);
      addTotals(ws, r);
      workspaces.set(workspaceId, ws as ClaudeUsageWorkspaceStat);
    }
  }

  const byTokensDesc = (a: ClaudeUsageTotals, b: ClaudeUsageTotals) =>
    b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens);
  const summary: ClaudeUsageSummary = {
    scannedAt,
    fileCount: files.length,
    requestCount: totals.requests,
    totals,
    exclusions,
    diagnostics,
    unknownModels: [...unknown].slice(0, 5),
    dateRange: from === null || to === null ? null : { from, to },
    models: [...models.values()].sort(byTokensDesc).slice(0, claudeTableCaps.models),
    days: [...days.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, claudeTableCaps.days),
    workspaces: [...workspaces.values()]
      .sort(byTokensDesc)
      .slice(0, claudeTableCaps.workspaces),
    ...(fingerprints.size
      ? { schemaFingerprints: [...fingerprints.values()] }
      : {}),
  };
  return summary;
}

export interface ClaudeRetentionPurge {
  files: Record<string, ClaudeStoredFile>;
  purgedRequests: number;
  purgedFiles: number;
}

/**
 * Drop requests older than the retention window, sharing the Copilot setting
 * rather than adding a second one. Strictly older than the cutoff, so a request
 * exactly on the boundary survives; a request with no usable timestamp is kept,
 * never guessed at.
 */
export function purgeClaudeRetention(
  files: Record<string, ClaudeStoredFile>,
  retentionDays: number | undefined,
  now: number = Date.now(),
): ClaudeRetentionPurge {
  if (
    retentionDays === undefined ||
    !Number.isSafeInteger(retentionDays) ||
    retentionDays <= 0
  )
    return { files: { ...files }, purgedRequests: 0, purgedFiles: 0 };
  const cutoff = now - retentionDays * 86400000;
  const next: Record<string, ClaudeStoredFile> = {};
  let purgedRequests = 0;
  let purgedFiles = 0;
  for (const [path, file] of Object.entries(files)) {
    const kept = file.requests.filter(
      (r) => typeof r.timestampMs !== "number" || !(r.timestampMs < cutoff),
    );
    purgedRequests += file.requests.length - kept.length;
    if (kept.length === file.requests.length) {
      next[path] = file;
      continue;
    }
    if (kept.length > 0) {
      next[path] = { ...file, requests: kept };
      continue;
    }
    purgedFiles++;
  }
  return { files: next, purgedRequests, purgedFiles };
}
