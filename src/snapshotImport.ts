import { matchesFilter, parseOptions, sortRowsByEfficiency } from "./compare";
import {
  comparisonDelta,
  overlayResult,
  type OptionResult,
  type Side,
} from "./comparison";
import { snapshotSchemaVersion, type CostBasisInfo } from "./export";
import type { NormalizedCost } from "./normalize";
import { sources } from "./sources";
import {
  costUnit,
  type Benchmark,
  type ChartType,
  type DisplaySettings,
  type HostMessage,
  type MappingStatus,
  type Options,
  type PricingInfo,
  type PricingIssue,
  type PricingSource,
  type PricingStatus,
  type RecommendationResult,
  type Row,
  type ScenarioResult,
  type Source,
  type ViewState,
} from "./types";

/**
 * Read-only reopen of an exported snapshot JSON (`src/export.ts`, schema
 * version 3). Pure and vscode-free: the host reads the file the user picked,
 * validates it, and renders it as a historical view that cannot be mistaken
 * for live data and cannot mutate saved state.
 *
 * Validation is strict about the record — version, kind, cost basis, rows,
 * embedded options — and tolerant about descriptions, so a readable file with
 * a missing caption opens with that caption shown as "unknown" instead of
 * being rejected or, worse, filled in with today's values. Nothing is
 * inferred: an imported row carries only what the export recorded, and the
 * banner quotes the file's own cost basis and registry dates.
 */

/** What a rejected file was, so the message can say why rather than "invalid". */
export type SnapshotImportFailureReason =
  | "invalid-json"
  | "not-a-snapshot"
  | "unsupported-version"
  | "unsupported-kind"
  | "corrupt";

export interface SnapshotImportFailure {
  reason: SnapshotImportFailureReason;
  /** User-facing explanation; never quotes file contents. */
  message: string;
  /** The version found, for an unsupported-version message. */
  found?: unknown;
}

export interface ImportedSnapshotBase {
  schemaVersion: number;
  /** ISO timestamp, or "unknown" when the file's is missing or unparseable. */
  exportedAt: string;
  /** The file's own illustrative-figures disclaimer, verbatim. */
  disclaimer: string;
  /** Registry dates as of the export; "unknown" when the file stated none. */
  catalogDate: string;
  staticRegistryDate: string;
  planRegistryDate: string;
  benchmarkVersion: string;
  benchmarkFetchedAt?: number;
}

/** One side of a two-option snapshot, exactly as the file recorded it. */
export interface ImportedSide {
  side: Side;
  name: string;
  options: Options;
  rows: Row[];
  /** Row ids the export flagged as recommended, in file order. */
  recommended: string[];
  selected?: string;
  scenario: ScenarioResult;
  costNormalization: NormalizedCost | { status: "off" };
  discoveryError: string;
}

export interface ImportedSingle extends ImportedSnapshotBase {
  kind: "single";
  source: Source;
  costBasis: CostBasisInfo;
  /** Options rebuilt from the file, with its exported cost basis enforced. */
  options: Options;
  rows: Row[];
  recommended: string[];
  scenario: ScenarioResult | null;
}

export interface ImportedComparison extends ImportedSnapshotBase {
  kind: "comparison";
  sides: Record<Side, ImportedSide>;
  /** Whether USD equivalents were on when the pair was exported. */
  normalize: boolean;
  delta: ReturnType<typeof comparisonDelta>;
  overlay: ReturnType<typeof overlayResult>;
}

export type ImportedSnapshot = ImportedSingle | ImportedComparison;

export type SnapshotImportResult =
  | { ok: true; snapshot: ImportedSnapshot }
  | { ok: false; failure: SnapshotImportFailure };

/** A parsed file plus the view-only state the panel keeps while showing it. */
export interface ImportedView {
  snapshot: ImportedSnapshot;
  /** Selected row id per side; never written to any saved state. */
  selected: Partial<Record<Side, string | undefined>>;
  /** Text filter over the exported rows (single-option snapshots only). */
  filter: string;
  /** Chart display toggles; a cost basis is never changed here. */
  display: DisplaySettings;
}

