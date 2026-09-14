import { test } from "vitest";
import assert from "node:assert/strict";
import {
  identifierOf,
  suggestBenchmarks,
  providerRegistries,
  registryRateFor,
  byokStaleness,
} from "../src/assist";
import {
  staticEntries,
  staticPricingSources,
  staticRegistryDate,
  type StaticSource,
} from "../src/staticSources";
import type { AvailableModel, Benchmark, CatalogEntry } from "../src/types";

const bench = (id: string, slug: string, name: string): Benchmark => ({
  id,
  slug,
  name,
  provider: "Test",
  scores: { general: 80, coding: 80, agentic: 80 },
});

test("identifierOf normalizes only the last path segment and dots to dashes", () => {
  assert.equal(identifierOf("gpt-4o"), "gpt-4o");
  assert.equal(identifierOf("gemini-3-pro"), "gemini-3-pro");
  assert.equal(identifierOf("openai/gpt-5.4"), "gpt-5-4");
  assert.equal(identifierOf("mimo-v2.5-pro"), "mimo-v2-5-pro");
  assert.equal(identifierOf("opencode-go/deepseek-v4-pro"), "deepseek-v4-pro");
});

test("suggestBenchmarks matches only an exact identifier plus reasoning suffixes", () => {
  const benchmarks = [
    bench("b1", "gpt-4o", "GPT-4o"),
    bench("b2", "gpt-4o-mini", "GPT-4o mini"),
    bench("b3", "gpt-4o-mini-realtime", "GPT-4o mini realtime"),
  ];
  const hits = suggestBenchmarks("gpt-4o", "Standard", benchmarks, new Set());
  assert.deepEqual(hits.map((h) => h.benchmarkId), ["b1"]);
  assert.equal(hits[0].rule, "identifier-slug");
  assert.equal(hits[0].identifier, "gpt-4o");
  // A -fast suffix is not a recognized reasoning qualifier.
  const fastOnly = suggestBenchmarks(
    "openai/gpt-5.5",
    "Standard",
    [bench("b4", "gpt-5-5-fast", "GPT-5.5 fast")],
    new Set(),
  );
  assert.deepEqual(fastOnly, []);
  // A prefix match alone is rejected (gpt-4o must not suggest gpt-4o-mini).
  const prefixOnly = suggestBenchmarks(
    "gpt-4o",
    "Standard",
    [bench("b2", "gpt-4o-mini", "GPT-4o mini")],
    new Set(),
  );
  assert.deepEqual(prefixOnly, []);
});

test("suggestBenchmarks recognizes real identifier-slug matches from Artificial Analysis data", () => {
  const benchmarks = [
    bench("g1", "gemini-3-pro-low", "Gemini 3 Pro (low)"),
    bench("g2", "gemini-3-pro", "Gemini 3 Pro"),
    bench("g3", "gemini-3-pro-preview", "Gemini 3 Pro preview"),
  ];
  const hits = suggestBenchmarks("gemini-3-pro", "Standard", benchmarks, new Set());
  assert.deepEqual(
    hits.map((h) => h.benchmarkId).sort(),
    ["g1", "g2"],
  );
  assert.ok(!hits.some((h) => h.benchmarkId === "g3"));
});

test("suggestBenchmarks excludes already-known candidates and sorts same thinking level first", () => {
  const benchmarks = [
    bench("h1", "gpt-4o-high", "GPT-4o (high)"),
    bench("h2", "gpt-4o-low", "GPT-4o (low)"),
    bench("h3", "gpt-4o", "GPT-4o"),
  ];
  const excluded = suggestBenchmarks("gpt-4o", "high", benchmarks, new Set(["h3"]));
  assert.deepEqual(
    excluded.map((h) => h.benchmarkId),
    ["h1", "h2"],
  );
  assert.equal(excluded[0].sameThinkingLevel, true);
  assert.equal(excluded[1].sameThinkingLevel, false);
});

test("identifierOf returning empty gives no suggestions instead of matching everything", () => {
  assert.deepEqual(
    suggestBenchmarks("", "Standard", [bench("x", "", "Empty")], new Set()),
    [],
  );
});

test("providerRegistries entries point at that provider's own API pricing page", () => {
  assert.deepEqual(providerRegistries, { openai: "codex" });
  for (const registry of Object.values(providerRegistries) as StaticSource[]) {
    assert.ok(staticPricingSources[registry].startsWith("https://"));
  }
  assert.equal(staticPricingSources.codex, "https://openai.com/api/pricing");
});

const opencodeModel = (id: string, extra: Partial<AvailableModel> = {}): AvailableModel => ({
  id,
  name: id,
  family: id,
  maxInputTokens: 400000,
  source: "opencode",
  ...extra,
});

test("registryRateFor suggests a same-identifier codex rate for an unpriced OpenAI model", () => {
  const entry = staticEntries("codex").find((e) => e.ids[0] === "codex:gpt-5-6-terra")!;
  const suggestion = registryRateFor(opencodeModel("opencode:openai/gpt-5.6-terra"));
  assert.ok(suggestion);
  assert.equal(suggestion!.registry, "codex");
  assert.equal(suggestion!.registryId, "codex:gpt-5-6-terra");
  assert.equal(suggestion!.registryName, entry.name);
  assert.deepEqual(suggestion!.rates, entry.rates);
  assert.equal(suggestion!.registryDate, staticRegistryDate);
  assert.equal(suggestion!.sourceUrl, "https://openai.com/api/pricing");
  // A reasoning variant of the same model resolves to the same suggestion.
  const variant = registryRateFor(opencodeModel("opencode:openai/gpt-5.6-terra#high"));
  assert.deepEqual(variant, suggestion);
});

