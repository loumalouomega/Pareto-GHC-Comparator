import type { Row } from "./types";

/**
 * Pure, webview-safe "best value" views over the rows already on screen
 * (after checklist exclusions, the text filter and the display filters). No
 * host surface, storage or export: like the sensitivity card these are
 * derived on demand from `ViewState.rows`, in that view's own native cost
 * unit, and never blend rows of different units.
 */

type Comparable = Pick<Row, "id" | "name" | "cost" | "score"> & {
  cost: number;
  score: number;
};

const comparable = (rows: Row[]): Comparable[] =>
  rows.filter(
    (r): r is Row & { cost: number; score: number } =>
      r.cost !== null &&
      r.score !== null &&
      Number.isFinite(r.cost) &&
      Number.isFinite(r.score),
  );

const byScoreCostName = (a: Comparable, b: Comparable) =>
  b.score - a.score || a.cost - b.cost || a.name.localeCompare(b.name);

export interface LadderModel {
  id: string;
  name: string;
  cost: number;
  score: number;
}

/**
 * One budget band along the Pareto frontier. A budget of at least `from`
 * (and below `to`, when there is a next band) buys `pick`; `runnerUp` is the
 * best other displayed model that also fits at `from`.
 */
export interface LadderTier {
  /** Lowest budget at which this pick is affordable, in the view's native cost unit. */
  from: number;
  /** Next band's `from`, or null for the top band. */
  to: number | null;
  pick: LadderModel;
  /** Other rows with exactly the pick's cost and score; exact ties stay on the frontier. */
  tied: LadderModel[];
  runnerUp: LadderModel | null;
}

const model = (r: Comparable): LadderModel => ({
  id: r.id,
  name: r.name,
  cost: r.cost,
  score: r.score,
});

/**
 * The frontier as a lookup table: for each budget band, the highest-scoring
 * displayed model you can afford. Uses the same dominance rule as
 * `markFrontier` (equal-or-better cost and score with one strict
 * improvement), so a tier's pick is exactly what `recommend` returns in
 * budget mode when the budget equals the tier's `from`. Rows without a
 * finite cost and score are left out, never guessed.
 */
export function budgetLadder(rows: Row[]): LadderTier[] {
  const all = comparable(rows);
  const frontier = all.filter(
    (a) =>
      !all.some(
        (b) =>
          b.cost <= a.cost &&
          b.score >= a.score &&
          (b.cost < a.cost || b.score > a.score),
      ),
  );
  // Ties on both axes share a band; distinct bands have strictly rising cost
  // and score once dominated points are gone.
  const groups = new Map<string, Comparable[]>();
  for (const f of frontier) {
    const key = `${f.cost}|${f.score}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const bands = [...groups.values()]
    .map((g) => [...g].sort(byScoreCostName))
    .sort((a, b) => a[0].cost - b[0].cost);
  return bands.map((band, i) => {
    const [pick, ...tied] = band;
    const runnerUp =
      all
        .filter((r) => r.cost <= pick.cost && !band.includes(r))
        .sort(byScoreCostName)[0] ?? null;
    return {
      from: pick.cost,
      to: i + 1 < bands.length ? bands[i + 1][0].cost : null,
      pick: model(pick),
      tied: tied.map(model),
      runnerUp: runnerUp ? model(runnerUp) : null,
    };
  });
}

export interface CapabilityEntry {
  id: string;
  name: string;
  score: number;
  /** Null when the row is unpriced: it still ranks on score, which needs no cost. */
  cost: number | null;
  frontier: boolean;
}

export interface CapabilityRanking {
  entries: CapabilityEntry[];
  /** Scored rows before the limit was applied. */
  total: number;
}

/**
 * Score-only ranking of the displayed rows, ignoring cost entirely, with
 * frontier membership carried for a non-colour marker. Unlike `freeBar`
 * (OpenCode free-tier only) this works for every source, and only a score is
 * required, so unpriced rows still appear. Sorted by score descending, then
 * cost ascending (unpriced last), then name; `limit` caps the list.
 */
export function rawCapability(rows: Row[], limit?: number): CapabilityRanking {
  const scored = rows
    .filter(
      (r): r is Row & { score: number } =>
        r.score !== null && Number.isFinite(r.score),
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      score: r.score,
      cost: r.cost !== null && Number.isFinite(r.cost) ? r.cost : null,
      frontier: r.frontier,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.cost ?? Number.POSITIVE_INFINITY) -
          (b.cost ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    );
  return {
    entries: limit === undefined ? scored : scored.slice(0, limit),
    total: scored.length,
  };
}