/** Host state the read-only view borrows for presentation only. */
export interface ImportedContext {
  /** Current options: only the display, recommendation, and scenario fields
   * are read, since the comparison itself comes from the file. */
  options: Options;
  hasKey: boolean;
  watchlistAlerts: boolean;
  fileName: string;
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Bounded non-empty string, so a hostile file cannot flood the UI. */
const text = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const number = (v: unknown, max = 1e12): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
const nullableNumber = (v: unknown): v is number | null =>
  v === null || number(v);
/** Epoch milliseconds, which exceed the cost/score bound above. */
const timestamp = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const stringList = (v: unknown, max = 50): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((x) => text(x, 1000));
const rangeOf = (v: unknown): boolean =>
  object(v) && number(v.low) && number(v.high);
/** A date the file stated, or "unknown" — never today's date. */
const dateText = (v: unknown): string =>
  text(v, 100) && Number.isFinite(Date.parse(v)) ? v : "unknown";
/** A short display label for a picked file, without its directory. */
export const importedFileName = (path: string): string =>
  path.split(/[/\\]/).pop() || path;

/** Rows in one snapshot file, bounded so a huge file cannot exhaust the host. */
const maxRows = 5000;
const mappingStatuses: MappingStatus[] = [
  "exact",
  "inferred",
  "user",
  "selection",
  "missing",
];
const pricingStatuses: PricingStatus[] = [
  "priced",
  "free",
  "byok",
  "unresolved",
  "not-comparable",
];
const pricingSources: PricingSource[] = [
  "copilot-catalog",
  "legacy-multiplier",
  "opencode-cli",
  "static-registry",
  "byok",
  "none",
];

/** Never throws: every rejection carries a reason and an explanation. */
export function parseImportedSnapshot(source: string): SnapshotImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return {
      ok: false,
      failure: {
        reason: "invalid-json",
        message:
          "That file is not valid JSON. Choose a snapshot JSON exported by this extension.",
      },
    };
  }
  if (!object(raw))
    return {
      ok: false,
      failure: {
        reason: "not-a-snapshot",
        message:
          "That file is not a comparison snapshot. Use Export snapshot JSON to produce one.",
      },
    };
  // `kind` is what separates a v3 snapshot from other JSON this extension
  // writes (the benchmark cache, the shields badge), which have no such
  // marker; `version` then separates v3 from the v1/v2 files that predate it.
  if (!("kind" in raw)) {
    // A file carrying snapshot fields but no marker predates the
    // discriminator; anything else is simply not a snapshot.
    const legacy = "rows" in raw || "source" in raw;
    return {
      ok: false,
      failure: legacy
        ? {
            reason: "unsupported-version",
            message: `This file has no snapshot kind marker, so it predates snapshot schema version ${snapshotSchemaVersion} and cannot be reopened. Re-export the comparison with this version of the extension.`,
          }
        : {
            reason: "not-a-snapshot",
            message:
              "That file is not a comparison snapshot. Use Export snapshot JSON to produce one.",
          },
    };
  }
  if (raw.kind !== "single" && raw.kind !== "comparison")
    return {
      ok: false,
      failure: {
        reason: "unsupported-kind",
        message: `Unsupported snapshot kind "${String(raw.kind).slice(0, 40)}".`,
      },
    };
  if (raw.version !== snapshotSchemaVersion)
    return {
      ok: false,
      failure: {
        reason: "unsupported-version",
        message: `This snapshot uses schema version ${String(raw.version)}, but this build reads version ${snapshotSchemaVersion}. Re-export the comparison with this version of the extension.`,
        found: raw.version,
      },
    };
  const shared = sharedFields(
    raw,
    // A pair snapshot carries the registry dates per option, since each side
    // was priced from the same registries; side A's dates are the export's.
    raw.kind === "comparison" ? sideEntry(raw, "A") ?? raw : raw,
  );
  if (!shared)
    return corrupt("Required snapshot fields are missing or invalid.");
  if (raw.kind === "comparison") {
    const sides = comparisonSides(raw);
    if (!sides)
      return corrupt("One or both options in this snapshot are unreadable.");
    const results = { A: optionResultOf(sides.A), B: optionResultOf(sides.B) };
    const normalize =
      sides.A.costNormalization.status !== "off" ||
      sides.B.costNormalization.status !== "off";
    return {
      ok: true,
      snapshot: {
        kind: "comparison",
        ...shared,
        sides,
        normalize,
        // Recomputed with the same pure helpers the exporter used, from the
        // rows and options the file recorded, so the delta and the overlay
        // describe the exported comparison instead of being trusted blindly.
        delta: comparisonDelta(results.A, results.B, normalize),
        overlay: overlayResult(results.A, results.B),
      },
    };
  }
  const single = singleFields(raw);
  if (!single) return corrupt("This single-option snapshot is unreadable.");
  return { ok: true, snapshot: { kind: "single", ...shared, ...single } };
}

