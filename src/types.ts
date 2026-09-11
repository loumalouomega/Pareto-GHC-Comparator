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
export interface DisplaySettings {
  labels: boolean;
  frontier: boolean;
  scale: CostScale;
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
export interface Options {
  source: Source;
  preset: Preset;
  billing: Billing;
  plan: "pro" | "proPlus";
  tokens: Tokens;
  filter: string;
  recommendation: RecommendationSettings;
  display: DisplaySettings;
  freeOnly: boolean;
}
export const defaults: Options = {
  source: "copilot",
  preset: "coding",
  billing: "credits",
  plan: "pro",
  tokens: { input: 1000, read: 0, write: 0, output: 1000 },
  filter: "",
  recommendation: {
    mode: "budget",
    budgets: { credits: 1, legacy: 1, usd: 1 },
    scoreGap: 3,
  },
  display: { labels: true, frontier: true, scale: "auto" },
  freeOnly: false,
};
export interface Benchmark {
  id: string;
  slug: string;
  name: string;
  provider: string;
  scores: Record<Preset, number | null>;
}
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
  selectedBenchmarkId?: string;
  pinnedBenchmarkId?: string;
  /** Benchmark automatically expanded as its own row when several variants match. */
  expandedBenchmarkId?: string;
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
  source: Source;
  options: Options;
  rows: Row[];
  models: Benchmark[];
  selected?: string;
  version?: string;
  fetchedAt?: number;
  loading: boolean;
  message: string;
  hasKey: boolean;
  catalogDate: string;
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
