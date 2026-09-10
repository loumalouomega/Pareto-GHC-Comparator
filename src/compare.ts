import { catalog } from "./catalog";
import {
  defaults,
  type AvailableModel,
  type Benchmark,
  type CatalogEntry,
  type Options,
  type Row,
  type MappingResult,
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
  const recommendation = v.recommendation;
  if (
    !recommendation ||
    !["budget", "nearBest"].includes(recommendation.mode) ||
    !recommendation.budgets ||
    ![
      recommendation.budgets.credits,
      recommendation.budgets.legacy,
      recommendation.scoreGap,
    ].every(
      (n) =>
        typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100000000,
    )
  ) {
    throw new Error(
      "Budgets and score gap must be nonnegative finite numbers up to 100 million.",
    );
  }
  return {
    preset: v.preset,
    billing: v.billing,
    plan: v.plan,
    filter: v.filter,
    recommendation: {
      mode: recommendation.mode,
      budgets: {
        credits: recommendation.budgets.credits,
        legacy: recommendation.budgets.legacy,
      },
      scoreGap: recommendation.scoreGap,
    },
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
    // v0.1 settings did not contain recommendation controls.
    if (value && typeof value === "object" && !("recommendation" in value)) {
      return parseOptions({
        ...value,
        recommendation: structuredClone(defaults.recommendation),
      });
    }
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
): MappingResult {
  const normalize = (name: string) =>
    name.trim().replace(/\s+/g, " ").toLowerCase();
  const hits = entry
    ? models.filter((model) =>
        entry.benchmarkFamilies.some((alias) => {
          const family = normalize(alias),
            name = normalize(model.name);
          const suffix = name.slice(family.length).trim();
          return (
            name === family ||
            (name.startsWith(`${family} (`) &&
              /^\((?:non[- ]reasoning|reasoning|adaptive reasoning|low|medium|high|xhigh|max)(?:[ ,].*)?\)$/.test(
                suffix,
              ))
          );
        }),
      )
    : [];
  const candidateIds = hits.map((m) => m.id);
  if (override) {
    const found = models.filter((m) => m.id === override);
    return found.length === 1
      ? { status: "user", candidateIds, benchmark: found[0] }
      : {
          status: "missing",
          candidateIds,
          reason:
            "Selected benchmark is no longer available. Choose a variant or reset the mapping.",
        };
  }
  if (hits.length === 1)
    return { status: "exact", candidateIds, benchmark: hits[0] };
  return {
    status: hits.length ? "selection" : "missing",
    candidateIds,
    reason: hits.length
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
        mappingStatus: matched.status,
        candidateIds: matched.candidateIds,
        selectedBenchmarkId: overrides[m.id],
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