const corrupt = (message: string): SnapshotImportResult => ({
  ok: false,
  failure: { reason: "corrupt", message },
});

/** Fields every snapshot kind carries; dates degrade to "unknown". A
 * single-option snapshot keeps them at the top level, so `dates` defaults to
 * the snapshot itself. */
function sharedFields(
  raw: Record<string, unknown>,
  dates: Record<string, unknown> = raw,
): ImportedSnapshotBase | null {
  // The version was already checked against `snapshotSchemaVersion`, so it is a
  // number by the time any field here is read.
  for (const key of [
    "exportedAt",
    "disclaimer",
    "catalogDate",
    "staticRegistryDate",
  ])
    if (!(key in raw) && !(key in dates)) return null;
  return {
    schemaVersion: snapshotSchemaVersion,
    exportedAt: dateText(raw.exportedAt),
    disclaimer: text(raw.disclaimer, 1000) ? raw.disclaimer : "",
    catalogDate: dateText(dates.catalogDate),
    staticRegistryDate: dateText(dates.staticRegistryDate),
    planRegistryDate: dateText(dates.planRegistryDate),
    benchmarkVersion: text(raw.benchmarkVersion, 100)
      ? raw.benchmarkVersion
      : "unknown",
    ...(timestamp(raw.benchmarkFetchedAt)
      ? { benchmarkFetchedAt: raw.benchmarkFetchedAt }
      : {}),
  };
}

/** One side of a two-option snapshot's `options` array, by its recorded side. */
function sideEntry(
  raw: Record<string, unknown>,
  side: Side,
): Record<string, unknown> | undefined {
  if (!Array.isArray(raw.options)) return undefined;
  return raw.options.find(
    (o) => object(o) && o.side === side,
  ) as Record<string, unknown> | undefined;
}

function singleFields(
  raw: Record<string, unknown>,
): Omit<ImportedSingle, keyof ImportedSnapshotBase | "kind"> | null {
  if (!Array.isArray(raw.rows) || raw.rows.length > maxRows) return null;
  if (!text(raw.source) || !(raw.source in sources)) return null;
  if (!object(raw.costBasis)) return null;
  const costBasis = costBasisOf(raw.costBasis);
  if (!costBasis) return null;
  const options = singleOptions(raw, raw.source as Source, costBasis);
  if (!options) return null;
  const rows = rowSet(raw.rows);
  if (!rows) return null;
  return {
    source: raw.source as Source,
    costBasis,
    options,
    rows: rows.rows,
    recommended: rows.recommended,
    scenario:
      raw.scenario === null || raw.scenario === undefined
        ? null
        : scenarioOf(raw.scenario),
  };
}

