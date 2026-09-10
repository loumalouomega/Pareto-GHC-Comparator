import { catalog } from "./catalog";
import {
  defaults,
  type AvailableModel,
  type Benchmark,
  type CatalogEntry,
  type Options,
  type Row,
} from "./types";
export function parseOptions(value: unknown): Options {
  const v = value as Options;
  if (
    !v ||
    !["general", "coding", "agentic"].includes(v.preset) ||
    !["credits", "legacy"].includes(v.billing) ||
    !["pro", "proPlus"].includes(v.plan) ||
    typeof v.filter !== "string" ||
    v.filter.length > 200 ||
    !v.tokens ||
    !["input", "read", "write", "output"].every(
      (k) =>
        Number.isSafeInteger(v.tokens[k as keyof typeof v.tokens]) &&
        v.tokens[k as keyof typeof v.tokens] >= 0 &&
        v.tokens[k as keyof typeof v.tokens] <= 100000000,
    )
  )
    throw new Error(
      "Enter nonnegative whole token counts (up to 100 million).",
    );
  return {
    preset: v.preset,
    billing: v.billing,
    plan: v.plan,
    filter: v.filter,
    tokens: {
      input: v.tokens.input,
      read: v.tokens.read,
      write: v.tokens.write,
      output: v.tokens.output,
    },
  };
}
export function savedOptions(value: unknown): Options {
  try {
    return parseOptions(value);
  } catch {
    return structuredClone(defaults);
  }
}
export function estimate(
  entry: CatalogEntry | undefined,
  options: Options,
  now = Date.now(),
): { cost: number | null; tier?: string; reason?: string } {
  if (!entry)
    return { cost: null, reason: "No verified Copilot pricing mapping." };
  if (options.billing === "legacy") {
    const m = entry.legacy?.[options.plan];
    return m === undefined
      ? { cost: null, reason: "No documented multiplier for this legacy plan." }
      : { cost: m, tier: "Manual model selection" };
  }
  if (entry.expires && now >= Date.parse(`${entry.expires}T23:59:59.999Z`))
    return {
      cost: null,
      reason: "Promotional pricing expired; catalog update needed.",
    };
  const t = options.tokens;
  const long = entry.long && t.input + t.read + t.write > entry.long.threshold;
  const r = long ? entry.long!.rates : entry.rates;
  if (!r) return { cost: null, reason: "No current AI-credit pricing." };
  // Token buckets are disjoint. Cache writes replace normal input billing where a write rate exists.
  const cost =
    (t.input * r.input +
      t.read * r.read +
      t.write * (r.write ?? r.input) +
      t.output * r.output) /
    10000;
  return { cost, tier: long ? "Long context" : "Default context" };
}
export function resolveBenchmark(
  entry: CatalogEntry | undefined,
  models: Benchmark[],
  override?: string,
): { benchmark?: Benchmark; reason?: string } {
  if (override) {
    const found = models.filter((m) => m.id === override);
    return found.length === 1
      ? { benchmark: found[0] }
      : { reason: "Selected benchmark is no longer available." };
  }
  const hits = entry
    ? models.filter((m) =>
        entry.benchmarkNames.some(
          (n) => n.toLowerCase() === m.name.toLowerCase(),
        ),
      )
    : [];
  return hits.length === 1
    ? { benchmark: hits[0] }
    : {
        reason:
          hits.length > 1
            ? "Ambiguous benchmark variants; select one in model details."
            : "No exact benchmark mapping; select one in model details.",
      };
}
export function markFrontier(rows: Row[]): Row[] {
  return rows.map((a) => {
    const dominatedBy =
      a.cost === null || a.score === null
        ? []
        : rows
            .filter(
              (b) =>
                b.cost !== null &&
                b.score !== null &&
                b.cost <= a.cost! &&
                b.score >= a.score! &&
                (b.cost < a.cost! || b.score > a.score!),
            )
            .map((b) => b.name);
    return {
      ...a,
      dominatedBy,
      frontier: a.cost !== null && a.score !== null && dominatedBy.length === 0,
    };
  });
}
export function compare(
  available: AvailableModel[],
  benchmarks: Benchmark[],
  options: Options,
  overrides: Record<string, string> = {},
  entries = catalog,
): Row[] {
  const rows = available
    .filter((m) =>
      `${m.name} ${m.id}`.toLowerCase().includes(options.filter.toLowerCase()),
    )
    .map((m) => {
      const matches = entries.filter((e) => e.ids.includes(m.id));
      const entry = matches.length === 1 ? matches[0] : undefined;
      const matched = resolveBenchmark(entry, benchmarks, overrides[m.id]);
      const price = estimate(entry, options);
      const score = matched.benchmark?.scores[options.preset] ?? null;
      const tooLong =
        options.billing === "credits" &&
        m.maxInputTokens > 0 &&
        options.tokens.input + options.tokens.read + options.tokens.write >
          m.maxInputTokens;
      return {
        id: m.id,
        name: m.name,
        provider: entry?.provider ?? matched.benchmark?.provider ?? "Unknown",
        score,
        cost: tooLong ? null : price.cost,
        frontier: false,
        dominatedBy: [],
        benchmark: matched.benchmark,
        tier: price.tier,
        reasons: [
          matched.reason,
          score === null && matched.benchmark
            ? "Selected benchmark has no score for this preset."
            : undefined,
          price.reason,
          tooLong ? "Input exceeds the model context limit." : undefined,
        ].filter((r): r is string => !!r),
      };
    });
  return markFrontier(rows);
}
