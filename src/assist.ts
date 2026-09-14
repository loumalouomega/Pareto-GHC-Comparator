// Pure, webview-safe (no Node imports). Mapping- and pricing-assistance
// helpers for src/compare.ts: identifier-based benchmark suggestions,
// same-identifier static-registry pricing suggestions for BYOK, and the
// small model-identity helpers moved here to avoid a compare.ts <-> assist.ts
// import cycle (compare.ts re-exports them, so the public API is unchanged).
//
// Suggestions are never applied automatically and never establish a price by
// themselves: resolveBenchmark/estimate in compare.ts are the only source of
// truth for what is actually mapped or priced. See docs/catalog.md.
import { staticEntries, staticPricingSources, staticRegistryDate, type StaticSource } from "./staticSources";
import type {
  AvailableModel,
  Benchmark,
  ByokEntry,
  CatalogEntry,
  RegistryRateSuggestion,
  BenchmarkSuggestion,
} from "./types";

export function baseModelIdOf(id: string): string {
  const withoutPin = id.split("::")[0];
  const withoutSource = withoutPin.includes(":")
    ? withoutPin.slice(withoutPin.indexOf(":") + 1)
    : withoutPin;
  return withoutSource.split("#")[0];
}

/**
 * Thinking label carried by a display name, e.g. "low" for "GPT-5.4 (low)"
 * or "Adaptive Reasoning, Max Effort" for "Claude Opus 5 (Adaptive Reasoning,
 * Max Effort)". Names without a recognized reasoning qualifier are "Standard".
 */
export function thinkingLabelOf(name: string): string {
  const suffix = name.match(/\(([^()]*)\)\s*$/);
  if (!suffix) return "Standard";
  const inner = suffix[1].trim().replace(/\s+/g, " ");
  if (
    !/^(non[- ]reasoning|reasoning|adaptive reasoning|low|medium|high|xhigh|max)\b/i.test(
      inner,
    )
  )
    return "Standard";
  return inner;
}

/** Thinking level reported by a discovered/static model (`#variant` or name). */
export function modelThinkingOf(model: AvailableModel): string {
  const hash = model.id.split("#")[1];
  if (hash && hash.length > 0 && hash.length <= 100) return hash;
  return thinkingLabelOf(model.name);
}

/**
 * The model-identity portion of a base id, lowercased with "." -> "-": the
 * one normalization "exact identifier" matching allows. `openai/gpt-5.6-sol`
 * and `gpt-5.6-sol` both give `gpt-5-6-sol`.
 */
export function identifierOf(baseId: string): string {
  const last = baseId.includes("/")
    ? baseId.slice(baseId.lastIndexOf("/") + 1)
    : baseId;
  return last.toLowerCase().replace(/\./g, "-");
}

const REASONING_SUFFIX =
  "(?:-(?:low|medium|high|xhigh|max|minimal|none|non-reasoning|reasoning|adaptive|thinking))*";
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Benchmark suggestions for an unresolved model: the AA benchmark slug must
 * equal the model's identifier, optionally followed by reasoning-suffix
 * segments. This is deliberately strict (no prefix or fuzzy matching) so
 * `gpt-4o` never suggests `gpt-4o-mini-*`. Always unverified until applied;
 * never used to set status, benchmark, score, or cost.
 */
export function suggestBenchmarks(
  baseId: string,
  thinking: string,
  benchmarks: Benchmark[],
  exclude: ReadonlySet<string>,
): BenchmarkSuggestion[] {
  const identifier = identifierOf(baseId);
  if (!identifier) return [];
  const pattern = new RegExp(`^${escapeRegExp(identifier)}${REASONING_SUFFIX}$`);
  const thinkingLower = thinking.toLowerCase();
  return benchmarks
    .filter((b) => !exclude.has(b.id) && pattern.test(b.slug.toLowerCase()))
    .map(
      (b): BenchmarkSuggestion => ({
        benchmarkId: b.id,
        slug: b.slug,
        name: b.name,
        rule: "identifier-slug",
        identifier,
        sameThinkingLevel: thinkingLabelOf(b.name).toLowerCase() === thinkingLower,
      }),
    )
    .sort(
      (a, b) =>
        Number(b.sameThinkingLevel) - Number(a.sameThinkingLevel) ||
        a.name.localeCompare(b.name) ||
        a.benchmarkId.localeCompare(b.benchmarkId),
    );
}

