import { baseModelIdOf } from "./assist";
import type { AvailableModel, CostUnit, NewModelEntry, NewModelsReport, Row, Source } from "./types";

/**
 * "New models" detection (pure, vscode-free, webview-safe).
 *
 * A source's *seen set* is every model id ever discovered on it. A model is new
 * only when discovery succeeded, the source had a seen set already, and the id
 * is absent from it. The first discovery of a source seeds silently (otherwise
 * every model would read as new), and a failed or empty discovery never counts
 * as "everything vanished" nor rewrites the set. Vanished ids stay in the set
 * so a model that flaps in and out of a listing is announced once, not each time.
 */
export const maxSeenIds = 5000;
/** Entries listed in a one-line summary before "+N more". */
export const summaryLimit = 3;

export interface SeenDiff {
  /** True when this discovery only established the baseline. */
  seeded: boolean;
  newIds: string[];
  /** The seen set to persist. */
  next: string[];
}

export function diffSeen(
  stored: readonly string[] | undefined,
  discovered: readonly string[],
): SeenDiff {
  const current = [...new Set(discovered)];
  if (!current.length) return { seeded: false, newIds: [], next: [...(stored ?? [])] };
  if (stored === undefined)
    return { seeded: true, newIds: [], next: current.slice(0, maxSeenIds) };
  const seen = new Set(stored);
  const newIds = current.filter((id) => !seen.has(id));
  // Oldest ids fall off first if the (unrealistically large) cap is reached.
  const next = [...stored, ...newIds].slice(-maxSeenIds);
  return { seeded: false, newIds, next };
}

/** Tolerant load of the persisted seen sets: bad entries are dropped. */
export function loadSeenModels(raw: unknown): Partial<Record<Source, string[]>> {
  const out: Partial<Record<Source, string[]>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>))
    if ((key === "copilot" || key === "opencode") && Array.isArray(value))
      out[key] = value.filter((id): id is string => typeof id === "string").slice(0, maxSeenIds);
  return out;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Compare newly discovered models with the ones already known, within one
 * source (cost units never mix across sources). `rows` are the source's
 * comparison rows with checklist/free/used filters off; `newIds` are the
 * discovered ids from `diffSeen`. Variant rows of one model collapse to the
 * best-scoring row. Unscored models stay listed with a null score.
 */
export function newModelEntries(
  source: "copilot" | "opencode",
  rows: readonly Row[],
  available: readonly AvailableModel[],
  newIds: readonly string[],
  unit: CostUnit,
): NewModelEntry[] {
  if (!newIds.length) return [];
  const isNew = new Set(newIds);
  const freeIds = new Set(
    source === "opencode" ? available.filter((m) => m.freeTier).map((m) => m.id) : [],
  );
  const existing = rows
    .filter((r) => !isNew.has(r.modelId) && r.score !== null)
    .map((r) => r.score as number);
  const best = existing.length ? Math.max(...existing) : null;
  const mid = existing.length ? median(existing) : null;
  const allScores = rows.filter((r) => r.score !== null).map((r) => r.score as number);

  const byBase = new Map<string, Row>();
  for (const row of rows) {
    if (!isNew.has(row.modelId)) continue;
    const key = row.baseModelId || baseModelIdOf(row.modelId);
    const held = byBase.get(key);
    if (!held || (row.score ?? -Infinity) > (held.score ?? -Infinity)) byBase.set(key, row);
  }
  const entries: NewModelEntry[] = [];
  for (const [baseId, row] of byBase) {
    const score = row.score;
    entries.push({
      id: baseId,
      modelId: row.modelId,
      name: row.name,
      source,
      free:
        source === "opencode" &&
        rows.some(
          (r) =>
            (r.baseModelId || baseModelIdOf(r.modelId)) === baseId &&
            freeIds.has(r.modelId),
        ),
      score,
      cost: row.cost,
      unit,
      rank: score === null ? null : 1 + allScores.filter((s) => s > score).length,
      scored: allScores.length,
      deltaBest: score === null || best === null ? null : score - best,
      deltaMedian: score === null || mid === null ? null : score - mid,
      frontier: row.frontier,
    });
  }
  // Free first, then by score (unscored last), then name — deterministic.
  return entries.sort(
    (a, b) =>
      Number(b.free) - Number(a.free) ||
      (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
      a.name.localeCompare(b.name),
  );
}

/** Merge a fresh detection into a still-pending (undismissed) report. */
export function mergeReports(
  pending: NewModelsReport | undefined,
  fresh: NewModelsReport,
): NewModelsReport {
  if (!pending) return fresh;
  const ids = new Set(fresh.entries.map((e) => `${e.source}:${e.id}`));
  return {
    ...fresh,
    entries: [
      ...fresh.entries,
      ...pending.entries.filter((e) => !ids.has(`${e.source}:${e.id}`)),
    ],
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Tolerant load of the pending report; anything malformed yields undefined. */
export function loadNewModelsReport(raw: unknown): NewModelsReport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<NewModelsReport>;
  if (!finite(r.detectedAt) || !Array.isArray(r.entries)) return undefined;
  const entries = r.entries.filter(
    (e): e is NewModelEntry =>
      !!e &&
      typeof e === "object" &&
      typeof e.id === "string" &&
      typeof e.name === "string" &&
      (e.source === "copilot" || e.source === "opencode") &&
      typeof e.free === "boolean" &&
      (e.score === null || finite(e.score)) &&
      (e.cost === null || finite(e.cost)) &&
      typeof e.unit === "string",
  );
  if (!entries.length) return undefined;
  return {
    detectedAt: r.detectedAt,
    benchmarkVersion: typeof r.benchmarkVersion === "string" ? r.benchmarkVersion : null,
    entries: entries.slice(0, 200),
  };
}

const sourceLabel = (source: Source) => (source === "opencode" ? "OpenCode" : "Copilot");
const points = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

/** One entry as text, e.g. "Foo (FREE, index 52.1, +4.0 vs best existing)". */
export function describeEntry(entry: NewModelEntry): string {
  const bits: string[] = [];
  if (entry.free) bits.push("FREE");
  if (entry.score === null) bits.push("no benchmark score yet");
  else {
    bits.push(`index ${entry.score.toFixed(1)}`);
    if (entry.deltaBest !== null)
      bits.push(
        entry.deltaBest > 0
          ? `${points(entry.deltaBest)} above best existing`
          : entry.deltaBest === 0
            ? "ties best existing"
            : `${points(entry.deltaBest)} vs best existing`,
      );
  }
  return `${entry.name} (${bits.join(", ")})`;
}

/** One-line notification text; benchmark caveat included only when relevant. */
export function summarizeNewModels(report: NewModelsReport): string {
  const parts: string[] = [];
  for (const source of ["copilot", "opencode"] as const) {
    const list = report.entries.filter((e) => e.source === source);
    if (!list.length) continue;
    const shown = list.slice(0, summaryLimit).map(describeEntry).join("; ");
    const more = list.length > summaryLimit ? `; +${list.length - summaryLimit} more` : "";
    const free = list.filter((e) => e.free).length;
    parts.push(
      `${sourceLabel(source)}: ${list.length} new model${list.length === 1 ? "" : "s"}` +
        `${free ? ` (${free} free)` : ""} — ${shown}${more}`,
    );
  }
  return `New models available. ${parts.join(" · ")}`;
}
