import { compare, parseOptions, sortRowsByEfficiency } from "./compare";
import { buildGroups } from "./groups";
import { recommend } from "./recommend";
import { catalogDate } from "./catalog";
import { projectScenario, scenarioDelta } from "./plans";
import { normalizeCost, type NormalizedCost } from "./normalize";
import type {
  Options,
  AvailableModel,
  Benchmark,
  ByokStore,
  Row,
} from "./types";
export type Side = "A" | "B";
export interface ComparisonOption {
  name: string;
  options: Options;
  mappings: Record<string, string>;
  pins: Record<string, string[]>;
  excluded: Record<string, string[]>;
  selected?: string;
}
export interface ComparisonStore {
  version: 1;
  enabled: boolean;
  active: Side;
  /** Show each side's selected cost as a USD equivalent; off by default. */
  normalize: boolean;
  sides: Record<Side, ComparisonOption>;
}
export function loadComparison(raw: unknown): ComparisonStore | undefined {
  try {
    const v = raw as ComparisonStore;
    if (
      !v ||
      v.version !== 1 ||
      typeof v.enabled !== "boolean" ||
      !["A", "B"].includes(v.active)
    )
      return;
    const sides = {} as Record<Side, ComparisonOption>;
    for (const side of ["A", "B"] as const) {
      const s = v.sides[side];
      if (
        !s ||
        typeof s.name !== "string" ||
        !s.name.trim() ||
        s.name.length > 60
      )
        return;
      const maps = (raw: unknown, array: boolean) => {
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.keys(raw).length > 5000
        )
          throw Error();
        for (const [key, value] of Object.entries(raw)) {
          if (
            key.length > 1000 ||
            (array
              ? !Array.isArray(value) ||
                value.length > 5000 ||
                value.some((x) => typeof x !== "string" || x.length > 1000)
              : typeof value !== "string" || value.length > 1000)
          )
            throw Error();
        }
        return structuredClone(raw);
      };
      sides[side] = {
        name: s.name.trim(),
        options: parseOptions(s.options),
        mappings: maps(s.mappings, false) as ComparisonOption["mappings"],
        pins: maps(s.pins, true) as ComparisonOption["pins"],
        excluded: maps(s.excluded, true) as ComparisonOption["excluded"],
      };
      if (s.selected !== undefined) {
        if (typeof s.selected !== "string" || s.selected.length > 1000) return;
        sides[side].selected = s.selected;
      }
    }
    sides.B.options.preset = sides.A.options.preset;
    sides.B.options.display.chart = sides.A.options.display.chart;
    return {
      version: 1,
      enabled: v.enabled,
      active: v.active,
      normalize: v.normalize === true,
      sides,
    };
  } catch {
    return;
  }
}
export function optionResult(
  option: ComparisonOption,
  available: AvailableModel[],
  benchmarks: Benchmark[],
  byok: ByokStore,
  usedCounts: Map<string, number>,
) {
  const { options, mappings, pins } = option;
  const excluded = option.excluded[options.source] ?? [];
  const structure = compare(
    available,
    benchmarks,
    { ...options, filter: "", onlyMine: false, freeOnly: false },
    mappings,
    undefined,
    { pins },
  );
  const unsorted = compare(
    available,
    benchmarks,
    options,
    mappings,
    undefined,
    { pins, excluded, byok, usedCounts },
  );
  const rows =
    options.display.sort === "efficiency"
      ? sortRowsByEfficiency(unsorted)
      : unsorted;
  const recommendation = recommend(rows, options);
  const selectedRow = rows.find((r) => r.id === option.selected);
  const recommendedRow = recommendation.modelIds[0]
    ? rows.find((r) => r.id === recommendation.modelIds[0])
    : undefined;
  const firstComparableRow = rows.find(
    (r) => r.cost !== null && r.score !== null,
  );
  const rowOrigin: "selected" | "recommended" | "first-comparable" = selectedRow
    ? "selected"
    : recommendedRow
      ? "recommended"
      : "first-comparable";
  const row = selectedRow ?? recommendedRow ?? firstComparableRow;
  const selected = row?.id;
  return {
    name: option.name,
    options,
    rows,
    recommendation,
    selected,
    groups: buildGroups(available, excluded, rows, structure),
    structureIds: [
      ...available.map((a) => a.id),
      ...structure.map((r) => r.id),
    ],
    scenario: projectScenario({
      scenario: options.scenario,
      options,
      row,
      rowOrigin,
      catalogDate,
    }),
  };
}
export type OptionResult = ReturnType<typeof optionResult> & {
  discoveryError?: string;
};
/** The selected row's cost as a USD equivalent, for panels and exports. */
export function selectedCost(result: OptionResult): NormalizedCost {
  const row = result.rows.find((r) => r.id === result.selected);
  return normalizeCost(row?.cost, result.options.billing, result.options.display.chart);
}
/**
 * Why a cost basis or workload difference blocks a native cost delta between
 * two same-billing options. Shared by the native delta and the USD delta, so
 * a converted comparison still requires matching basis/workload.
 */
