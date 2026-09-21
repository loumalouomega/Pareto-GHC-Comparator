import { recommend } from "./recommend";
import type { Options, Row, Tokens } from "./types";
/** Sweep granularity: output share 0–100% in these step counts. */
export const sensitivitySteps = 11;
/** Illustrative total when the workload has no input/output tokens to sweep. */
export const sensitivityFallbackTotal = 2000;
/**
 * Cost of one row at an arbitrary token mix, derived from its cost
 * breakdown rates (buckets disjoint, cache-write falls back to the input
 * rate, mirroring `estimate`). Rows without a breakdown but with a finite
 * cost (legacy multiplier rows) are mix-independent and stay constant.
 * Unpriced or unscored rows yield null and are excluded downstream by the
 * same comparable filter `recommend` uses.
 *
 * The sweep holds the row's current context tier: a mix that would cross a
 * long-context threshold the other way keeps the displayed rates, and
 * context-limit exclusion is not applied. Both are documented
 * approximations for a labelled what-if view, never measured cost.
 */
export function mixCost(
  row: Row,
  tokens: Tokens,
  billing: Options["billing"],
): number | null {
  if (row.score === null || !Number.isFinite(row.score)) return null;
  if (row.breakdown) {
    const r = row.breakdown.rates;
    const divisor = row.breakdown.divisor;
    if (!Number.isFinite(divisor) || divisor <= 0) return null;
    return (
      (tokens.input * r.input +
        tokens.read * r.read +
        tokens.write * (r.write ?? r.input) +
        tokens.output * r.output) /
      divisor
    );
  }
  if (
    billing === "legacy" &&
    row.cost !== null &&
    Number.isFinite(row.cost)
  )
    return row.cost;
  return null;
}
/** Row ids on the Pareto frontier under the same dominance rule as `markFrontier`. */
export function frontierIds(
  rows: Pick<Row, "id" | "cost" | "score">[],
): string[] {
  return rows
    .filter((a) => {
      const cost = a.cost;
      const score = a.score;
      return (
        cost !== null &&
        score !== null &&
        !rows.some(
          (b) =>
            b.cost !== null &&
            b.score !== null &&
            b.cost <= cost &&
            b.score >= score &&
            (b.cost < cost || b.score > score),
        )
      );
    })
    .map((r) => r.id);
}
export interface SensitivityStep {
  /** Output share of the swept total, 0–100. */
  share: number;
  tokens: Tokens;
  frontierIds: string[];
  recommendedIds: string[];
}
export interface SensitivityRange {
  from: number;
  to: number;
  frontierIds: string[];
  recommendedIds: string[];
}
const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();
/**
 * Sweep the output share of the workload total from 0% to 100%,
 * holding cache-read/write at their current values. Total defaults to the
 * current input + output tokens; callers pass the illustrative fallback
 * total when that is zero. Each step recomputes frontier membership and
 * the top recommendation (honouring the user's own Find-a-model settings)
 * at swept costs.
 */
export function sweepMix(
  rows: Row[],
  options: Options,
  total: number,
  steps: number = sensitivitySteps,
): SensitivityStep[] {
  const out: SensitivityStep[] = [];
  if (steps < 2 || !Number.isFinite(total) || total < 0) return out;
  for (let i = 0; i < steps; i++) {
    const share = Math.round((i / (steps - 1)) * 100);
    const output = Math.round((total * share) / 100);
    const tokens: Tokens = {
      input: total - output,
      read: options.tokens.read,
      write: options.tokens.write,
      output,
    };
    const swept = rows.map((r) => ({
      ...r,
      cost: mixCost(r, tokens, options.billing),
    }));
    const comparable = swept.filter(
      (r): r is Row & { cost: number; score: number } =>
        r.cost !== null &&
        r.score !== null &&
        Number.isFinite(r.cost) &&
        Number.isFinite(r.score),
    );
    out.push({
      share,
      tokens,
      frontierIds: frontierIds(comparable),
      recommendedIds: comparable.length
        ? recommend(swept, options).modelIds
        : [],
    });
  }
  return out;
}
/** Collapse consecutive steps with identical frontier + recommendation sets. */
export function compressBreakpoints(steps: SensitivityStep[]): SensitivityRange[] {
  const ranges: SensitivityRange[] = [];
  for (const s of steps) {
    const last = ranges[ranges.length - 1];
    if (
      last &&
      sameIds(last.frontierIds, s.frontierIds) &&
      sameIds(last.recommendedIds, s.recommendedIds)
    ) {
      last.to = s.share;
    } else {
      ranges.push({
        from: s.share,
        to: s.share,
        frontierIds: [...s.frontierIds],
        recommendedIds: [...s.recommendedIds],
      });
    }
  }
  return ranges;
}
