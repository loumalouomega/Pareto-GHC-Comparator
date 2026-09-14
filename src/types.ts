export type Preset = "general" | "coding" | "agentic";
export type Billing = "credits" | "legacy" | "usd";
export type Source =
  | "copilot"
  | "opencode"
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "cursor"
  | "windsurf"
  | "aider"
  | "amazon-q";
export type CostScale = "auto" | "log" | "linear";
export type ChartType = "workload" | "task";
export type TableSort = "default" | "efficiency";
export interface DisplaySettings {
  labels: boolean;
  frontier: boolean;
  scale: CostScale;
  chart: ChartType;
  quadrant: boolean;
  sort: TableSort;
}
export interface Tokens {
  input: number;
  read: number;
  write: number;
  output: number;
}
export type RecommendationMode = "budget" | "nearBest";
export interface RecommendationSettings {
  mode: RecommendationMode;
  budgets: Record<Billing, number>;
  scoreGap: number;
}
/** Local-history window a scenario's request range was prefilled from. */
export interface ScenarioHistory {
  from: string;
  to: string;
  activeDays: number;
  calendarDays: number;
  requests: number;
}
/**
 * What-if monthly spending scenario inputs (see src/plans.ts). `planId`
 * "none" means off. Custom plan fields are user input; null means not entered.
 */
export interface ScenarioSettings {
  planId: string;
  requestsLow: number;
  requestsHigh: number;
  origin: "user" | "history";
  history: ScenarioHistory | null;
  custom: {
    monthlyFeeUsd: number | null;
    allowance: number | null;
    overageUsdPerUnit: number | null;
  };
}
export type ScenarioProvenance =
  | { kind: "provider"; date: string; sources: string[] }
  | { kind: "user" }
  | ({ kind: "history" } & ScenarioHistory)
  | {
      kind: "estimate";
      basis: "task" | "workload" | "legacy-multiplier";
      catalogDate: string;
    };
export type ScenarioBoundary = "within-base" | "within-flex" | "over-allowance";
export interface ScenarioRange {
  low: number;
  high: number;
}
export type ScenarioResult =
  | { status: "off" }
  | {
      status: "unavailable";
      planId: string;
      label: string;
      reason: string;
      notes: string[];
      disclaimer: string;
    }
  | {
      status: "projected";
      plan: {
        id: string;
        label: string;
        unit: "AI credits" | "premium requests";
        registryDate: string | null;
      };
      row: {
        id: string;
        name: string;
        origin: "selected" | "recommended" | "first-comparable";
      };
      perRequest: { value: number; provenance: ScenarioProvenance };
      requests: ScenarioRange & { provenance: ScenarioProvenance };
      usage: ScenarioRange;
      allowance: ScenarioRange & {
        provenance: ScenarioProvenance;
        flexVariable: boolean;
      };
      overageUnits: ScenarioRange;
      overageUsd: (ScenarioRange & { provenance: ScenarioProvenance }) | null;
      feeUsd: {
        value: number | null;
        basis: "account" | "seat" | null;
        provenance: ScenarioProvenance | null;
      };
      totalUsd: ScenarioRange | null;
      boundary: { low: ScenarioBoundary; high: ScenarioBoundary };
      notes: string[];
      disclaimer: string;
    };
