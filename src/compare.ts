import { catalog } from "./catalog";
import { opencodeBenchmarkFamilies } from "./opencode";
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
    !["copilot", "opencode"].includes(v.source) ||
    !["general", "coding", "agentic"].includes(v.preset) ||
    !["credits", "legacy", "usd"].includes(v.billing) ||
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
      recommendation.budgets.usd,
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
    source: v.source,
    preset: v.preset,
    billing: v.billing,
    plan: v.plan,
    filter: v.filter,
    recommendation: {
      mode: recommendation.mode,
      budgets: {
        credits: recommendation.budgets.credits,
        legacy: recommendation.budgets.legacy,
        usd: recommendation.budgets.usd,
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
/** Tolerant merge for pre-source settings; still validated by parseOptions. */
export function migrateOptions(value: unknown): unknown {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const stored = object(v.recommendation)
      ? (v.recommendation as Record<string, unknown>)
      : {};
    const budgets = object(stored.budgets)
      ? (stored.budgets as Record<string, unknown>)
      : {};
    return {
      source: "copilot",
      ...(value as Record<string, unknown>),
      recommendation: {
        ...structuredClone(defaults.recommendation),
        ...stored,
        budgets: {
          ...structuredClone(defaults.recommendation.budgets),
          ...budgets,
        },
      },
    };
  }
  return value;
}
export function savedOptions(value: unknown): Options {
  try {
    // v0.1 settings lacked recommendation controls; pre-source settings lack
    // source and USD budgets. Migrate to Copilot defaults, then validate.
    return parseOptions(migrateOptions(value));
  } catch {
    return structuredClone(defaults);
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function estimate(
  entry: CatalogEntry | undefined,
  options: Options,
  now = Date.now(),
): { cost: number | null; tier?: string; reason?: string } {
  if (!entry)
    return { cost: null, reason: "No verified pricing mapping." };
  if (options.billing === "legacy") {
    const m = entry.legacy?.[options.plan];
    return m === undefined
      ? { cost: null, reason: "No documented multiplier for this legacy plan." }
      : { cost: m, tier: "Manual model selection" };
  }
  if (options.billing === "usd") {
    if (entry.freeTier)
      return { cost: 0, tier: "Free tier" };
    const t = options.tokens;
    const long =
      entry.long && t.input + t.read + t.write > entry.long.threshold;
    const r = long ? entry.long!.rates : entry.rates;
    if (!r)
      return { cost: null, reason: "Billed by provider; no verified rate." };
    // Same disjoint-bucket rule as credits; units are USD per workload.
    const cost =
      (t.input * r.input +
        t.read * r.read +
        t.write * (r.write ?? r.input) +
        t.output * r.output) /
      1000000;
    return { cost, tier: long ? "Long context" : "Default context" };
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
      const source = m.source ?? "copilot";
      let entry: CatalogEntry | undefined;
      let crossUnit: string | undefined;
      if (source === "opencode") {
        // Dynamic pricing: rates ride on the discovered model; only the
        // benchmark-family aliases are static.
        const baseRef = m.id.replace(/^opencode:/, "").split("#")[0];
        const baseName = m.name.replace(/\s*\([^()]*\)\s*$/, "");
        const provider = baseRef.split("/")[0] || "OpenCode";
        entry = {
          ids: [m.id],
          name: baseName,
          provider,
          benchmarkFamilies: opencodeBenchmarkFamilies[baseRef] ?? [baseName],
          ...(m.rates ? { rates: m.rates } : {}),
          ...(m.long ? { long: m.long } : {}),
          ...(m.freeTier
            ? {
                freeTier: true,
                rates: m.rates ?? { input: 0, read: 0, write: null, output: 0 },
              }
            : {}),
        };
        if (options.billing !== "usd")
          crossUnit = "OpenCode models compare in USD billing.";
      } else {
        const matches = entries.filter((e) => e.ids.includes(m.id));
        entry = matches.length === 1 ? matches[0] : undefined;
        if (options.billing === "usd")
          crossUnit = "Copilot models compare in AI credits or legacy billing.";
      }
      const matched = resolveBenchmark(entry, benchmarks, overrides[m.id]);
      const price = crossUnit
        ? { cost: null as number | null, reason: crossUnit }
        : estimate(entry, options);
      const score = matched.benchmark?.scores[options.preset] ?? null;
      const tooLong =
        (options.billing === "credits" || options.billing === "usd") &&
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
          ...(m.pricingNotes ?? []),
          tooLong ? "Input exceeds the model context limit." : undefined,
        ].filter((r): r is string => !!r),
      };
    });
  return markFrontier(rows);
}
