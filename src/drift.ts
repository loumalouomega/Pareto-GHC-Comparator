import { validSnapshot } from "./api";
import type { Benchmark, Preset, ScoreDrift, Snapshot } from "./types";
export function selectPrevSnapshot(
  prevRaw: unknown,
  curr: Snapshot,
): Snapshot | undefined {
  if (!validSnapshot(prevRaw)) return undefined;
  if (prevRaw.fetchedAt >= curr.fetchedAt) return undefined;
  return prevRaw;
}
export function driftOf(
  prev: Snapshot | undefined,
  curr: Benchmark[],
  preset: Preset,
): Record<string, ScoreDrift> {
  const out: Record<string, ScoreDrift> = {};
  if (!prev) return out;
  const byId = new Map(prev.models.map((m) => [m.id, m]));
  for (const b of curr) {
    const p = byId.get(b.id);
    const prevScore = p ? p.scores[preset] : null;
    const currScore = b.scores[preset];
    out[b.id] = {
      prevScore,
      delta:
        prevScore !== null && currScore !== null
          ? currScore - prevScore
          : null,
    };
  }
  return out;
}