function basisReason(a: OptionResult, b: OptionResult): string {
  if (a.options.display.chart !== b.options.display.chart)
    return "Different cost bases.";
  if (
    a.options.billing === "legacy" &&
    b.options.billing === "legacy" &&
    a.options.plan !== b.options.plan
  )
    return "Different legacy plans.";
  if (
    a.options.display.chart === "workload" &&
    a.options.billing !== "legacy" &&
    b.options.billing !== "legacy" &&
    JSON.stringify(a.options.tokens) !== JSON.stringify(b.options.tokens)
  )
    return "Different workloads: scenario estimates, not a cost delta.";
  return "";
}
const round = (x: number) => Math.round(x * 1e10) / 1e10;
/**
 * Optional B minus A of each side's USD-equivalent selected cost. Only
 * computed when `normalize` is set; still requires the same cost basis and
 * (for workload view) the same tokens as the native delta, since converting
 * units doesn't make different workloads comparable.
 */
function usdDelta(a: OptionResult, b: OptionResult) {
  const A = selectedCost(a),
    B = selectedCost(b);
  const reason =
    a.options.billing === b.options.billing
      ? "Same billing unit: see the cost delta."
      : A.status === "unavailable"
        ? `A not converted: ${A.reason}`
        : B.status === "unavailable"
          ? `B not converted: ${B.reason}`
          : basisReason(a, b);
  return {
    A,
    B,
    delta: reason ? null : round((B as { usd: number }).usd - (A as { usd: number }).usd),
    reason:
      reason ||
      "USD equivalent at the documented pay-as-you-go AI-credit rate; included allowance and plan fee not counted.",
  };
}
export function comparisonDelta(
  a: OptionResult,
  b: OptionResult,
  normalize = false,
) {
  const x = a.rows.find((r) => r.id === a.selected),
    y = b.rows.find((r) => r.id === b.selected);
  const reason =
    a.options.billing !== b.options.billing
      ? "Different billing units."
      : basisReason(a, b);
  const delta = (x: number | null | undefined, y: number | null | undefined) =>
    typeof x === "number" && typeof y === "number" ? y - x : null;
  return {
    score: delta(x?.score, y?.score),
    cost: reason ? null : delta(x?.cost, y?.cost),
    reason:
      reason ||
      (x?.cost == null || y?.cost == null ? "Selected cost unavailable." : ""),
    direction: "B minus A",
    // Independent of the selected-row cost delta above: the monthly spending
    // scenario compares each option's own plan/allowance, not model cost.
    scenario: scenarioDelta(a.scenario, b.scenario),
    // Optional USD-equivalent delta, independent of the native cost delta
    // above; null unless the caller opts in via `normalize`.
    usd: normalize ? usdDelta(a, b) : null,
  };
}