/** Request range derived from local usage history, applied only on demand. */
export interface ScenarioPrefill extends ScenarioRange, ScenarioHistory {
  undated: number;
}
export interface Options {
  source: Source;
  preset: Preset;
  billing: Billing;
  plan: "pro" | "proPlus";
  tokens: Tokens;
  filter: string;
  onlyMine: boolean;
  recommendation: RecommendationSettings;
  display: DisplaySettings;
  freeOnly: boolean;
  scenario: ScenarioSettings;
}
export const defaults: Options = {
  source: "copilot",
  preset: "general",
  billing: "credits",
  plan: "pro",
  tokens: { input: 1000, read: 0, write: 0, output: 1000 },
  filter: "",
  recommendation: {
    mode: "budget",
    budgets: { credits: 1, legacy: 1, usd: 1 },
    scoreGap: 3,
  },
  display: {
    labels: true,
    frontier: true,
    scale: "auto",
    chart: "task",
    quadrant: true,
    sort: "default",
  },
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
export interface Benchmark {
  id: string;
  slug: string;
  name: string;
  provider: string;
  scores: Record<Preset, number | null>;
}
export interface ScoreDrift {
  prevScore: number | null;
  delta: number | null;
}
export type TokenProvenance = "observed" | "estimated" | "missing";
export interface UsageDiagnostics {
  malformed: number;
  unsupported: number;
  unreadable: number;
  stale: number;
  missingTokens: number;
  estimatedTokens: number;
}
export interface UsageRequest {
  promptProvenance?: TokenProvenance;
  outputProvenance?: TokenProvenance;
  sessionId: string;
  workspaceId: string;
  requestIndex: number;
  requestId?: string;
  modelId: string | null;
  timestampMs: number | null;
  promptTokens: number;
  outputTokens: number;
  toolCallRounds: number;
  tokensEstimated: boolean;
}
export interface UsageModelStat {
  modelId: string;
  requests: number;
  promptTokens: number;
  outputTokens: number;
  premiumEstimate: number;
}
export interface UsageDayStat {
  date: string;
  requests: number;
  promptTokens: number;
  outputTokens: number;
  premiumEstimate: number;
}
export interface UsageWorkspaceStat {
  id: string;
  path: string;
  requests: number;
  promptTokens: number;
  outputTokens: number;
  premiumEstimate: number;
}
export interface UsageSummary {
  diagnostics?: UsageDiagnostics;
  scannedAt: number;
  fileCount: number;
  requestCount: number;
  promptTokens: number;
  outputTokens: number;
  premiumEstimate: number;
  estimatedTokens: number;
  unknownModels: string[];
  dateRange: { from: number; to: number } | null;
  medianPrompt: number;
  medianOutput: number;
  medianSample: number;
  premiumP90: number | null;
  creditP90: number | null;
  creditSample: number;
  models: UsageModelStat[];
  days: UsageDayStat[];
  workspaces: UsageWorkspaceStat[];
}
export interface BudgetSuggestion {
  value: number | null;
  note: string;
}
/**
 * Where a BYOK rate came from. "manual" is anything the user typed in the
 * BYOK form. "registry" is written only by the host, from a same-identifier
 * static-registry match (see `registryRateFor` in src/assist.ts) that the
 * user explicitly applied; the webview form can never create this kind.
 */
export type ByokProvenance =
  | { kind: "manual" }
  | {
      kind: "registry";
      registry: string;
      registryId: string;
      registryDate: string;
    };
export interface ByokEntry {
  rates: Rates;
  long?: { threshold: number; rates: Rates };
  source?: ByokProvenance;
}
export type ByokStore = Record<string, ByokEntry>;
export interface Snapshot {
  version: string;
  fetchedAt: number;
  models: Benchmark[];
}
export interface AvailableModel {
  id: string;
  name: string;
  family: string;
  maxInputTokens: number;
  /** Absent means Copilot (pre-source data). */
  source?: Source;
  /** USD-per-million-token rates from OpenCode CLI discovery. Absent for Copilot models and unpriced providers. */
  rates?: Rates;
  long?: { threshold: number; rates: Rates };
  /** Zero-cost Zen free-tier model. */
  freeTier?: boolean;
  /** Visible pricing notes from discovery (e.g. unrecognized tier shape). */
  pricingNotes?: string[];
  /** Static-source only: the exact id verified against that client's own docs (never derived from name/registry key). Absent when no client id is documented for this model. */
  invocableId?: string;
}
export interface Rates {
  input: number;
  read: number;
  write: number | null;
  output: number;
}
export interface CostBreakdown {
  inputTokens: number;
  readTokens: number;
  writeTokens: number;
  outputTokens: number;
  rates: Rates;
  divisor: number;
  tier?: string;
  unit: string;
}
export interface CatalogEntry {
  ids: string[];
  name: string;
  provider: string;
  benchmarkFamilies: string[];
  rates?: Rates;
  long?: { threshold: number; rates: Rates };
  legacy?: { pro: number; proPlus: number };
  expires?: string;
  /** Zero-cost model (Zen free tier). Priced at 0 with a visible label. */
  freeTier?: boolean;
}
export type MappingStatus = "exact" | "user" | "selection" | "missing";
export interface MappingResult {
  status: MappingStatus;
  candidateIds: string[];
  benchmark?: Benchmark;
  reason?: string;
}
/** Why a row's benchmark mapping is unresolved. Never inferred from display-name similarity. */
export type MappingIssue =
  | "no-snapshot"
  | "no-catalog-entry"
  | "ambiguous-catalog-entry"
  | "no-alias-hit"
  | "override-stale"
  | "pin-stale";
export interface BenchmarkSuggestion {
  benchmarkId: string;
  slug: string;
  name: string;
  /** The only suggestion rule: the benchmark slug equals the model's identifier. */
  rule: "identifier-slug";
  identifier: string;
  sameThinkingLevel: boolean;
}
export interface MappingAssist {
  issue?: MappingIssue;
  reason?: string;
  /** Aliases tried for this model, for the "why unresolved" explanation. */
  aliases: string[];
  /** The override/pin id that no longer resolves, when issue is *-stale. */
  staleBenchmarkId?: string;
  /** Identifier-slug matches, excluding anything already in candidateIds. Unverified until applied. */
  suggestions: BenchmarkSuggestion[];
}
export type PricingStatus =
  "priced" | "free" | "byok" | "unresolved" | "not-comparable";
export type PricingSource =
  | "copilot-catalog"
  | "legacy-multiplier"
  | "opencode-cli"
  | "static-registry"
  | "byok"
  | "none";
export type PricingIssue =
  | "no-catalog-entry"
  | "ambiguous-catalog-entry"
  | "legacy-no-multiplier"
  | "promo-expired"
  | "provider-billed-no-rate"
  | "no-credit-rates"
  | "registry-unpriced"
  | "cross-unit"
  | "context-exceeded";
export interface RegistryRateSuggestion {
  registry: string;
  registryId: string;
  registryName: string;
  registryDate: string;
  sourceUrl: string;
  rates: Rates;
  long?: { threshold: number; rates: Rates };
}
export interface PricingInfo {
  status: PricingStatus;
  source: PricingSource;
  issue?: PricingIssue;
  reason?: string;
  byok?: {
    provenance: ByokProvenance;
    stale?: "rates-changed" | "registry-missing";
  };
  /** A same-identifier registry rate, unverified until the user applies it via byokApply. */
  suggestion?: RegistryRateSuggestion;
}
export interface InvocableRef {
  /** The exact string to paste after the client's model flag/config key. */
  ref: string;
  /** Where to paste it, e.g. "codex -m <id> / model in config.toml". */
  usage: string;
}
export interface Row {
  id: string;
  /** Original discovered/static model id (pins share this). */
  modelId: string;
  /** Base model identity used for color grouping (variant suffix stripped). */
  baseModelId: string;
  name: string;
  provider: string;
  score: number | null;
  cost: number | null;
  frontier: boolean;
  reasons: string[];
  benchmark?: Benchmark;
  tier?: string;
  breakdown?: CostBreakdown;
  dominatedBy: string[];
  mappingStatus: MappingStatus;
  candidateIds: string[];
  requests?: number;
  selectedBenchmarkId?: string;
  pinnedBenchmarkId?: string;
  /** Benchmark automatically expanded as its own row when several variants match. */
  expandedBenchmarkId?: string;
  /** Explanation and unverified suggestions, set only when mappingStatus is "missing". */
  mapping?: MappingAssist;
  /** Pricing provenance, separate from benchmark mapping; a benchmark choice never sets this. */
  pricing?: PricingInfo;
  /** A doc-verified id the source client accepts, when one exists; absent means no verified id (Copy falls back to the display name). Independent of mapping/pricing. */
  invocable?: InvocableRef;
}
export interface RecommendationResult {
  modelIds: string[];
  explanation: string;
  threshold?: number;
}
export type Workload = Omit<Options, "filter" | "display">;
export interface WorkloadProfile {
  id: string;
  name: string;
  workload: Workload;
}
export interface ProfileStore {
  version: 1;
  items: WorkloadProfile[];
  activeId?: string;
}
export interface ProfileSummary {
  id: string;
  name: string;
}
export type ProfileAction =
  | { action: "custom" }
  | { action: "saveAs"; name: string }
  | { action: "rename"; id: string; name: string }
  | { action: "apply" | "update" | "delete"; id: string };
export type HostMessage =
  | {
      type: "comparison";
      enabled?: boolean;
      active?: "A" | "B";
      name?: string;
      normalize?: boolean;
      view?: import("./comparison").ComparisonView;
    }
  | { type: "target"; side: "A" | "B"; action: HostMessage }
  | { type: "ready" | "refresh" | "key" }
  | { type: "source"; source: Source }
  | { type: "options"; options: Options }
  | { type: "select" | "copy"; id: string }
  | { type: "mapping"; id: string; benchmarkId: string }
  | { type: "pin"; id: string; benchmarkId: string }
  | { type: "unpin"; id: string; benchmarkId: string }
  | { type: "exclude"; id: string; excluded: boolean }
  | { type: "excludeMany"; ids: string[]; excluded: boolean }
  | { type: "excludeAll"; excluded: boolean }
  | { type: "exportCsv" }
  | { type: "exportSnapshot" }
  | { type: "exportBadge" }
  | { type: "byok"; rates: ByokStore }
  | { type: "byokApply"; ids: string[] }
  | { type: "byokReset"; ids: string[] }
  | { type: "scanUsage" }
  | { type: "clearUsage" }
  | { type: "pauseUsage" }
  | { type: "resumeUsage" }
  | { type: "exportPng"; png: string }
  | { type: "profile"; change: ProfileAction };
export interface FreeSpotlight {
  enabled: boolean;
  bestFree?: { id: string; name: string; score: number };
  bestOverall?: { id: string; name: string; score: number };
  gapPoints?: number;
  cheapestToBest?: { id: string; name: string; cost: number };
  explanation: string;
}
export interface ChecklistEntry {
  id: string;
  name: string;
  provider: string;
  included: boolean;
  rowCount: number;
}
export type ChecklistState = "checked" | "unchecked" | "mixed";
export interface ChecklistLeaf {
  id: string;
  name: string;
  thinking: string;
  included: boolean;
  rowCount: number;
}
export interface ChecklistModel {
  id: string;
  name: string;
  provider: string;
  state: ChecklistState;
  includedCount: number;
  totalCount: number;
  leaves: ChecklistLeaf[];
}
export interface ChecklistFamily {
  id: string;
  name: string;
  state: ChecklistState;
  includedCount: number;
  totalCount: number;
  models: ChecklistModel[];
}
export interface ViewState {
  comparison?: {
    active: import("./comparison").Side;
    normalize: boolean;
    view: import("./comparison").ComparisonView;
    sides: Record<
      import("./comparison").Side,
      import("./comparison").OptionResult
    >;
    delta: ReturnType<typeof import("./comparison").comparisonDelta>;
    overlay?: import("./comparison").OverlayResult;
  };
  source: Source;
  options: Options;
  rows: Row[];
  models: Benchmark[];
  selected?: string;
  version?: string;
  fetchedAt?: number;
  prevVersion?: string;
  prevFetchedAt?: number;
  drift: Record<string, ScoreDrift>;
  byok: ByokStore;
  usage: UsageSummary | null;
  usageWatching: boolean;
  usagePaused: boolean;
  budgetSuggestion: BudgetSuggestion | null;
  loading: boolean;
  message: string;
  hasKey: boolean;
  catalogDate: string;
  staticRegistryDate: string;
  planRegistryDate: string;
  scenario: ScenarioResult;
  scenarioPrefill: ScenarioPrefill | null;
  recommendation: RecommendationResult;
  profiles: ProfileSummary[];
  activeProfileId?: string;
  profileModified: boolean;
  optionsRevision: number;
  checklist: ChecklistEntry[];
  groups: ChecklistFamily[];
  freeSpotlight: FreeSpotlight;
  exportNote?: string;
}