/**
 * A single-option snapshot records its workload as a `costBasis` block rather
 * than a full options object, so the fields it does carry are read from the
 * file, and the presentation-only settings (chart toggles, recommendation
 * settings) come from the host's current view via `importedViewState`. Costs
 * are never recomputed: the chart basis is forced to the exported one, since
 * re-labelling costs priced on a different basis would misstate them.
 */
function singleOptions(
  raw: Record<string, unknown>,
  source: Source,
  basis: CostBasisInfo,
): Options | null {
  const { preset, billing } = raw;
  if (preset !== "general" && preset !== "coding" && preset !== "agentic")
    return null;
  if (billing !== "credits" && billing !== "legacy" && billing !== "usd")
    return null;
  // Legacy billing is priced per interaction, so the export's basis is
  // "legacy" exactly when the billing mode is.
  if ((basis.basis === "legacy") !== (billing === "legacy")) return null;
  if (basis.unit !== costUnit(billing)) return null;
  return {
    source,
    preset,
    billing,
    plan: basis.legacyPlan ?? "pro",
    // The exported rows are already filtered and sorted; the panel's filter
    // input narrows them further, so the file's own filter is not adopted.
    filter: "",
    tokens: { ...(basis.effectiveTokens ?? basis.configuredTokens) },
    recommendation: {
      mode: "budget",
      budgets: { credits: 1, legacy: 1, usd: 1 },
      scoreGap: 3,
    },
    display: { ...defaultDisplay(), chart: chartOf(basis.basis) },
    freeOnly: false,
    onlyMine: false,
    scenario: {
      planId: "none",
      requestsLow: 0,
      requestsHigh: 0,
      origin: "user",
      history: null,
      custom: { monthlyFeeUsd: null, allowance: null, overageUsdPerUnit: null },
    },
  };
}

const defaultDisplay = (): DisplaySettings => ({
  labels: true,
  frontier: true,
  scale: "auto",
  chart: "task",
  quadrant: true,
  sort: "default",
});

/** Legacy billing has no token-workload view, so it renders as "task". */
const chartOf = (basis: CostBasisInfo["basis"]): ChartType =>
  basis === "workload" ? "workload" : "task";

/** Chart display toggles with the cost basis locked to the file's. */
export function importedDisplay(
  display: DisplaySettings,
  chart: ChartType,
): DisplaySettings {
  return { ...display, chart };
}

const tokensOf = (v: unknown) =>
  object(v) &&
  number(v.input, 100000000) &&
  number(v.read, 100000000) &&
  number(v.write, 100000000) &&
  number(v.output, 100000000)
    ? { input: v.input, read: v.read, write: v.write, output: v.output }
    : null;

/**
 * A snapshot's cost basis, validated rather than trusted: the basis decides
 * what the chart's x axis means, so a missing or unknown one makes the file
 * corrupt instead of a guess. The unit label is cross-checked against the
 * shared cost-unit helper, so a hand-edited file cannot relabel credits, and
 * the token blocks must agree with the basis (legacy pricing has no effective
 * token mix).
 */
function costBasisOf(raw: Record<string, unknown>): CostBasisInfo | null {
  if (
    raw.basis !== "task" &&
    raw.basis !== "workload" &&
    raw.basis !== "legacy"
  )
    return null;
  if (!text(raw.unit) || !text(raw.note, 1000)) return null;
  const legacyPlan =
    raw.legacyPlan === null || raw.legacyPlan === undefined
      ? null
      : raw.legacyPlan;
  if (legacyPlan !== null && legacyPlan !== "pro" && legacyPlan !== "proPlus")
    return null;
  const configured = tokensOf(raw.configuredTokens);
  if (!configured) return null;
  const effective =
    raw.effectiveTokens === null || raw.effectiveTokens === undefined
      ? null
      : tokensOf(raw.effectiveTokens);
  if (raw.effectiveTokens != null && !effective) return null;
  if ((effective === null) !== (raw.basis === "legacy")) return null;
  return {
    basis: raw.basis,
    unit: raw.unit as CostBasisInfo["unit"],
    configuredTokens: configured,
    effectiveTokens: effective,
    legacyPlan,
    note: raw.note,
  };
}

