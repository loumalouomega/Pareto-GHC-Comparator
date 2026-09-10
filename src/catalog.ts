import type { CatalogEntry, Rates } from "./types";
export const catalogDate = "2026-09-10";
export const pricingSource =
  "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing";
export const legacySource =
  "https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans";
const rates = (
  input: number,
  read: number,
  write: number | null,
  output: number,
): Rates => ({ input, read, write, output });
function entry(
  name: string,
  provider: string,
  id: string,
  price?: Rates,
  multiplier?: number,
  long?: CatalogEntry["long"],
): CatalogEntry {
  return {
    name,
    provider,
    ids: [id],
    rates: price,
    long,
    legacy:
      multiplier === undefined
        ? undefined
        : { pro: multiplier, proPlus: multiplier },
    // These are exact candidate names, never substring/fuzzy matches. Multiple hits require user selection.
    benchmarkNames: [
      name,
      ...["high", "max", "xhigh", "medium", "non-reasoning"].map(
        (e) => `${name} (${e})`,
      ),
    ],
  };
}
export const catalog: CatalogEntry[] = [
  entry(
    "GPT-5 mini",
    "OpenAI",
    "gpt-5-mini",
    rates(0.25, 0.025, null, 2),
    0.33,
  ),
  entry(
    "GPT-5.3-Codex",
    "OpenAI",
    "gpt-5.3-codex",
    rates(1.75, 0.175, null, 14),
    6,
  ),
  entry("GPT-5.4", "OpenAI", "gpt-5.4", rates(2.5, 0.25, null, 15), 6, {
    threshold: 272000,
    rates: rates(5, 0.5, null, 22.5),
  }),
  entry(
    "GPT-5.4 mini",
    "OpenAI",
    "gpt-5.4-mini",
    rates(0.75, 0.075, null, 4.5),
    6,
  ),
  entry("GPT-5.4 nano", "OpenAI", "gpt-5.4-nano", rates(0.2, 0.02, null, 1.25)),
  entry("GPT-5.5", "OpenAI", "gpt-5.5", rates(5, 0.5, null, 30), 57, {
    threshold: 272000,
    rates: rates(10, 1, null, 45),
  }),
  entry(
    "GPT-5.6 Luna",
    "OpenAI",
    "gpt-5.6-luna",
    rates(0.2, 0.02, 0.25, 1.2),
    undefined,
    { threshold: 200000, rates: rates(0.4, 0.04, 0.5, 1.8) },
  ),
  entry(
    "GPT-5.6 Sol",
    "OpenAI",
    "gpt-5.6-sol",
    rates(4, 0.4, 5, 20),
    undefined,
    { threshold: 272000, rates: rates(8, 0.8, 10, 30) },
  ),
  entry(
    "GPT-5.6 Terra",
    "OpenAI",
    "gpt-5.6-terra",
    rates(2, 0.2, 2.5, 12),
    undefined,
    { threshold: 272000, rates: rates(4, 0.4, 5, 18) },
  ),
  entry(
    "GPT-6 Astra",
    "OpenAI",
    "gpt-6-astra",
    rates(10, 1, 12.5, 50),
    undefined,
    { threshold: 272000, rates: rates(20, 2, 25, 75) },
  ),
  entry(
    "Claude Haiku 4.5",
    "Anthropic",
    "claude-haiku-4.5",
    rates(1, 0.1, 1.25, 5),
    0.33,
  ),
  entry(
    "Claude Sonnet 4",
    "Anthropic",
    "claude-sonnet-4",
    rates(3, 0.3, 3.75, 15),
  ),
  entry(
    "Claude Sonnet 4.6",
    "Anthropic",
    "claude-sonnet-4.6",
    rates(3, 0.3, 3.75, 15),
    9,
  ),
  entry(
    "Claude Opus 4.7",
    "Anthropic",
    "claude-opus-4.7",
    rates(5, 0.5, 6.25, 25),
    27,
  ),
  entry(
    "Claude Opus 4.8",
    "Anthropic",
    "claude-opus-4.8",
    rates(5, 0.5, 6.25, 25),
    27,
  ),
  entry("Claude Opus 5", "Anthropic", "claude-opus-5", rates(5, 0.5, 6.25, 25)),
  entry(
    "Claude Sonnet 5",
    "Anthropic",
    "claude-sonnet-5",
    rates(2, 0.2, 2.5, 10),
  ),
  entry(
    "Claude Opus 4.8 (fast mode)",
    "Anthropic",
    "claude-opus-4.8-fast",
    rates(10, 1, 12.5, 50),
  ),
  entry(
    "Claude Fable 5",
    "Anthropic",
    "claude-fable-5",
    rates(10, 1, 12.5, 50),
  ),
  entry(
    "Claude Fable 5.1",
    "Anthropic",
    "claude-fable-5.1",
    rates(10, 0.25, 12.5, 50),
  ),
  entry(
    "Gemini 3.5 Flash",
    "Google",
    "gemini-3.5-flash",
    rates(1.5, 0.15, null, 9),
    14,
  ),
  ...["3.6", "3.7", "3.8"].map((v) => ({
    ...entry(
      `Gemini ${v} Flash`,
      "Google",
      `gemini-${v}-flash`,
      rates(0.75, 0.075, null, 3.75),
    ),
    expires: "2026-12-31",
  })),
  entry(
    "MAI-Code-1-Flash",
    "Microsoft",
    "mai-code-1-flash",
    rates(0.75, 0.075, null, 4.5),
    0.33,
  ),
  entry(
    "MAI-Code-1.1-Flash",
    "Microsoft",
    "mai-code-1.1-flash",
    rates(0.2, 0.02, null, 1.2),
    0.25,
  ),
  ...["4.5", "4.6"].map((v) =>
    entry(`Grok ${v}`, "xAI", `grok-${v}`, rates(2, 0.5, null, 6), undefined, {
      threshold: 200000,
      rates: rates(4, 1, null, 12),
    }),
  ),
  entry(
    "Kimi K2.7 Code",
    "Moonshot AI",
    "kimi-k2.7-code",
    rates(0.95, 0.19, null, 4),
  ),
  entry("Kimi K3", "Moonshot AI", "kimi-k3", rates(3, 0.3, null, 15)),
  ...[
    ["Gemini 3 Pro", "Google", "gemini-3-pro", 6],
    ["GPT-4o", "OpenAI", "gpt-4o", 0.33],
    ["GPT-4o mini", "OpenAI", "gpt-4o-mini", 0.33],
    ["GPT-5.1", "OpenAI", "gpt-5.1", 3],
    ["GPT-5.1-Codex", "OpenAI", "gpt-5.1-codex", 3],
    ["GPT-5.1-Codex-Mini", "OpenAI", "gpt-5.1-codex-mini", 0.33],
    ["GPT-5.1-Codex-Max", "OpenAI", "gpt-5.1-codex-max", 3],
  ].map(([n, p, id, m]) =>
    entry(n as string, p as string, id as string, undefined, m as number),
  ),
];
