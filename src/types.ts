export type Preset = "general" | "coding" | "agentic";
export type Billing = "credits" | "legacy";
export interface Tokens {
  input: number;
  read: number;
  write: number;
  output: number;
}
export interface Options {
  preset: Preset;
  billing: Billing;
  plan: "pro" | "proPlus";
  tokens: Tokens;
  filter: string;
}
export const defaults: Options = {
  preset: "coding",
  billing: "credits",
  plan: "pro",
  tokens: { input: 1000, read: 0, write: 0, output: 1000 },
  filter: "",
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
  benchmarkNames: string[];
  rates?: Rates;
  long?: { threshold: number; rates: Rates };
  legacy?: { pro: number; proPlus: number };
  expires?: string;
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
}
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
}