interface RowSet {
  rows: Row[];
  recommended: string[];
}

/**
 * Rows rebuilt from the export's `snapshotRow` projection. Fields the export
 * does not record — cost breakdown, dominators, invocable id, local usage
 * counts — are left absent rather than invented, and the fields the renderers
 * dereference unconditionally are filled exactly: `baseModelId` is the row's
 * own recorded model id, and `dominatedBy` is empty because the export never
 * stored dominators.
 */
function rowSet(raw: unknown): RowSet | null {
  if (!Array.isArray(raw) || raw.length > maxRows) return null;
  const rows: Row[] = [];
  const recommended: string[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!object(item)) return null;
    if (!text(item.id) || !text(item.modelId) || !text(item.name)) return null;
    if (!text(item.provider) || !stringList(item.reasons)) return null;
    if (ids.has(item.id)) return null;
    ids.add(item.id);
    if (!nullableNumber(item.score) || !nullableNumber(item.cost))
      return null;
    if (typeof item.frontier !== "boolean") return null;
    if (typeof item.recommended !== "boolean") return null;
    if (!mappingStatuses.includes(item.mappingStatus as MappingStatus))
      return null;
    const benchmark = benchmarkOf(item.benchmark);
    if (!benchmark) return null;
    const row: Row = {
      id: item.id,
      modelId: item.modelId,
      baseModelId: item.modelId,
      name: item.name,
      provider: item.provider,
      score: item.score,
      cost: item.cost,
      frontier: item.frontier,
      reasons: item.reasons,
      mappingStatus: item.mappingStatus as MappingStatus,
      candidateIds: [],
      dominatedBy: [],
      ...benchmark,
    };
    if (item.tier !== null && item.tier !== undefined) {
      if (!text(item.tier)) return null;
      row.tier = item.tier;
    }
    const pricing = pricingOf(item);
    if (pricing === null) return null;
    if (pricing) row.pricing = pricing;
    if (item.recommended) recommended.push(item.id);
    rows.push(row);
  }
  return { rows, recommended };
}

/** The row's benchmark when the file recorded one; `null` when its benchmark
 * block is present but unreadable. */
function benchmarkOf(raw: unknown): { benchmark?: Benchmark } | null {
  if (raw === null || raw === undefined) return {};
  if (!object(raw) || !text(raw.id) || !text(raw.name)) return null;
  // The projection records the id and name only; the derived slug mirrors the
  // recorded id, and no score is invented (the row carries the one that was
  // exported).
  return {
    benchmark: {
      id: raw.id,
      name: raw.name,
      slug: raw.id,
      provider: "Unknown",
      scores: { general: null, coding: null, agentic: null },
    },
  };
}

/**
 * Pricing provenance exactly as recorded. Anything outside the known
 * status/source/issue labels is rejected: the renderer maps these labels, and
 * a hand-edited file must not gain a provenance it never had.
 */
function pricingOf(
  item: Record<string, unknown>,
): PricingInfo | null | undefined {
  const { pricingStatus, pricingSource, pricingIssue, pricingProvenance } =
    item;
  if (pricingStatus === null || pricingStatus === undefined) return undefined;
  if (!pricingStatuses.includes(pricingStatus as PricingStatus)) return null;
  if (!pricingSources.includes(pricingSource as PricingSource)) return null;
  const issue =
    pricingIssue === null || pricingIssue === undefined
      ? undefined
      : text(pricingIssue)
        ? (pricingIssue as PricingIssue)
        : null;
  if (issue === null) return null;
  const pricing: PricingInfo = {
    status: pricingStatus as PricingStatus,
    source: pricingSource as PricingSource,
    ...(issue ? { issue } : {}),
  };
  if (pricingProvenance === null || pricingProvenance === undefined)
    return pricing;
  if (!object(pricingProvenance)) return null;
  if (pricingProvenance.kind === "manual") {
    pricing.byok = { provenance: { kind: "manual" } };
    return pricing;
  }
  if (
    pricingProvenance.kind === "registry" &&
    text(pricingProvenance.registry) &&
    text(pricingProvenance.registryId) &&
    text(pricingProvenance.registryDate)
  ) {
    pricing.byok = {
      provenance: {
        kind: "registry",
        registry: pricingProvenance.registry,
        registryId: pricingProvenance.registryId,
        registryDate: pricingProvenance.registryDate,
      },
    };
    return pricing;
  }
  return null;
}