test("registryRateFor withholds a suggestion for every disqualifying case", () => {
  // No same-identifier registry entry.
  assert.equal(registryRateFor(opencodeModel("opencode:openai/gpt-5.4-fast")), undefined);
  // Registry entry exists but has no verified rate.
  assert.equal(
    registryRateFor(opencodeModel("opencode:openai/gpt-5.3-codex-spark")),
    undefined,
  );
  // Free tier is never suggested a BYOK rate.
  assert.equal(
    registryRateFor(opencodeModel("opencode:openai/gpt-5.6-terra", { freeTier: true })),
    undefined,
  );
  // Already CLI-priced models don't need a suggestion.
  assert.equal(
    registryRateFor(
      opencodeModel("opencode:openai/gpt-5.6-terra", {
        rates: { input: 1, read: 1, write: null, output: 1 },
      }),
    ),
    undefined,
  );
  // Provider not in the explicit table.
  assert.equal(registryRateFor(opencodeModel("opencode:anthropic/claude-x")), undefined);
  // Nested routes get no suggestion.
  assert.equal(
    registryRateFor(opencodeModel("opencode:openrouter/openai/gpt-5.6-terra")),
    undefined,
  );
  // Non-OpenCode sources are never suggested a rate.
  assert.equal(
    registryRateFor({ ...opencodeModel("opencode:openai/gpt-5.6-terra"), source: "codex" }),
    undefined,
  );
});

test("registryRateFor withholds an expired registry entry via an injected registry lookup", () => {
  const expired: CatalogEntry = {
    ids: ["codex:gpt-5-6-terra"],
    name: "GPT-5.6 Terra",
    provider: "OpenAI",
    benchmarkFamilies: ["GPT-5.6 Terra"],
    rates: { input: 2, read: 0.2, write: 2.5, output: 12 },
    expires: "2020-01-01",
  };
  const suggestion = registryRateFor(
    opencodeModel("opencode:openai/gpt-5.6-terra"),
    Date.now(),
    () => [expired],
  );
  assert.equal(suggestion, undefined);
});

test("byokStaleness distinguishes manual, current, changed, and missing registry rates", () => {
  const model = opencodeModel("opencode:openai/gpt-5.6-terra");
  const current = registryRateFor(model)!;
  assert.equal(
    byokStaleness({ rates: current.rates, source: { kind: "manual" } }, model),
    undefined,
  );
  assert.equal(
    byokStaleness(
      {
        rates: current.rates,
        source: {
          kind: "registry",
          registry: current.registry,
          registryId: current.registryId,
          registryDate: current.registryDate,
        },
      },
      model,
    ),
    undefined,
  );
  assert.equal(
    byokStaleness(
      {
        rates: { ...current.rates, input: current.rates.input + 1 },
        source: {
          kind: "registry",
          registry: current.registry,
          registryId: current.registryId,
          registryDate: current.registryDate,
        },
      },
      model,
    ),
    "rates-changed",
  );
  assert.equal(
    byokStaleness(
      {
        rates: current.rates,
        source: { kind: "registry", registry: "codex", registryId: "codex:gone", registryDate: "2026-01-01" },
      },
      model,
    ),
    "registry-missing",
  );
  // Also missing when the injected registry lookup no longer has the entry.
  assert.equal(
    byokStaleness(
      {
        rates: current.rates,
        source: {
          kind: "registry",
          registry: current.registry,
          registryId: current.registryId,
          registryDate: current.registryDate,
        },
      },
      model,
      Date.now(),
      () => [],
    ),
    "registry-missing",
  );
});

test("byokStaleness compares long-context rates too", () => {
  const model = opencodeModel("opencode:openai/gpt-5.6-terra");
  const withLong: CatalogEntry = {
    ids: ["codex:gpt-5-6-terra"],
    name: "GPT-5.6 Terra",
    provider: "OpenAI",
    benchmarkFamilies: ["GPT-5.6 Terra"],
    rates: { input: 2, read: 0.2, write: 2.5, output: 12 },
    long: { threshold: 200000, rates: { input: 4, read: 0.4, write: 5, output: 24 } },
  };
  const source = {
    kind: "registry" as const,
    registry: "codex",
    registryId: "codex:gpt-5-6-terra",
    registryDate: staticRegistryDate,
  };
  // Stored entry has no long tier; the registry now does -> changed.
  assert.equal(
    byokStaleness({ rates: withLong.rates!, source }, model, Date.now(), () => [withLong]),
    "rates-changed",
  );
  // Both have the same long tier -> not stale.
  assert.equal(
    byokStaleness(
      { rates: withLong.rates!, long: withLong.long, source },
      model,
      Date.now(),
      () => [withLong],
    ),
    undefined,
  );
  // Long tier present on both but the threshold moved -> changed.
  assert.equal(
    byokStaleness(
      {
        rates: withLong.rates!,
        long: { ...withLong.long!, threshold: 100 },
        source,
      },
      model,
      Date.now(),
      () => [withLong],
    ),
    "rates-changed",
  );
});
