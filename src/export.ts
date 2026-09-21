import { taskMix } from "./compare";
import { normalizeCost, type NormalizedCost } from "./normalize";
import { costUnit } from "./types";
import type {
  ChartType,
  CostUnit,
  Options,
  RecommendationResult,
  Row,
  ScenarioResult,
  Tokens,
} from "./types";

/** Export snapshot schema version. v1 identified single-option snapshots and
 * v2 pair snapshots by version number alone. v3 adds an explicit `kind`
 * discriminator ("single" | "comparison"), a `costBasis` block (native unit,
 * chart basis, configured vs. effective token mix, legacy plan) on every
 * option, per-row `pricingIssue`, and catalog/benchmark dates on every CSV
 * row. Unknown historical workload assumptions are never backfilled: v1/v2
 * files simply predate `costBasis`. Pair snapshots no longer embed the
 * webview checklist state (`groups`/`structureIds`), which is UI state, not
 * comparison record.
 */
export const snapshotSchemaVersion = 3;

export interface SnapshotMeta {
  source: Options["source"];
  preset: Options["preset"];
  billing: Options["billing"];
  catalogDate: string;
  staticRegistryDate: string;
  version?: string;
  fetchedAt?: number;
  planRegistryDate?: string;
  scenario?: ScenarioResult;
}

/** Dates stamped onto every CSV row, so a row never floats free of the
 * catalog/snapshot it was priced and matched against. */
export interface CsvProvenance {
  catalogDate?: string;
  staticRegistryDate?: string;
  version?: string;
  fetchedAt?: number;
}

/** Which token assumption produced an export's costs. */
export interface CostBasisInfo {
  /** Active chart view, or "legacy" when the per-interaction multiplier applies. */
  basis: ChartType | "legacy";
  /** Native billing unit of the exported costs (never a converted equivalent). */
  unit: CostUnit;
  /** Token mix configured in options (shown even while hidden in task view). */
  configuredTokens: Tokens;
  /** Tokens the exported costs were actually computed from; null for legacy
   * billing, whose per-interaction multiplier ignores the token mix. */
  effectiveTokens: Tokens | null;
  /** Legacy annual plan, set only when basis is "legacy". */
  legacyPlan: Options["plan"] | null;
  note: string;
}

export function costBasisOf(options: Options): CostBasisInfo {
  if (options.billing === "legacy")
    return {
      basis: "legacy",
      unit: costUnit(options.billing),
      configuredTokens: { ...options.tokens },
      effectiveTokens: null,
      legacyPlan: options.plan,
      note: "Legacy billing uses a per-interaction premium-request multiplier; the token mix does not apply.",
    };
  const task = options.display.chart === "task";
  return {
    basis: options.display.chart,
    unit: costUnit(options.billing),
    configuredTokens: { ...options.tokens },
    effectiveTokens: task ? { ...taskMix } : { ...options.tokens },
    legacyPlan: null,
    note: task
      ? "Fixed illustrative per-task mix (1,000 input + 1,000 output tokens); workload inputs are hidden in this view."
      : "Editable workload token estimate.",
  };
}

/**
 * Wraps a monthly spending scenario for export with an explicit label, so it
 * never reads as a bill or measured cost alongside the comparison rows.
 */
export function scenarioExport(result: ScenarioResult) {
  return {
    label: "Estimated monthly spending scenario (projection, not a bill)",
    ...result,
  };
}

