import { pinRowId } from "./compare";
import { noiseThreshold } from "./drift";
import type {
  MappingStatus,
  Row,
  Snapshot,
  Source,
} from "./types";
export type WatchChangeKind = "price" | "score" | "mapping" | "availability";
export interface WatchChange {
  modelId: string;
  name: string;
  kind: WatchChangeKind;
  before: string;
  after: string;
}
const mappingLabels: Record<MappingStatus, string> = {
  exact: "Exact match",
  inferred: "Inferred match (unverified)",
  user: "User selected",
  selection: "Needs selection",
  missing: "Missing benchmark",
};
/** Model-id namespaces each source discovers under; bare ids are Copilot's. */
const sourcePrefixes: { prefix: string; source: Source }[] = [
  { prefix: "opencode:", source: "opencode" },
  { prefix: "claude-code:", source: "claude-code" },
  { prefix: "codex:", source: "codex" },
  { prefix: "gemini-cli:", source: "gemini-cli" },
  { prefix: "cursor:", source: "cursor" },
  { prefix: "windsurf:", source: "windsurf" },
  { prefix: "aider:", source: "aider" },
  { prefix: "amazon-q:", source: "amazon-q" },
];
const pinSource = (modelId: string): Source =>
  sourcePrefixes.find((s) => modelId.startsWith(s.prefix))?.source ??
  "copilot";
const format = (v: number): string =>
  new Intl.NumberFormat("en", { maximumSignificantDigits: 5 }).format(v);
export interface WatchInput {
  pins: Record<string, string[]>;
  prevRows: Row[];
  currRows: Row[];
  availableIds: readonly string[];
  /** Whole-model exclusions: excluded pins stay silent instead of alerting. */
  excludedIds: readonly string[];
  /** Only same-source pins participate in availability alerts. */
  source: Source;
  /** Cost-unit noun for price lines (row costs stay in native units). */
  unit: string;
}
/**
 * Changes to pinned models between two renders of the same availability and
 * options, for opt-in refresh notifications. Price, score, and mapping are
 * diffed per pinned row id; rows missing on either side are skipped
 * (user-excluded rows must never alert). Availability is stateless: a pin
 * from the current source that is no longer discovered reads as
 * no-longer-available — pinning itself is the only history consulted, so
 * cross-source pins stay silent instead of false-alerting. Score deltas
 * under the shared noise threshold and null-score transitions stay silent.
 */
export function watchlistChanges(input: WatchInput): WatchChange[] {
  const { pins, prevRows, currRows, source, unit } = input;
  // Nothing comparable on the current side: without rows no pin can be
  // evaluated, and every absent pin would false-alert at once.
  if (!currRows.length) return [];
  const available = new Set(input.availableIds);
  const excluded = new Set(input.excludedIds);
  const prevById = new Map(prevRows.map((r) => [r.id, r]));
  const currById = new Map(currRows.map((r) => [r.id, r]));
  const changes: WatchChange[] = [];
  for (const [modelId, benchIds] of Object.entries(pins)) {
    if (!benchIds.length || excluded.has(modelId)) continue;
    const probe =
      currRows.find((r) => r.modelId === modelId) ??
      prevRows.find((r) => r.modelId === modelId);
    if (!available.has(modelId)) {
      // Same-source only: a pin from another source has no rows here and
      // must never read as disappeared. A pin stays reported until it is
      // unpinned or alerts are disabled — pinning itself is the history.
      if (pinSource(modelId) === source)
        changes.push({
          modelId,
          name: probe?.name ?? modelId,
          kind: "availability",
          before: "Discovered",
          after: "Not discovered",
        });
      continue;
    }
    for (const benchId of benchIds) {
      const id = pinRowId(modelId, benchId);
      const prev = prevById.get(id);
      const curr = currById.get(id);
      if (!prev || !curr) continue;
      const name = curr.name;
      if (
        prev.score !== null &&
        curr.score !== null &&
        Number.isFinite(prev.score) &&
        Number.isFinite(curr.score) &&
        prev.score !== curr.score &&
        Math.abs(curr.score - prev.score) >= noiseThreshold
      )
        changes.push({
          modelId,
          name,
          kind: "score",
          before: format(prev.score),
          after: format(curr.score),
        });
      if (
        prev.cost !== null &&
        curr.cost !== null &&
        Number.isFinite(prev.cost) &&
        Number.isFinite(curr.cost) &&
        prev.cost !== curr.cost
      )
        changes.push({
          modelId,
          name,
          kind: "price",
          before: `${format(prev.cost)} ${unit}`,
          after: `${format(curr.cost)} ${unit}`,
        });
      if (prev.mappingStatus !== curr.mappingStatus)
        changes.push({
          modelId,
          name,
          kind: "mapping",
          before: mappingLabels[prev.mappingStatus],
          after: mappingLabels[curr.mappingStatus],
        });
    }
  }
  const kindOrder: WatchChangeKind[] = [
    "price",
    "score",
    "mapping",
    "availability",
  ];
  return changes.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind),
  );
}
/** One-line-per-change summary citing both snapshots, for the notification. */
export function summarizeWatchChanges(
  changes: WatchChange[],
  prev: Snapshot,
  curr: Snapshot,
): string {
  const date = (t: number) => new Date(t).toLocaleString();
  const lines = changes.map((c) =>
    c.kind === "availability"
      ? `${c.name}: no longer discovered`
      : c.kind === "mapping"
        ? `${c.name}: mapping ${c.before} → ${c.after}`
        : c.kind === "score"
          ? `${c.name}: score ${c.before} → ${c.after}`
          : `${c.name}: price ${c.before} → ${c.after}`,
  );
  return `Watchlist changes (benchmarks v${prev.version} → v${curr.version}, retrieved ${date(prev.fetchedAt)} → ${date(curr.fetchedAt)}): ${lines.join("; ")}`;
}
