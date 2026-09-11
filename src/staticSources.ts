import type { AvailableModel, CatalogEntry, Rates, Source } from "./types";

export type StaticSource = Exclude<Source, "copilot" | "opencode">;

const rates = (
  input: number,
  read: number,
  write: number | null,
  output: number,
): Rates => ({ input, read, write, output });

interface StaticModel {
  id: string;
  name: string;
  provider: string;
  /** Stable family key used for grouped selection (e.g. "Claude Sonnet"). */
  family: string;
  benchmarkFamilies: string[];
  price?: Rates;
  long?: CatalogEntry["long"];
  expires?: string;
  maxInputTokens?: number;
}

function toAvailable(
  source: StaticSource,
  model: StaticModel,
): AvailableModel {
  return {
    id: `${source}:${model.id}`,
    name: model.name,
    family: model.family,
    maxInputTokens: model.maxInputTokens ?? 200000,
    source,
  };
}

function toEntry(source: StaticSource, model: StaticModel): CatalogEntry {
  return {
    ids: [`${source}:${model.id}`],
    name: model.name,
    provider: model.provider,
    benchmarkFamilies: model.benchmarkFamilies,
    ...(model.price ? { rates: model.price } : {}),
    ...(model.long ? { long: model.long } : {}),
    ...(model.expires ? { expires: model.expires } : {}),
  };
}