function cell(value: string): string {
  return /[",\n\r]/.test(value) || /^(=|\+|-|@)/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

const csvHeader = [
  "model",
  "model_id",
  "provider",
  "tested_variant",
  "benchmark_id",
  "score",
  "score_preset",
  "cost",
  "cost_unit",
  "cost_tier",
  "frontier",
  "recommended",
  "mapping_status",
  "reasons",
  "pricing_status",
  "pricing_source",
  // Provenance-complete tail: cost basis, configured vs. effective token mix
  // (effective empty for legacy billing), and catalog/benchmark dates per row.
  "cost_basis",
  "workload_input",
  "workload_read",
  "workload_write",
  "workload_output",
  "effective_input",
  "effective_read",
  "effective_write",
  "effective_output",
  "catalog_date",
  "static_registry_date",
  "benchmark_version",
  "benchmark_fetched_at",
  "pricing_issue",
];

/** Single-option CSV header line, reused as the pair-CSV row section so both
 * stay in lockstep when columns are added. */
export function csvHeaderLine(): string {
  return csvHeader.join(",");
}

function tokenCells(tokens: Tokens | null): string[] {
  return tokens
    ? [tokens.input, tokens.read, tokens.write, tokens.output].map(String)
    : ["", "", "", ""];
}

function csvRow(
  r: Row,
  options: Options,
  recommended: Set<string>,
  provenance: CsvProvenance = {},
): string {
  const basis = costBasisOf(options);
  return [
    r.name,
    r.id,
    r.provider,
    r.benchmark?.name ?? "",
    r.benchmark?.id ?? "",
    r.score === null ? "" : String(r.score),
    options.preset,
    r.cost === null ? "" : String(r.cost),
    basis.unit,
    r.tier ?? "",
    r.frontier ? "yes" : "no",
    recommended.has(r.id) ? "yes" : "no",
    r.mappingStatus,
    r.reasons.join(" "),
    r.pricing?.status ?? "",
    r.pricing?.source ?? "",
    basis.basis,
    ...tokenCells(basis.configuredTokens),
    ...tokenCells(basis.effectiveTokens),
    provenance.catalogDate ?? "",
    provenance.staticRegistryDate ?? "",
    provenance.version ?? "",
    provenance.fetchedAt === undefined ? "" : String(provenance.fetchedAt),
    r.pricing?.issue ?? "",
  ]
    .map(cell)
    .join(",");
}

export function exportCsv(
  rows: Row[],
  options: Options,
  recommended: Set<string> = new Set(),
  provenance: CsvProvenance = {},
): string {
  const lines = [csvHeader.join(",")];
  for (const r of rows) lines.push(csvRow(r, options, recommended, provenance));
  return lines.join("\n") + "\n";
}

/** Curated row projection shared by single and pair snapshots, so both
 * round-trip the tested benchmark variant, mapping status/reasons, and
 * pricing source/issue/provenance intact. */
export function snapshotRow(r: Row, recommended: Set<string>) {
  return {
    id: r.id,
    modelId: r.modelId,
    name: r.name,
    provider: r.provider,
    benchmark: r.benchmark
      ? { id: r.benchmark.id, name: r.benchmark.name }
      : null,
    score: r.score,
    cost: r.cost,
    tier: r.tier ?? null,
    frontier: r.frontier,
    recommended: recommended.has(r.id),
    mappingStatus: r.mappingStatus,
    reasons: r.reasons,
    pricingStatus: r.pricing?.status ?? null,
    pricingSource: r.pricing?.source ?? null,
    pricingIssue: r.pricing?.issue ?? null,
    // Only BYOK rows carry provenance beyond the source label above;
    // null for everything else.
    pricingProvenance: r.pricing?.byok?.provenance ?? null,
  };
}

export function exportSnapshot(
  rows: Row[],
  options: Options,
  recommended: Set<string>,
  meta: SnapshotMeta,
): string {
  return (
    JSON.stringify(
      {
        version: snapshotSchemaVersion,
        kind: "single",
        exportedAt: new Date().toISOString(),
        disclaimer:
          "Illustrative comparison from published benchmarks and catalog rates; not measured task cost or an account bill.",
        source: meta.source,
        preset: meta.preset,
        billing: meta.billing,
        costBasis: costBasisOf(options),
        catalogDate: meta.catalogDate,
        staticRegistryDate: meta.staticRegistryDate,
        planRegistryDate: meta.planRegistryDate ?? null,
        benchmarkVersion: meta.version ?? null,
        benchmarkFetchedAt: meta.fetchedAt ?? null,
        scenario: meta.scenario ? scenarioExport(meta.scenario) : null,
        rows: rows.map((r) => snapshotRow(r, recommended)),
      },
      null,
      2,
    ) + "\n"
  );
}
export function exportBadge(
  rows: Row[],
  options: Options,
  meta: Pick<SnapshotMeta, "source" | "preset">,
): string {
  const comparable = rows.filter(
    (r): r is Row & { cost: number; score: number } =>
      r.cost !== null &&
      r.score !== null &&
      Number.isFinite(r.cost) &&
      Number.isFinite(r.score),
  );
  const unit = costUnit(options.billing);
  const best = comparable.length
    ? [...comparable].sort((a, b) => b.score - a.score || a.cost - b.cost)[0]
    : undefined;
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        label: `pareto ${meta.source} ${meta.preset}`,
        message: best
          ? `${best.name.slice(0, 120)}: ${best.score} pts at ${best.cost} ${unit}`
          : "no comparable models",
        color: best ? (best.frontier ? "brightgreen" : "blue") : "lightgrey",
        // Explicit unit and cost basis; the badge stays a compact summary —
        // CSV/snapshot carry the full round-trippable comparison record.
        unit,
        basis: options.display.chart,
      },
      null,
      2,
    ) + "\n"
  );
}

/** Per-row USD-equivalent state, including "off" when the comparison toggle is
 * unset. Rows convert independently of which row is selected. */
export type NormalizationState = NormalizedCost | { status: "off" };

