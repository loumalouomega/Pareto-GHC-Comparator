import { noiseThreshold } from "./drift";
import type {
  Benchmark,
  ChangelogChange,
  ChangelogEntry,
  ChangelogField,
  ChangelogModel,
  Preset,
  Snapshot,
} from "./types";

/** Entries kept in storage, newest first. */
export const changelogCap = 90;
/** Entries served to the webview. */
export const changelogViewCap = 20;
/** Per-list cap inside one entry; the true counts stay in `omitted`. */
export const changelogListCap = 100;

const presets: Preset[] = ["general", "coding", "agentic"];
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const modelOf = (b: Benchmark): ChangelogModel => ({
  id: b.id,
  name: b.name,
  provider: b.provider,
  general: b.scores.general,
});

/**
 * What changed between two validated snapshots, on stable benchmark ids.
 * Score changes smaller than `noiseThreshold` stay silent (the same rule the
 * drift labels use), a null on either side is unknown rather than a change,
 * and AA's own cost per task is compared only when both sides have it. When
 * the Intelligence Index version differs the scores are on different scales,
 * so only additions and removals are recorded and `rebased` says why.
 */
export function diffSnapshots(prev: Snapshot, curr: Snapshot): ChangelogEntry {
  const rebased = prev.version !== curr.version;
  const before = new Map(prev.models.map((m) => [m.id, m]));
  const after = new Map(curr.models.map((m) => [m.id, m]));
  const added = curr.models.filter((m) => !before.has(m.id)).map(modelOf);
  const removed = prev.models.filter((m) => !after.has(m.id)).map(modelOf);
  const changed: ChangelogChange[] = [];
  if (!rebased) {
    for (const b of curr.models) {
      const p = before.get(b.id);
      if (!p) continue;
      const fields: ChangelogChange["fields"] = [];
      for (const preset of presets) {
        const from = p.scores[preset];
        const to = b.scores[preset];
        if (
          finite(from) &&
          finite(to) &&
          Math.abs(to - from) >= noiseThreshold
        )
          fields.push({ field: preset, from, to });
      }
      if (
        finite(p.costPerTask) &&
        finite(b.costPerTask) &&
        p.costPerTask !== b.costPerTask
      )
        fields.push({
          field: "costPerTask",
          from: p.costPerTask,
          to: b.costPerTask,
        });
      if (fields.length)
        changed.push({ id: b.id, name: b.name, provider: b.provider, fields });
    }
  }
  const cap = <T>(list: T[]) => list.slice(0, changelogListCap);
  return {
    at: curr.fetchedAt,
    version: curr.version,
    prevVersion: prev.version,
    rebased,
    added: cap(added),
    removed: cap(removed),
    changed: cap(changed),
    omitted: {
      added: Math.max(0, added.length - changelogListCap),
      removed: Math.max(0, removed.length - changelogListCap),
      changed: Math.max(0, changed.length - changelogListCap),
    },
  };
}

/** A re-base is worth recording on its own: scores stop being comparable. */
export const isEmptyEntry = (e: ChangelogEntry): boolean =>
  !e.rebased && !e.added.length && !e.removed.length && !e.changed.length;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length < 1000;
const validModel = (v: unknown): v is ChangelogModel =>
  object(v) &&
  text(v.id) &&
  text(v.name) &&
  text(v.provider) &&
  (v.general === null || finite(v.general));
const validChange = (v: unknown): v is ChangelogChange =>
  object(v) &&
  text(v.id) &&
  text(v.name) &&
  text(v.provider) &&
  Array.isArray(v.fields) &&
  v.fields.every(
    (f) =>
      object(f) &&
      [...presets, "costPerTask"].includes(f.field as ChangelogField) &&
      finite(f.from) &&
      finite(f.to),
  );
const count = (v: unknown) => (finite(v) && v >= 0 ? Math.floor(v) : 0);

/** One stored entry, or undefined when it is not a well-formed record. */
function loadEntry(v: unknown): ChangelogEntry | undefined {
  if (
    !object(v) ||
    !finite(v.at) ||
    v.at <= 0 ||
    !text(v.version) ||
    !text(v.prevVersion) ||
    !Array.isArray(v.added) ||
    !Array.isArray(v.removed) ||
    !Array.isArray(v.changed)
  )
    return undefined;
  const omitted = object(v.omitted) ? v.omitted : {};
  return {
    at: v.at,
    version: v.version,
    prevVersion: v.prevVersion,
    rebased: v.rebased === true,
    added: v.added.filter(validModel).slice(0, changelogListCap),
    removed: v.removed.filter(validModel).slice(0, changelogListCap),
    changed: v.changed.filter(validChange).slice(0, changelogListCap),
    omitted: {
      added: count(omitted.added),
      removed: count(omitted.removed),
      changed: count(omitted.changed),
    },
  };
}

/** Tolerant loader: bad entries drop individually, never the whole log. */
export function loadChangelog(raw: unknown): ChangelogEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw
    .map(loadEntry)
    .filter((e): e is ChangelogEntry => e !== undefined);
  const seen = new Set<number>();
  return entries
    .filter((e) => (seen.has(e.at) ? false : (seen.add(e.at), true)))
    .sort((a, b) => b.at - a.at)
    .slice(0, changelogCap);
}

/** Newest first, one entry per retrieval time, capped. Empty diffs add nothing. */
export function appendChangelog(
  existing: ChangelogEntry[],
  entry: ChangelogEntry,
): ChangelogEntry[] {
  if (isEmptyEntry(entry)) return existing;
  return [entry, ...existing.filter((e) => e.at !== entry.at)]
    .sort((a, b) => b.at - a.at)
    .slice(0, changelogCap);
}

/**
 * The benchmark ids in an entry that are on screen, so the log can say which
 * changes touch the current view. `inView` holds benchmark ids of displayed rows.
 */
export function affectedIds(
  entry: ChangelogEntry,
  inView: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      [...entry.added, ...entry.removed, ...entry.changed]
        .map((m) => m.id)
        .filter((id) => inView.has(id)),
    ),
  ];
}
