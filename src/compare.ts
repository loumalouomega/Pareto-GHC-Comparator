import { catalog } from "./catalog";
import { opencodeBenchmarkFamilies } from "./opencode";
import { staticEntries, isStaticSource } from "./staticSources";
import { allowedBilling } from "./sources";
import { parseScenario } from "./plans";
import {
  defaults,
  type AvailableModel,
  type Benchmark,
  type ByokEntry,
  type ByokStore,
  type CatalogEntry,
  type CostBreakdown,
  type MappingIssue,
  type Options,
  type PricingInfo,
  type PricingIssue,
  type Row,
  type Source,
  type MappingResult,
} from "./types";
const validSources: Source[] = [
  "copilot",
  "opencode",
  "claude-code",
  "codex",
  "gemini-cli",
  "cursor",
  "windsurf",
  "aider",
  "amazon-q",
];
export function parseOptions(value: unknown): Options {
  const v = value as Options;
  if (
    !v ||
    !validSources.includes(v.source) ||
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
  const display = (v.display ?? {}) as unknown as Record<string, unknown>;
  const displayRecord = display;
  const labels =
    displayRecord.labels === undefined ? true : displayRecord.labels === true;
  const frontier =
    displayRecord.frontier === undefined
      ? true
      : displayRecord.frontier === true;
  const scale =
    displayRecord.scale === "log" ||
    displayRecord.scale === "linear" ||
    displayRecord.scale === "auto"
      ? displayRecord.scale
      : "auto";
  const chart =
    displayRecord.chart === "workload" || displayRecord.chart === "task"
      ? displayRecord.chart
      : "task";
  const quadrant =
    displayRecord.quadrant === undefined
      ? true
      : displayRecord.quadrant === true;
  const sort =
    displayRecord.sort === "efficiency" ? "efficiency" : "default";
  if (!allowedBilling(v.source).includes(v.billing))
    throw new Error("That billing mode is not available for this source.");
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
    display: { labels, frontier, scale, chart, quadrant, sort },
    freeOnly: v.freeOnly === true,
    onlyMine: v.onlyMine === true,
    tokens: {
      input: v.tokens.input,
      read: v.tokens.read,
      write: v.tokens.write,
      output: v.tokens.output,
    },
    // Tolerant on its own: never throws, so a corrupted scenario can't reset
    // the rest of a saved options/profile/comparison-side object.
    scenario: parseScenario(v.scenario),
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
    const display = object(v.display)
      ? (v.display as Record<string, unknown>)
      : {};
    const source =
      typeof v.source === "string" && validSources.includes(v.source as Source)
        ? v.source
        : "copilot";
    const billing =
      typeof v.billing === "string" &&
      allowedBilling(source as Source).includes(
        v.billing as Options["billing"],
      )
        ? v.billing
        : source === "copilot"
          ? "credits"
          : "usd";
    return {
      ...(value as Record<string, unknown>),
      source,
      billing,
      recommendation: {
        ...structuredClone(defaults.recommendation),
        ...stored,
        budgets: {
          ...structuredClone(defaults.recommendation.budgets),
          ...budgets,
        },
      },
      display: { ...structuredClone(defaults.display), ...display },
      freeOnly: v.freeOnly === true,
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
/**
 * Tolerant loader for the saved benchmark-mapping overrides: keeps every
 * valid modelId -> benchmarkId string entry and drops invalid ones
 * individually, so one corrupted entry never discards every saved choice.
 */
export function loadMappings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= 5000) break;
    if (
      typeof k === "string" &&
      k.length >= 1 &&
      k.length <= 1000 &&
      typeof v === "string" &&
      v.length >= 1 &&
      v.length <= 1000
    ) {
      out[k] = v;
      count++;
    }
  }
  return out;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function estimate(
  entry: CatalogEntry | undefined,
  options: Options,
  now = Date.now(),
): {
  cost: number | null;
  tier?: string;
  reason?: string;
  breakdown?: CostBreakdown;
  issue?: PricingIssue;
} {
  if (!entry)
    return { cost: null, reason: "No verified pricing mapping." };
  if (options.billing === "legacy") {
    const m = entry.legacy?.[options.plan];
    return m === undefined
      ? {
          cost: null,
          reason: "No documented multiplier for this legacy plan.",
          issue: "legacy-no-multiplier",
        }
      : { cost: m, tier: "Manual model selection" };
  }
  if (entry.expires && now >= Date.parse(`${entry.expires}T23:59:59.999Z`))
    return {
      cost: null,
      reason: "Promotional pricing expired; catalog update needed.",
      issue: "promo-expired",
    };
  if (options.billing === "usd") {
    if (entry.freeTier)
      return {
        cost: 0,
        tier: "Free tier",
        breakdown: {
          inputTokens: options.tokens.input,
          readTokens: options.tokens.read,
          writeTokens: options.tokens.write,
          outputTokens: options.tokens.output,
          rates: { input: 0, read: 0, write: null, output: 0 },
          divisor: 1000000,
          tier: "Free tier",
          unit: "USD",
        },
      };
    const t = options.tokens;
    const long =
      entry.long && t.input + t.read + t.write > entry.long.threshold;
    const r = long ? entry.long!.rates : entry.rates;
    if (!r)
      return {
        cost: null,
        reason: "Billed by provider; no verified rate.",
        issue: "provider-billed-no-rate",
      };
    // Same disjoint-bucket rule as credits; units are USD per workload.
    const cost =
      (t.input * r.input +
        t.read * r.read +
        t.write * (r.write ?? r.input) +
        t.output * r.output) /
      1000000;
    const tier = long ? "Long context" : "Default context";
    const breakdown: CostBreakdown = {
      inputTokens: t.input,
      readTokens: t.read,
      writeTokens: t.write,
      outputTokens: t.output,
      rates: r,
      divisor: 1000000,
      tier,
      unit: "USD",
    };
    return { cost, tier, breakdown };
  }
  const t = options.tokens;
  const long = entry.long && t.input + t.read + t.write > entry.long.threshold;
  const r = long ? entry.long!.rates : entry.rates;
  if (!r)
    return {
      cost: null,
      reason: "No current AI-credit pricing.",
      issue: "no-credit-rates",
    };
  // Token buckets are disjoint. Cache writes replace normal input billing where a write rate exists.
  const cost =
    (t.input * r.input +
      t.read * r.read +
      t.write * (r.write ?? r.input) +
      t.output * r.output) /
    10000;
  const tier = long ? "Long context" : "Default context";
  return {
    cost,
    tier,
    breakdown: {
      inputTokens: t.input,
      readTokens: t.read,
      writeTokens: t.write,
      outputTokens: t.output,
      rates: r,
      divisor: 10000,
      tier,
      unit: "AI credits",
    },
  };
}
/**
 * Fixed illustrative token mix for the "cost per task" chart view, mirroring
 * the Artificial Analysis "Cost per Intelligence Index Task" concept: a
 * workload-independent per-task cost derived from the same catalog rates as
 * the editable workload estimate. Weights are not AA's official evaluation
 * weights (undisclosed in the Free API); they are a documented proxy so
 * models stay comparable without depending on the user's token inputs.
 */
export const taskMix = { input: 1000, read: 0, write: 0, output: 1000 };
export function taskCost(
  entry: CatalogEntry | undefined,
  options: Options,
  now = Date.now(),
): {
  cost: number | null;
  tier?: string;
  reason?: string;
  breakdown?: CostBreakdown;
  issue?: PricingIssue;
} {
  if (options.billing === "legacy") return estimate(entry, options, now);
  return estimate(
    entry,
    { ...options, tokens: { ...taskMix } },
    now,
  );
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
export { efficiencyOf, sortRowsByEfficiency } from "./efficiency";
export {
  baseModelIdOf,
  thinkingLabelOf,
  modelThinkingOf,
  identifierOf,
  suggestBenchmarks,
  providerRegistries,
  registryRateFor,
  byokStaleness,
} from "./assist";
import {
  baseModelIdOf,
  thinkingLabelOf,
  modelThinkingOf,
  suggestBenchmarks,
  registryRateFor,
  byokStaleness,
} from "./assist";

/** Display name for one auto-expanded variant row. */
export function variantDisplayName(
  modelName: string,
  benchmarkName: string,
): string {
  if (modelName === benchmarkName) return modelName;
  const suffix = benchmarkName.match(/\s*\([^()]*\)\s*$/);
  if (suffix && modelName.endsWith(suffix[0].trim())) return modelName;
  return `${modelName} · ${benchmarkName}`;
}

export function pinRowId(modelId: string, benchmarkId: string): string {
  return `${modelId}::${benchmarkId}`;
}

export function compare(
  available: AvailableModel[],
  benchmarks: Benchmark[],
  options: Options,
  overrides: Record<string, string> = {},
  entries = catalog,
  extra: {
    pins?: Record<string, string[]>;
    excluded?: string[];
    byok?: ByokStore;
    usedCounts?: Map<string, number>;
  } = {},
): Row[] {
  const pins = extra.pins ?? {};
  const excluded = new Set(extra.excluded ?? []);
  const byok = extra.byok ?? {};
  const usedCounts = extra.usedCounts ?? new Map<string, number>();
  const byId = new Map(benchmarks.map((b) => [b.id, b]));
  const now = Date.now();
  const rows = available
    .filter((m) => !excluded.has(m.id))
    .filter(
      (m) =>
        !options.freeOnly ||
        options.source !== "opencode" ||
        m.freeTier === true,
    )
    .filter(
      (m) =>
        !options.onlyMine ||
        (usedCounts.get(m.id) ?? usedCounts.get(baseModelIdOf(m.id)) ?? 0) > 0,
    )
    .filter((m) =>
      `${m.name} ${m.id}`.toLowerCase().includes(options.filter.toLowerCase()),
    )
    .flatMap((m) => {
      const source = m.source ?? "copilot";
      let entry: CatalogEntry | undefined;
      let crossUnit: string | undefined;
      let byokNote: string | undefined;
      let byokEntry: ByokEntry | undefined;
      // Zero vs several catalog matches, for the pricing/mapping "why
      // unresolved" explanation. Unset for OpenCode, whose entry is always a
      // synthetic one built from the discovered model, never absent.
      let catalogIssue: "no-catalog-entry" | "ambiguous-catalog-entry" | undefined;
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
        // Explicit user-supplied fallback for provider-billed models the CLI
        // leaves unpriced. Free-tier zero costs are never overridden.
        byokEntry = !m.freeTier && !m.rates ? byok[m.id] : undefined;
        if (byokEntry) {
          entry = {
            ...entry,
            rates: byokEntry.rates,
            ...(byokEntry.long ? { long: byokEntry.long } : {}),
          };
          byokNote = "User-supplied BYOK rate; not verified by CLI.";
        }
        if (options.billing !== "usd")
          crossUnit = "OpenCode models compare in USD billing.";
      } else if (isStaticSource(source)) {
        const matches = staticEntries(source).filter((e) =>
          e.ids.includes(m.id),
        );
        entry = matches.length === 1 ? matches[0] : undefined;
        if (matches.length === 0) catalogIssue = "no-catalog-entry";
        else if (matches.length > 1) catalogIssue = "ambiguous-catalog-entry";
        if (options.billing !== "usd")
          crossUnit = `${m.source} models compare in USD billing.`;
      } else {
        const matches = entries.filter((e) => e.ids.includes(m.id));
        entry = matches.length === 1 ? matches[0] : undefined;
        if (matches.length === 0) catalogIssue = "no-catalog-entry";
        else if (matches.length > 1) catalogIssue = "ambiguous-catalog-entry";
        if (options.billing === "usd")
          crossUnit = "Copilot models compare in AI credits or legacy billing.";
      }
      // A same-identifier static-registry rate for an unpriced, provider-billed
      // OpenCode model; undefined for every other source. Unverified until the
      // user explicitly applies it (byokApply), which is the only way a BYOK
      // entry gets "registry" provenance.
      const registrySuggestion = registryRateFor(m, now);
      const baseId = baseModelIdOf(m.id);
      const buildRow = (
        rowId: string,
        matched: MappingResult,
        overrideId: string | undefined,
        ids: { pinnedBenchmarkId?: string; expandedBenchmarkId?: string },
        displayName: string,
      ): Row => {
        const taskView = options.display.chart === "task";
        const price = crossUnit
          ? {
              cost: null as number | null,
              reason: crossUnit,
              issue: "cross-unit" as PricingIssue,
            }
          : taskView
            ? taskCost(entry, options)
            : estimate(entry, options);
        const score = matched.benchmark?.scores[options.preset] ?? null;
        const taskTokens = taskView ? taskMix : options.tokens;
        const tooLong =
          !taskView &&
          (options.billing === "credits" || options.billing === "usd") &&
          m.maxInputTokens > 0 &&
          taskTokens.input + taskTokens.read + taskTokens.write >
            m.maxInputTokens;

        // Pricing provenance never depends on benchmark mapping: an override
        // or pin here never changes what is computed below.
        let pricing: PricingInfo;
        if (crossUnit) {
          pricing = {
            status: "not-comparable",
            source: "none",
            issue: "cross-unit",
            reason: crossUnit,
          };
        } else if (byokEntry) {
          const stale = byokStaleness(byokEntry, m, now);
          pricing = {
            status: "byok",
            source: "byok",
            byok: {
              provenance: byokEntry.source ?? { kind: "manual" },
              ...(stale ? { stale } : {}),
            },
            ...(stale && registrySuggestion ? { suggestion: registrySuggestion } : {}),
            ...(tooLong
              ? {
                  issue: "context-exceeded" as const,
                  reason: "Input exceeds the model context limit.",
                }
              : {}),
          };
        } else if (entry?.freeTier) {
          pricing = {
            status: "free",
            source: source === "opencode" ? "opencode-cli" : "static-registry",
          };
        } else if (price.cost !== null && !tooLong) {
          pricing = {
            status: "priced",
            source:
              source === "opencode"
                ? "opencode-cli"
                : isStaticSource(source)
                  ? "static-registry"
                  : price.tier === "Manual model selection"
                    ? "legacy-multiplier"
                    : "copilot-catalog",
          };
        } else {
          const issue: PricingIssue | undefined = tooLong
            ? "context-exceeded"
            : (catalogIssue ??
              (isStaticSource(source) && price.issue === "provider-billed-no-rate"
                ? "registry-unpriced"
                : price.issue));
          pricing = {
            status: "unresolved",
            source: "none",
            ...(issue ? { issue } : {}),
            reason: tooLong
              ? "Input exceeds the model context limit."
              : price.reason,
            ...(source === "opencode" && registrySuggestion
              ? { suggestion: registrySuggestion }
              : {}),
          };
        }

        // Benchmark-mapping explanation and unverified suggestions, only for
        // rows that are actually unresolved. Never touches status, benchmark,
        // score, or cost.
        let mapping: Row["mapping"];
        if (matched.status === "missing") {
          const issue: MappingIssue =
            benchmarks.length === 0
              ? "no-snapshot"
              : overrideId
                ? ids.pinnedBenchmarkId
                  ? "pin-stale"
                  : "override-stale"
                : (catalogIssue ?? "no-alias-hit");
          mapping = {
            issue,
            reason: matched.reason,
            aliases: entry?.benchmarkFamilies ?? [],
            ...(overrideId ? { staleBenchmarkId: overrideId } : {}),
            suggestions:
              issue === "no-snapshot"
                ? []
                : suggestBenchmarks(
                    baseId,
                    modelThinkingOf(m),
                    benchmarks,
                    new Set(matched.candidateIds),
                  ),
          };
        }

        return {
          id: rowId,
          modelId: m.id,
          baseModelId: baseId,
          requests: usedCounts.get(m.id) ?? usedCounts.get(baseId) ?? 0,
          name: displayName,
          provider: entry?.provider ?? matched.benchmark?.provider ?? "Unknown",
          score,
          cost: tooLong ? null : (price.cost ?? null),
          frontier: false,
          dominatedBy: [],
          benchmark: matched.benchmark,
          mappingStatus: matched.status,
          candidateIds: matched.candidateIds,
          selectedBenchmarkId: overrideId,
          ...(ids.pinnedBenchmarkId
            ? { pinnedBenchmarkId: ids.pinnedBenchmarkId }
            : {}),
          ...(ids.expandedBenchmarkId
            ? { expandedBenchmarkId: ids.expandedBenchmarkId }
            : {}),
          ...(mapping ? { mapping } : {}),
          pricing,
          tier:
            byokNote && price.tier ? `${price.tier} · BYOK` : price.tier,
          breakdown: tooLong ? undefined : price.breakdown,
          reasons: [
            matched.reason,
            score === null && matched.benchmark
              ? "Selected benchmark has no score for this preset."
              : undefined,
            price.reason,
            byokNote,
            ...(m.pricingNotes ?? []),
            tooLong ? "Input exceeds the model context limit." : undefined,
          ].filter((r): r is string => !!r),
        };
      };
      const pinnedName = (benchmark: Benchmark | undefined, fallback: string) =>
        benchmark ? `${m.name} · ${benchmark.name}` : `${m.name} · ${fallback}`;
      // A pin whose benchmark id no longer resolves is kept as its own
      // "pin-stale" row (via resolveBenchmark below), never silently dropped
      // or replaced by automatic rows — the same no-silent-substitution rule
      // as a stale manual override. Before a snapshot has ever loaded,
      // benchmarks is empty and every pin is withheld until refresh.
      const modelPins = (pins[m.id] ?? []).filter(
        (b) => typeof b === "string" && benchmarks.length > 0,
      );
      const overrideId = overrides[m.id];
      if (overrideId || modelPins.length > 0) {
        // Explicit user choices keep single-row (mapping) or pinned-row behavior.
        if (modelPins.length === 0)
          return [
            buildRow(
              m.id,
              resolveBenchmark(entry, benchmarks, overrideId),
              overrideId,
              {},
              m.name,
            ),
          ];
        return modelPins.map((b) => {
          const matched = resolveBenchmark(entry, benchmarks, b);
          return buildRow(pinRowId(m.id, b), matched, b, {
            pinnedBenchmarkId: b,
          }, pinnedName(matched.benchmark, b));
        });
      }
      const automatic = resolveBenchmark(entry, benchmarks, undefined);
      if (automatic.status !== "selection") {
        return [buildRow(m.id, automatic, undefined, {}, m.name)];
      }
      const candidates = automatic.candidateIds
        .map((id) => byId.get(id))
        .filter((b): b is Benchmark => !!b)
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
      if (!candidates.length) {
        return [buildRow(m.id, automatic, undefined, {}, m.name)];
      }
      // A model reporting its own thinking level resolves to that same level.
      const reported = modelThinkingOf(m).toLowerCase();
      if (reported !== "standard") {
        const same = candidates.filter(
          (b) => thinkingLabelOf(b.name).toLowerCase() === reported,
        );
        if (same.length === 1) {
          const matched: MappingResult = {
            status: "exact",
            candidateIds: automatic.candidateIds,
            benchmark: same[0],
          };
          return [
            buildRow(m.id, matched, undefined, {}, variantDisplayName(m.name, same[0].name)),
          ];
        }
      }
      // Otherwise each benchmark variant becomes its own comparable row with
      // its own thinking-level checkbox, instead of blocking on manual choice.
      return candidates.map((b) => {
        const matched: MappingResult = {
          status: "exact",
          candidateIds: automatic.candidateIds,
          benchmark: b,
        };
        return buildRow(pinRowId(m.id, b.id), matched, undefined, {
          expandedBenchmarkId: b.id,
        }, variantDisplayName(m.name, b.name));
      });
    })
    // Variant-level exclusions (modelId::benchmarkId) hide one expanded or
    // pinned row; whole-model exclusions were already applied above.
    .filter((r) => !excluded.has(r.id));
  return markFrontier(rows);
}

export function freeSpotlight(
  available: AvailableModel[],
  benchmarks: Benchmark[],
  options: Options,
  overrides: Record<string, string> = {},
  entries = catalog,
  extra: {
    pins?: Record<string, string[]>;
    excluded?: string[];
    byok?: ByokStore;
    usedCounts?: Map<string, number>;
  } = {},
): {
  bestFree?: { id: string; name: string; score: number };
  bestOverall?: { id: string; name: string; score: number };
  gapPoints?: number;
  cheapestToBest?: { id: string; name: string; cost: number };
} {
  if (options.source !== "opencode" || options.billing !== "usd") return {};
  const baseline = { ...options, freeOnly: false, onlyMine: false };
  const all = compare(available, benchmarks, baseline, overrides, entries, {
    ...extra,
    // Baseline uses checklist/filter but ignores the free-only restriction.
  }).filter((r) => r.cost !== null && r.score !== null);
  if (!all.length) return {};
  const bestOverall = [...all].sort(
    (a, b) => b.score! - a.score! || a.cost! - b.cost!,
  )[0];
  const free = all.filter((r) =>
    available.find((m) => m.id === r.modelId)?.freeTier,
  );
  if (!free.length) return { bestOverall: pick(bestOverall) };
  const bestFree = [...free].sort(
    (a, b) => b.score! - a.score! || a.cost! - b.cost!,
  )[0];
  const paidAtBest = all
    .filter(
      (r) =>
        !available.find((m) => m.id === r.modelId)?.freeTier &&
        r.score! >= bestOverall.score!,
    )
    .sort((a, b) => a.cost! - b.cost! || b.score! - a.score!)[0];
  return {
    bestFree: pick(bestFree),
    bestOverall: pick(bestOverall),
    gapPoints: bestOverall.score! - bestFree.score!,
    ...(paidAtBest
      ? { cheapestToBest: { id: paidAtBest.id, name: paidAtBest.name, cost: paidAtBest.cost! } }
      : {}),
  };
}
function pick(r: Row): { id: string; name: string; score: number } {
  return { id: r.id, name: r.name, score: r.score! };
}