const definitions: Record<StaticSource, StaticModel[]> = {
  "claude-code": [
    {
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 4.5", "Claude 4.5 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 200000,
    },
    {
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      provider: "Anthropic",
      family: "Claude Haiku",
      benchmarkFamilies: ["Claude Haiku 4.5", "Claude 4.5 Haiku"],
      price: rates(1, 0.1, 1.25, 5),
      maxInputTokens: 200000,
    },
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 4.6", "Claude 4.6 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 1000000,
    },
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      provider: "Anthropic",
      family: "Claude Opus",
      benchmarkFamilies: ["Claude Opus 4.6", "Claude 4.6 Opus"],
      price: rates(5, 0.5, 6.25, 25),
      maxInputTokens: 1000000,
    },
    {
      id: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      provider: "Anthropic",
      family: "Claude Opus",
      benchmarkFamilies: ["Claude Opus 4.7", "Claude 4.7 Opus"],
      price: rates(5, 0.5, 6.25, 25),
      maxInputTokens: 1000000,
    },
    {
      id: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 5"],
      price: rates(2, 0.2, 2.5, 10),
      maxInputTokens: 1000000,
    },
    {
      id: "claude-opus-5",
      name: "Claude Opus 5",
      provider: "Anthropic",
      family: "Claude Opus",
      benchmarkFamilies: ["Claude Opus 5"],
      price: rates(5, 0.5, 6.25, 25),
      maxInputTokens: 1000000,
    },
    {
      id: "claude-fable-5",
      name: "Claude Fable 5",
      provider: "Anthropic",
      family: "Claude Fable",
      benchmarkFamilies: ["Claude Fable 5"],
      price: rates(10, 1, 12.5, 50),
      maxInputTokens: 1000000,
    },
    {
      id: "claude-fable-5-1",
      name: "Claude Fable 5.1",
      provider: "Anthropic",
      family: "Claude Fable",
      benchmarkFamilies: ["Claude Fable 5.1"],
      price: rates(10, 0.25, 12.5, 50),
      maxInputTokens: 1000000,
    },
  ],
  codex: [
    {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      provider: "OpenAI",
      family: "GPT-6",
      benchmarkFamilies: ["GPT-6 Astra"],
      price: rates(10, 1, 12.5, 50),
      maxInputTokens: 1050000,
    },
    {
      id: "gpt-5-6-sol",
      name: "GPT-5.6 Sol",
      provider: "OpenAI",
      family: "GPT-5.6",
      benchmarkFamilies: ["GPT-5.6 Sol"],
      price: rates(4, 0.4, 5, 20),
      maxInputTokens: 1050000,
    },
    {
      id: "gpt-5-6-terra",
      name: "GPT-5.6 Terra",
      provider: "OpenAI",
      family: "GPT-5.6",
      benchmarkFamilies: ["GPT-5.6 Terra"],
      price: rates(2, 0.2, 2.5, 12),
      maxInputTokens: 1050000,
    },
    {
      id: "gpt-5-6-luna",
      name: "GPT-5.6 Luna",
      provider: "OpenAI",
      family: "GPT-5.6",
      benchmarkFamilies: ["GPT-5.6 Luna"],
      price: rates(0.2, 0.02, 0.25, 1.2),
      maxInputTokens: 1050000,
    },
    {
      id: "gpt-5-5",
      name: "GPT-5.5",
      provider: "OpenAI",
      family: "GPT",
      benchmarkFamilies: ["GPT-5.5"],
      price: rates(5, 0.5, null, 30),
      maxInputTokens: 1000000,
    },
    {
      id: "gpt-5-3-codex-spark",
      name: "GPT-5.3-Codex-Spark",
      provider: "OpenAI",
      family: "GPT Codex",
      benchmarkFamilies: ["GPT-5.3-Codex-Spark", "GPT-5.3 Codex Spark"],
      maxInputTokens: 200000,
    },
  ],
  "gemini-cli": [
    {
      id: "gemini-3-pro",
      name: "Gemini 3 Pro",
      provider: "Google",
      family: "Gemini Pro",
      benchmarkFamilies: ["Gemini 3 Pro"],
      price: rates(2, 0.2, null, 12),
      maxInputTokens: 1000000,
    },
    {
      id: "gemini-3-flash",
      name: "Gemini 3 Flash",
      provider: "Google",
      family: "Gemini Flash",
      benchmarkFamilies: ["Gemini 3 Flash"],
      price: rates(0.5, 0.05, null, 3),
      maxInputTokens: 1000000,
    },
    {
      id: "gemini-3-5-flash",
      name: "Gemini 3.5 Flash",
      provider: "Google",
      family: "Gemini Flash",
      benchmarkFamilies: ["Gemini 3.5 Flash"],
      price: rates(1.5, 0.15, null, 9),
      maxInputTokens: 1000000,
    },
    {
      id: "gemini-3-8-flash",
      name: "Gemini 3.8 Flash",
      provider: "Google",
      family: "Gemini Flash",
      benchmarkFamilies: ["Gemini 3.8 Flash"],
      price: rates(0.75, 0.075, null, 3.75),
      expires: "2026-12-31",
      maxInputTokens: 1000000,
    },
    {
      id: "gemini-2-5-pro",
      name: "Gemini 2.5 Pro",
      provider: "Google",
      family: "Gemini Pro",
      benchmarkFamilies: ["Gemini 2.5 Pro"],
      price: rates(1.25, 0.125, null, 10),
      maxInputTokens: 1000000,
    },
  ],
  cursor: [
    {
      id: "cursor-gpt-5-6-terra",
      name: "GPT-5.6 Terra (Cursor)",
      provider: "OpenAI",
      family: "GPT-5.6",
      benchmarkFamilies: ["GPT-5.6 Terra"],
      price: rates(2, 0.2, 2.5, 12),
      maxInputTokens: 1050000,
    },
    {
      id: "cursor-claude-sonnet-4-5",
      name: "Claude Sonnet 4.5 (Cursor)",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 4.5", "Claude 4.5 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 200000,
    },
    {
      id: "cursor-claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (Cursor)",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 4.6", "Claude 4.6 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 1000000,
    },
    {
      id: "cursor-claude-fable-5",
      name: "Claude Fable 5 (Cursor)",
      provider: "Anthropic",
      family: "Claude Fable",
      benchmarkFamilies: ["Claude Fable 5"],
      price: rates(10, 1, 12.5, 50),
      maxInputTokens: 1000000,
    },
    {
      id: "cursor-claude-fable-5-1",
      name: "Claude Fable 5.1 (Cursor)",
      provider: "Anthropic",
      family: "Claude Fable",
      benchmarkFamilies: ["Claude Fable 5.1"],
      price: rates(10, 0.25, 12.5, 50),
      maxInputTokens: 1000000,
    },
    {
      id: "cursor-claude-sonnet-5",
      name: "Claude Sonnet 5 (Cursor)",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 5"],
      price: rates(2, 0.2, 2.5, 10),
      maxInputTokens: 1000000,
    },
  ],
  windsurf: [
    {
      id: "windsurf-gpt-5-6-terra",
      name: "GPT-5.6 Terra (Windsurf)",
      provider: "OpenAI",
      family: "GPT-5.6",
      benchmarkFamilies: ["GPT-5.6 Terra"],
      price: rates(2, 0.2, 2.5, 12),
      maxInputTokens: 1050000,
    },
    {
      id: "windsurf-gemini-3-pro",
      name: "Gemini 3 Pro (Windsurf)",
      provider: "Google",
      family: "Gemini Pro",
      benchmarkFamilies: ["Gemini 3 Pro"],
      price: rates(2, 0.2, null, 12),
      maxInputTokens: 1000000,
    },
    {
      id: "windsurf-claude-fable-5",
      name: "Claude Fable 5 (Windsurf)",
      provider: "Anthropic",
      family: "Claude Fable",
      benchmarkFamilies: ["Claude Fable 5"],
      price: rates(10, 1, 12.5, 50),
      maxInputTokens: 1000000,
    },
    {
      id: "windsurf-claude-fable-5-1",
      name: "Claude Fable 5.1 (Windsurf)",
      provider: "Anthropic",
      family: "Claude Fable",
      benchmarkFamilies: ["Claude Fable 5.1"],
      price: rates(10, 0.25, 12.5, 50),
      maxInputTokens: 1000000,
    },
  ],
  aider: [
    {
      id: "aider-gpt-5-6-terra",
      name: "GPT-5.6 Terra (Aider reference)",
      provider: "OpenAI",
      family: "GPT-5.6",
      benchmarkFamilies: ["GPT-5.6 Terra"],
      price: rates(2, 0.2, 2.5, 12),
      maxInputTokens: 1050000,
    },
    {
      id: "aider-claude-sonnet-4-5",
      name: "Claude Sonnet 4.5 (Aider reference)",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 4.5", "Claude 4.5 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 200000,
    },
    {
      id: "aider-claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (Aider reference)",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 4.6", "Claude 4.6 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 1000000,
    },
    {
      id: "aider-claude-fable-5",
      name: "Claude Fable 5 (Aider reference)",
      provider: "Anthropic",
      family: "Claude Fable",
      benchmarkFamilies: ["Claude Fable 5"],
      price: rates(10, 1, 12.5, 50),
      maxInputTokens: 1000000,
    },
    {
      id: "aider-claude-fable-5-1",
      name: "Claude Fable 5.1 (Aider reference)",
      provider: "Anthropic",
      family: "Claude Fable",
      benchmarkFamilies: ["Claude Fable 5.1"],
      price: rates(10, 0.25, 12.5, 50),
      maxInputTokens: 1000000,
    },
    {
      id: "aider-claude-sonnet-5",
      name: "Claude Sonnet 5 (Aider reference)",
      provider: "Anthropic",
      family: "Claude Sonnet",
      benchmarkFamilies: ["Claude Sonnet 5"],
      price: rates(2, 0.2, 2.5, 10),
      maxInputTokens: 1000000,
    },
  ],
  "amazon-q": [
    {
      id: "q-developer-default",
      name: "Amazon Q Developer (reference)",
      provider: "AWS",
      family: "Amazon Q",
      benchmarkFamilies: ["Amazon Q"],
      maxInputTokens: 200000,
    },
  ],
};

export const staticRegistryDate = "2026-09-11";

export const staticPricingSources: Record<StaticSource, string> = {
  "claude-code": "https://www.anthropic.com/pricing",
  codex: "https://openai.com/api/pricing",
  "gemini-cli": "https://ai.google.dev/pricing",
  cursor: "https://cursor.com/pricing",
  windsurf: "https://windsurf.com/pricing",
  aider: "https://openai.com/api/pricing",
  "amazon-q": "https://aws.amazon.com/q/developer/pricing/",
};

export function staticModels(source: StaticSource): AvailableModel[] {
  return definitions[source].map((m) => toAvailable(source, m));
}

export function staticEntries(source: StaticSource): CatalogEntry[] {
  return definitions[source].map((m) => toEntry(source, m));
}

export function isStaticSource(source: string): source is StaticSource {
  return source in definitions;
}