export interface PairUsdDelta {
  A: NormalizedCost;
  B: NormalizedCost;
  delta: number | null;
  reason: string;
}

export interface PairSideInput {
  side: "A" | "B";
  name: string;
  options: Options;
  rows: Row[];
  recommendation: RecommendationResult;
  selected?: string;
  scenario: ScenarioResult;
  costNormalization: NormalizationState;
  availabilityNote: string;
  pricingNote: string;
  discoveryError: string;
}

export interface PairMeta extends CsvProvenance {
  planRegistryDate?: string;
  /** Whether per-row USD equivalents are included ("off" otherwise). */
  normalize: boolean;
  usdCostDelta: PairUsdDelta | null;
}

function pairAssumptions(side: PairSideInput, meta: PairMeta) {
  return {
    side: side.side,
    name: side.name,
    options: side.options,
    unit: costUnit(side.options.billing),
    costBasis: costBasisOf(side.options),
    discoveryError: side.discoveryError,
    availabilityNote: side.availabilityNote,
    pricingNote: side.pricingNote,
    catalogDate: meta.catalogDate,
    staticRegistryDate: meta.staticRegistryDate,
    planRegistryDate: meta.planRegistryDate,
    scenario:
      side.scenario.status === "off"
        ? side.scenario
        : scenarioExport(side.scenario),
    costNormalization: side.costNormalization,
    usdCostDelta: meta.usdCostDelta,
    benchmarkVersion: meta.version,
    benchmarkFetchedAt: meta.fetchedAt,
  };
}

/** Two-option CSV: one `option,assumptions,...` header plus every side's rows
 * serialized exactly like single-option rows, so each row keeps its own
 * native unit, cost basis, and provenance even when the sides bill
 * differently. */
export function exportPairCsv(
  sides: PairSideInput[],
  meta: PairMeta,
): string {
  const header =
    "option,assumptions,usd_equivalent,usd_conversion," + csvHeaderLine();
  // Derived from the header, not hardcoded, so an empty-option row always
  // pads to the same width as a populated one even if columns are added.
  const dataColumns = header.split(",").length - 4;
  const lines = [header];
  for (const side of sides) {
    const label = JSON.stringify(pairAssumptions(side, meta));
    const recommended = new Set(side.recommendation.modelIds);
    if (!side.rows.length) {
      lines.push(
        `${side.side},"${label.replace(/"/g, '""')}",,,${Array(dataColumns).fill("").join(",")}`,
      );
      continue;
    }
    for (const row of side.rows) {
      const n: NormalizationState = meta.normalize
        ? normalizeCost(
            row.cost,
            side.options.billing,
            side.options.display.chart,
          )
        : { status: "off" };
      const usdEquivalent =
        n.status === "native" || n.status === "converted" ? String(n.usd) : "";
      const body = exportCsv([row], side.options, recommended, meta);
      lines.push(
        `${side.side},"${label.replace(/"/g, '""')}",${usdEquivalent},${n.status},` +
          body.slice(body.indexOf("\n") + 1).trimEnd(),
      );
    }
  }
  return lines.join("\n") + "\n";
}

/** Two-option snapshot (schema v3, kind "comparison"): both options with
 * their own unit, cost basis, rows, recommendations, scenarios, and
 * assumptions, plus the top-level USD delta. */
export function exportPairSnapshot(
  sides: PairSideInput[],
  meta: PairMeta,
): string {
  return (
    JSON.stringify(
      {
        version: snapshotSchemaVersion,
        kind: "comparison",
        exportedAt: new Date().toISOString(),
        disclaimer:
          "Illustrative comparison, not measured task cost or an account bill.",
        options: sides.map((side) => ({
          side: side.side,
          name: side.name,
          options: side.options,
          unit: costUnit(side.options.billing),
          costBasis: costBasisOf(side.options),
          rows: side.rows.map((r) =>
            snapshotRow(r, new Set(side.recommendation.modelIds)),
          ),
          recommendation: side.recommendation,
          selected: side.selected ?? null,
          scenario:
            side.scenario.status === "off"
              ? side.scenario
              : scenarioExport(side.scenario),
          costNormalization: side.costNormalization,
          availabilityNote: side.availabilityNote,
          pricingNote: side.pricingNote,
          discoveryError: side.discoveryError,
          catalogDate: meta.catalogDate,
          staticRegistryDate: meta.staticRegistryDate,
          planRegistryDate: meta.planRegistryDate ?? null,
          benchmarkVersion: meta.version ?? null,
          benchmarkFetchedAt: meta.fetchedAt ?? null,
        })),
        usdCostDelta: meta.usdCostDelta,
      },
      null,
      2,
    ) + "\n"
  );
}