function comparisonSides(
  raw: Record<string, unknown>,
): Record<Side, ImportedSide> | null {
  if (!Array.isArray(raw.options) || raw.options.length !== 2) return null;
  const sides = {} as Record<Side, ImportedSide>;
  for (const side of ["A", "B"] as const) {
    const entry = sideEntry(raw, side);
    if (!entry || !text(entry.name, 60)) return null;
    const options = optionsOf(entry.options);
    if (!options) return null;
    // A side's unit must agree with its own billing mode, so a hand-edited
    // file cannot label one option's credits as the other's USD.
    if (entry.unit !== costUnit(options.billing)) return null;
    if (!object(entry.costBasis)) return null;
    const costBasis = costBasisOf(entry.costBasis);
    if (!costBasis) return null;
    if (costBasis.unit !== entry.unit) return null;
    const rows = rowSet(entry.rows);
    if (!rows) return null;
    sides[side] = {
      side,
      name: entry.name,
      // Each side's rows were already filtered by that side's own filter at
      // export time, so the recorded filter is cleared, not re-applied.
      options: { ...options, filter: "" },
      rows: rows.rows,
      recommended: rows.recommended,
      ...(text(entry.selected, 1000) ? { selected: entry.selected } : {}),
      scenario: scenarioOf(entry.scenario),
      costNormalization: normalizationOf(entry.costNormalization),
      discoveryError: text(entry.discoveryError, 2000)
        ? entry.discoveryError
        : "",
    };
  }
  return sides;
}

/** A side's full options object, validated by the same parser as saved state. */
function optionsOf(raw: unknown): Options | null {
  if (!object(raw)) return null;
  try {
    return parseOptions(raw);
  } catch {
    return null;
  }
}

function optionResultOf(side: ImportedSide): OptionResult {
  return {
    name: side.name,
    options: side.options,
    rows: side.rows,
    recommendation: recommendationOf(side.recommended),
    selected: side.selected,
    // A historical snapshot carries no live checklist structure, and its
    // scenario is shown exactly as recorded rather than re-projected.
    groups: [],
    structureIds: [],
    scenario: side.scenario,
    ...(side.discoveryError ? { discoveryError: side.discoveryError } : {}),
  };
}

/**
 * The exported per-row recommendation, never recomputed: re-running
 * `recommend` with today's settings could contradict the file, and the file is
 * the record of what was compared.
 */
function recommendationOf(modelIds: string[]): RecommendationResult {
  return {
    modelIds,
    explanation: modelIds.length
      ? `Recommended when this snapshot was exported: ${modelIds.length} model${modelIds.length === 1 ? "" : "s"}. Not recomputed.`
      : "No model was recommended when this snapshot was exported.",
  };
}

/** Scenario as recorded, degrading to an explicit "unavailable" rather than to
 * a shape the comparison panel could not read. */
