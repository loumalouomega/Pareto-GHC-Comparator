import { validSnapshot } from "./api";
import type { Benchmark, Preset, ScoreDrift, Snapshot } from "./types";
/**
 * Drift deltas smaller than this many index points read as "within
 * measurement noise" instead of implying a real change. Basis: Artificial
 * Analysis publishes a 95% confidence interval of less than ±1% for the
 * Intelligence Index (see its intelligence-benchmarking methodology); an
 * absolute 1-point threshold is conservative relative to that across the
 * observed 20–60 score range, and applies uniformly to every preset since
 * no per-preset interval is published. Never a per-model figure: the
 * upstream Free API exposes no confidence interval for language models.
 */
export const noiseThreshold = 1;
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
    const delta =
      prevScore !== null && currScore !== null ? currScore - prevScore : null;
    out[b.id] = {
      prevScore,
      delta,
      noisy: delta !== null && Math.abs(delta) < noiseThreshold,
    };
  }
  return out;
}