/**
 * Explicit provider -> static-registry table for pricing suggestions. Each
 * entry must be verified to publish the *same* API list prices as the named
 * OpenCode provider (checked against `staticPricingSources`); do not add a
 * provider here on name similarity alone. Currently only OpenAI's direct API
 * billing (`openai/...` in OpenCode) matches the Codex registry's source
 * (openai.com/api/pricing).
 */
export const providerRegistries: Record<string, StaticSource> = {
  openai: "codex",
};

/**
 * A same-identifier static-registry rate for a provider-billed, unpriced
 * OpenCode model. Returns undefined unless the model needs a rate (OpenCode,
 * not free tier, no CLI rate), its provider is in `providerRegistries`, its
 * OpenCode route is a plain `provider/model` (no nested routes), and exactly
 * one non-expired, priced registry entry has that exact identifier.
 *
 * `entriesOf` is injectable (defaults to the real `staticEntries`) purely so
 * tests can exercise the expiry/staleness branches without depending on
 * which real registry entries happen to carry an `expires` date.
 */
export function registryRateFor(
  model: AvailableModel,
  now = Date.now(),
  entriesOf: (source: StaticSource) => CatalogEntry[] = staticEntries,
): RegistryRateSuggestion | undefined {
  if (model.source !== "opencode" || model.freeTier || model.rates)
    return undefined;
  const ref = model.id.replace(/^opencode:/, "").split("#")[0];
  const segments = ref.split("/");
  if (segments.length !== 2) return undefined;
  const [provider] = segments;
  const registry = providerRegistries[provider];
  if (!registry) return undefined;
  const registryId = `${registry}:${identifierOf(ref)}`;
  const matches = entriesOf(registry).filter((e) => e.ids[0] === registryId);
  if (matches.length !== 1) return undefined;
  const entry = matches[0];
  if (!entry.rates) return undefined;
  if (entry.expires && now >= Date.parse(`${entry.expires}T23:59:59.999Z`))
    return undefined;
  return {
    registry,
    registryId,
    registryName: entry.name,
    registryDate: staticRegistryDate,
    sourceUrl: staticPricingSources[registry],
    rates: entry.rates,
    ...(entry.long ? { long: entry.long } : {}),
  };
}

function ratesEqual(a: RegistryRateSuggestion["rates"], b: RegistryRateSuggestion["rates"]): boolean {
  return a.input === b.input && a.read === b.read && a.write === b.write && a.output === b.output;
}
function longEqual(
  a: RegistryRateSuggestion["long"],
  b: RegistryRateSuggestion["long"],
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.threshold === b.threshold && ratesEqual(a.rates, b.rates);
}

/**
 * Whether an applied registry BYOK rate no longer matches the current
 * registry: "registry-missing" if that exact identifier is gone, unpriced,
 * or expired; "rates-changed" if the registry rate moved. Never rewrites the
 * stored entry; manual entries are never stale.
 */
export function byokStaleness(
  entry: ByokEntry,
  model: AvailableModel,
  now = Date.now(),
  entriesOf: (source: StaticSource) => CatalogEntry[] = staticEntries,
): "rates-changed" | "registry-missing" | undefined {
  if (!entry.source || entry.source.kind !== "registry") return undefined;
  const current = registryRateFor(model, now, entriesOf);
  if (
    !current ||
    current.registry !== entry.source.registry ||
    current.registryId !== entry.source.registryId
  )
    return "registry-missing";
  if (!ratesEqual(current.rates, entry.rates) || !longEqual(current.long, entry.long))
    return "rates-changed";
  return undefined;
}