function scenarioOf(raw: unknown): ScenarioResult {
  if (object(raw) && raw.status === "off") return { status: "off" };
  if (
    object(raw) &&
    raw.status === "unavailable" &&
    text(raw.reason, 1000) &&
    stringList(raw.notes)
  )
    return {
      status: "unavailable",
      planId: text(raw.planId, 100) ? raw.planId : "",
      label: text(raw.label) ? raw.label : "Unknown plan",
      reason: raw.reason,
      notes: raw.notes,
      disclaimer: text(raw.disclaimer, 1000) ? raw.disclaimer : "",
    };
  if (
    object(raw) &&
    raw.status === "projected" &&
    object(raw.plan) &&
    text(raw.plan.label) &&
    rangeOf(raw.requests) &&
    rangeOf(raw.usage) &&
    rangeOf(raw.totalUsd)
  )
    return raw as unknown as ScenarioResult;
  return {
    status: "unavailable",
    planId: "",
    label: "Unknown plan",
    reason: "The spending scenario in this snapshot could not be read.",
    notes: [],
    disclaimer: "",
  };
}

/** Per-side USD-equivalent state, or "off" when the toggle was off. */
function normalizationOf(raw: unknown): NormalizedCost | { status: "off" } {
  if (!object(raw)) return { status: "off" };
  if (raw.status === "off") return { status: "off" };
  if (raw.status === "native" && number(raw.usd))
    return raw as unknown as NormalizedCost;
  if (
    raw.status === "converted" &&
    number(raw.usd) &&
    number(object(raw.original) ? raw.original.value : undefined) &&
    object(raw.rate) &&
    number(raw.rate.usdPerUnit) &&
    text(object(raw.provenance) ? raw.provenance.date : undefined) &&
    stringList(object(raw.provenance) ? raw.provenance.sources : undefined)
  )
    return raw as unknown as NormalizedCost;
  if (raw.status === "unavailable") return raw as unknown as NormalizedCost;
  return { status: "off" };
}

/** The displayed rows: the file's rows under the panel's own text filter,
 * using the same rule `compare()` applies, optionally re-sorted by the
 * display-only cost-per-quality ordering. */
function filteredRows(
  view: ImportedView,
  snapshot: ImportedSingle,
): Row[] {
  const rows = snapshot.rows.filter((r) =>
    matchesFilter(r.name, r.id, view.filter),
  );
  return view.display.sort === "efficiency"
    ? sortRowsByEfficiency(rows)
    : rows;
}

/**
 * The read-only view state for an imported snapshot. Every live-only field is
 * neutral (no checklist, no usage, no BYOK, no local benchmark list), the
 * dates and benchmark version are the file's own rather than today's, and
 * `imported` is what tells the webview the whole panel is historical.
 */
