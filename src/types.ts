export type Preset = "general" | "coding" | "agentic";
export type Billing = "credits" | "legacy";
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
  preset: Preset;
  billing: Billing;
  plan: "pro" | "proPlus";
  tokens: Tokens;
  filter: string;
  recommendation: RecommendationSettings;
}
export const defaults: Options = {
  preset: "coding",
  billing: "credits",
  plan: "pro",
  tokens: { input: 1000, read: 0, write: 0, output: 1000 },
  filter: "",
  recommendation: {
    mode: "budget",
    budgets: { credits: 1, legacy: 1 },
    scoreGap: 3,
  },
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
}
export interface Rates {
  input: number;
  read: number;
  write: number | null;
  output: number;
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
  name: string;
  provider: string;
  score: number | null;
  cost: number | null;
  frontier: boolean;
  reasons: string[];
  benchmark?: Benchmark;
  tier?: string;
  dominatedBy: string[];
  mappingStatus: MappingStatus;
  candidateIds: string[];
  selectedBenchmarkId?: string;
}
export interface RecommendationResult {
  modelIds: string[];
  explanation: string;
  threshold?: number;
}
export type Workload = Omit<Options, "filter">;
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
  | { type: "options"; options: Options }
  | { type: "select" | "copy"; id: string }
  | { type: "mapping"; id: string; benchmarkId: string }
  | { type: "profile"; change: ProfileAction };
export interface ViewState {
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
}
