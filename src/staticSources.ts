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
    family: model.id,
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
      id: "claude-opus-4-5",
      name: "Claude Opus 4.5",
      provider: "Anthropic",
      benchmarkFamilies: ["Claude Opus 4.5", "Claude 4.5 Opus"],
      price: rates(15, 1.5, 18.75, 75),
      maxInputTokens: 200000,
    },
    {
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      provider: "Anthropic",
      benchmarkFamilies: ["Claude Sonnet 4.5", "Claude 4.5 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 200000,
    },
    {
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      provider: "Anthropic",
      benchmarkFamilies: ["Claude Haiku 4.5", "Claude 4.5 Haiku"],
      price: rates(1, 0.1, 1.25, 5),
      maxInputTokens: 200000,
    },
  ],
  codex: [
    {
      id: "gpt-5-3-codex",
      name: "GPT-5.3-Codex",
      provider: "OpenAI",
      benchmarkFamilies: ["GPT-5.3-Codex", "GPT-5.3 Codex"],
      price: rates(1.75, 0.175, null, 14),
      maxInputTokens: 272000,
    },
    {
      id: "gpt-5-4",
      name: "GPT-5.4",
      provider: "OpenAI",
      benchmarkFamilies: ["GPT-5.4"],
      price: rates(2.5, 0.25, null, 15),
      long: { threshold: 272000, rates: rates(5, 0.5, null, 22.5) },
      maxInputTokens: 400000,
    },
    {
      id: "gpt-5-1-codex-mini",
      name: "GPT-5.1-Codex-Mini",
      provider: "OpenAI",
      benchmarkFamilies: ["GPT-5.1-Codex-Mini", "GPT-5.1 Codex Mini"],
      price: rates(0.25, 0.025, null, 2),
      maxInputTokens: 200000,
    },
  ],
  "gemini-cli": [
    {
      id: "gemini-3-pro",
      name: "Gemini 3 Pro",
      provider: "Google",
      benchmarkFamilies: ["Gemini 3 Pro"],
      price: rates(2, 0.2, null, 12),
      maxInputTokens: 1000000,
    },
    {
      id: "gemini-3-flash",
      name: "Gemini 3 Flash",
      provider: "Google",
      benchmarkFamilies: ["Gemini 3 Flash", "Gemini 3.5 Flash"],
      price: rates(0.5, 0.05, null, 3),
      maxInputTokens: 1000000,
    },
    {
      id: "gemini-2-5-pro",
      name: "Gemini 2.5 Pro",
      provider: "Google",
      benchmarkFamilies: ["Gemini 2.5 Pro"],
      price: rates(1.25, 0.125, null, 10),
      maxInputTokens: 1000000,
    },
  ],
  cursor: [
    {
      id: "cursor-gpt-5-4",
      name: "GPT-5.4 (Cursor)",
      provider: "OpenAI",
      benchmarkFamilies: ["GPT-5.4"],
      price: rates(2.5, 0.25, null, 15),
      maxInputTokens: 400000,
    },
    {
      id: "cursor-claude-sonnet-4-5",
      name: "Claude Sonnet 4.5 (Cursor)",
      provider: "Anthropic",
      benchmarkFamilies: ["Claude Sonnet 4.5", "Claude 4.5 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 200000,
    },
  ],
  windsurf: [
    {
      id: "windsurf-gpt-5-4",
      name: "GPT-5.4 (Windsurf)",
      provider: "OpenAI",
      benchmarkFamilies: ["GPT-5.4"],
      price: rates(2.5, 0.25, null, 15),
      maxInputTokens: 400000,
    },
    {
      id: "windsurf-gemini-3-pro",
      name: "Gemini 3 Pro (Windsurf)",
      provider: "Google",
      benchmarkFamilies: ["Gemini 3 Pro"],
      price: rates(2, 0.2, null, 12),
      maxInputTokens: 1000000,
    },
  ],
  aider: [
    {
      id: "aider-gpt-5-4",
      name: "GPT-5.4 (Aider reference)",
      provider: "OpenAI",
      benchmarkFamilies: ["GPT-5.4"],
      price: rates(2.5, 0.25, null, 15),
      maxInputTokens: 400000,
    },
    {
      id: "aider-claude-sonnet-4-5",
      name: "Claude Sonnet 4.5 (Aider reference)",
      provider: "Anthropic",
      benchmarkFamilies: ["Claude Sonnet 4.5", "Claude 4.5 Sonnet"],
      price: rates(3, 0.3, 3.75, 15),
      maxInputTokens: 200000,
    },
  ],
  "amazon-q": [
    {
      id: "q-developer-default",
      name: "Amazon Q Developer (reference)",
      provider: "AWS",
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