export function importedViewState(
  view: ImportedView,
  context: ImportedContext,
): ViewState {
  const { snapshot } = view;
  const base = {
    source: snapshot.kind === "single" ? snapshot.source : snapshot.sides.A.options.source,
    options: {} as Options,
    rows: [] as Row[],
    models: [],
    selected: undefined as string | undefined,
    version: snapshot.benchmarkVersion,
    ...(snapshot.benchmarkFetchedAt
      ? { fetchedAt: snapshot.benchmarkFetchedAt }
      : {}),
    drift: {},
    byok: {},
    usage: null,
    usageWatching: false,
    usagePaused: false,
    budgetSuggestion: null,
    loading: false,
    message: "",
    hasKey: context.hasKey,
    catalogDate: snapshot.catalogDate,
    staticRegistryDate: snapshot.staticRegistryDate,
    planRegistryDate: snapshot.planRegistryDate,
    scenarioPrefill: null,
    profiles: [],
    profileModified: false,
    optionsRevision: 0,
    checklist: [],
    groups: [],
    freeSpotlight: {
      enabled: false,
      explanation:
        "Free-tier spotlight needs live model discovery, so it is unavailable for an imported snapshot.",
    },
    freeBar: [],
    watchlistAlerts: context.watchlistAlerts,
    imported: {
      fileName: context.fileName,
      kind: snapshot.kind,
      schemaVersion: snapshot.schemaVersion,
      exportedAt: snapshot.exportedAt,
      disclaimer: snapshot.disclaimer,
      catalogDate: snapshot.catalogDate,
      staticRegistryDate: snapshot.staticRegistryDate,
      planRegistryDate: snapshot.planRegistryDate,
      ...(snapshot.kind === "single"
        ? {
            costBasis: {
              basis: snapshot.costBasis.basis,
              unit: snapshot.costBasis.unit,
              note: snapshot.costBasis.note,
            },
          }
        : {
            costBasis: {
              basis: "per side",
              unit: "per side",
              note: "Each option keeps its own cost basis and unit, exactly as exported.",
            },
            options: (["A", "B"] as const).map(
              (side) => `${side}: ${snapshot.sides[side].name}`,
            ),
          }),
    },
  };
  if (snapshot.kind === "single") {
    const rows = filteredRows(view, snapshot);
    return {
      ...base,
      options: {
        ...snapshot.options,
        filter: view.filter,
        recommendation: context.options.recommendation,
        scenario: context.options.scenario,
        display: importedDisplay(
          view.display,
          chartOf(snapshot.costBasis.basis),
        ),
      },
      rows,
      selected: pickSelected(view.selected.A, rows, snapshot.recommended),
      scenario: snapshot.scenario ?? { status: "off" },
      recommendation: recommendationOf(snapshot.recommended),
    };
  }
  const sides = {
    A: sideResult(view, snapshot, "A"),
    B: sideResult(view, snapshot, "B"),
  };
  return {
    ...base,
    source: sides.A.options.source,
    options: sides.A.options,
    rows: sides.A.rows,
    selected: sides.A.selected,
    scenario: sides.A.scenario,
    recommendation: sides.A.recommendation,
    comparison: {
      // Editing is unavailable in a read-only view, so the active side is
      // fixed; both panels always render side by side.
      active: "A",
      normalize: snapshot.normalize,
      view: "side-by-side",
      sides,
      delta: snapshot.delta,
      overlay: snapshot.overlay,
    },
  };
}

/** The selected row when it is still displayed, else the first recommendation,
 * else the first row — the same fallback order a live option uses. */
function pickSelected(
  chosen: string | undefined,
  rows: Row[],
  recommended: string[],
): string | undefined {
  if (chosen && rows.some((r) => r.id === chosen)) return chosen;
  return recommended.find((id) => rows.some((r) => r.id === id)) ?? rows[0]?.id;
}

/**
 * The messages an imported snapshot still answers: entering and leaving the
 * view, selecting a row, and the display-only option draft that redraws the
 * same historical rows. Everything else — source switches, mapping, pins,
 * exclusions, profiles, BYOK, usage, exports, comparison edits — would change
 * live state behind a historical view, so the host refuses it by name.
 */
export function allowedWhileImported(m: HostMessage): boolean {
  return (
    m.type === "ready" ||
    m.type === "importSnapshot" ||
    m.type === "importExit" ||
    m.type === "options" ||
    m.type === "select" ||
    (m.type === "target" && m.action.type === "select")
  );
}

/** One side's panel result, with its selection kept inside the read-only view.
 * A pair snapshot records each side's own chart basis, so it is used as
 * exported rather than forced to a single view-wide basis. */
function sideResult(
  view: ImportedView,
  snapshot: ImportedComparison,
  side: Side,
): OptionResult {
  const imported = snapshot.sides[side];
  const options: Options = {
    ...imported.options,
    display: importedDisplay(view.display, imported.options.display.chart),
  };
  const selected = pickSelected(
    view.selected[side] ?? imported.selected,
    imported.rows,
    imported.recommended,
  );
  return {
    name: imported.name,
    options,
    rows: imported.rows,
    recommendation: recommendationOf(imported.recommended),
    selected,
    groups: [],
    structureIds: [],
    scenario: imported.scenario,
    ...(imported.discoveryError
      ? { discoveryError: imported.discoveryError }
      : {}),
  };
}
