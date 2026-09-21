import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baseModelIdOf,
  compare,
  efficiencyOf,
  estimate,
  freeSpotlight,
  freeBar,
  loadMappings,
  markFrontier,
  migrateOptions,
  modelThinkingOf,
  parseOptions,
  pinRowId,
  savedOptions,
  sortRowsByEfficiency,
  taskCost,
  taskMix,
  thinkingLabelOf,
  variantDisplayName,
} from "../src/compare";
import { exportBadge, exportCsv, exportSnapshot } from "../src/export";
import { freshnessAlert, pricingAge } from "../src/freshness";
import { driftOf, noiseThreshold, selectPrevSnapshot } from "../src/drift";
import { workspaceLabel } from "../src/workspaceLabel";
import { loadByokStore, mergeByokForm, parseByokFormStore, parseByokStore } from "../src/byok";
import { usageMultiplier } from "../src/usageMultipliers";
import {
  aggregateUsage,
  blankUsageIndex,
  discoverUsageFiles,
  normalizeUsageModelId,
  resolveWorkspace,
  parseUsageJsonl,
  parseUsageLegacyJson,
  premiumForRequest,
  selectChangedFiles,
  storageCandidates,
  suggestBudget,
  uriToPath,
  usageParserVersion,
  validUsageFile,
} from "../src/usage";
import { parseMessage } from "../src/messages";
import { recommend } from "../src/recommend";
import { defaults, type AvailableModel, type Benchmark, type PricingInfo, type PricingSource, type Row } from "../src/types";
import { compressBreakpoints, frontierIds, mixCost, sweepMix } from "../src/sensitivity";
import { summarizeWatchChanges, watchlistChanges } from "../src/watchlist";
import { parseScenario, planRegistryDate, projectScenario } from "../src/plans";
import { staticEntries, staticModels, isStaticSource, staticPricingSources, staticRegistryDate } from "../src/staticSources";
import { sources, defaultBilling, allowedBilling, isLiveSource } from "../src/sources";
import { workload, loadProfiles, changeProfile } from "../src/profiles";

const benchmarks: Benchmark[] = [
  {
    id: "b-high",
    slug: "b-high",
    name: "GPT-5.4 (high)",
    provider: "OpenAI",
    scores: { general: 80, coding: 85, agentic: 70 },
  },
  {
    id: "b-xhigh",
    slug: "b-xhigh",
    name: "GPT-5.4 (xhigh)",
    provider: "OpenAI",
    scores: { general: 82, coding: 88, agentic: 71 },
  },
  {
    id: "b-sonnet",
    slug: "b-sonnet",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    scores: { general: 84, coding: 86, agentic: 72 },
  },
];

const copilotModel: AvailableModel = {
  id: "gpt-5.4",
  name: "GPT-5.4",
  family: "gpt-5.4",
  maxInputTokens: 400000,
  source: "copilot",
};

test("pins expand one model into one row per benchmark variant", () => {
  const rows = compare(benchmarks.length ? [copilotModel] : [], benchmarks, defaults, {}, undefined, {
    pins: { "gpt-5.4": ["b-high", "b-xhigh"] },
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    [pinRowId("gpt-5.4", "b-high"), pinRowId("gpt-5.4", "b-xhigh")].sort(),
  );
  for (const r of rows) {
    assert.equal(r.modelId, "gpt-5.4");
    assert.equal(r.baseModelId, "gpt-5.4");
    assert.ok(r.pinnedBenchmarkId);
  }
  assert.notEqual(rows[0].benchmark?.id, rows[1].benchmark?.id);
});

test("a pin whose benchmark disappears becomes a stale row, never a silent substitution", () => {
  const rows = compare([copilotModel], benchmarks, defaults, {}, undefined, {
    pins: { "gpt-5.4": ["missing-id"] },
  });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.id, pinRowId("gpt-5.4", "missing-id"));
  assert.equal(row.modelId, "gpt-5.4");
  assert.equal(row.mappingStatus, "missing");
  assert.equal(row.pinnedBenchmarkId, "missing-id");
  assert.equal(row.mapping?.issue, "pin-stale");
  assert.equal(row.mapping?.staleBenchmarkId, "missing-id");
  // Unpinning explicitly restores the automatic rows; pricing (unlike the
  // mapping) never depended on the stale pin in the first place.
  const unpinned = compare([copilotModel], benchmarks, defaults, {}, undefined, {
    pins: {},
  });
  assert.equal(unpinned.length, 2);
  assert.ok(unpinned.every((r) => r.expandedBenchmarkId));
  assert.ok(row.cost !== null);
  assert.equal(row.cost, unpinned[0].cost);
  // Before any snapshot has loaded, pins are withheld rather than shown stale.
  const noSnapshot = compare([copilotModel], [], defaults, {}, undefined, {
    pins: { "gpt-5.4": ["missing-id"] },
  });
  assert.equal(noSnapshot.length, 1);
  assert.equal(noSnapshot[0].id, "gpt-5.4");
  assert.equal(noSnapshot[0].pinnedBenchmarkId, undefined);
  assert.equal(noSnapshot[0].mapping?.issue, "no-snapshot");
});

test("ambiguous benchmark variants expand automatically into thinking rows", () => {
  const rows = compare([copilotModel], benchmarks, defaults);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    [pinRowId("gpt-5.4", "b-high"), pinRowId("gpt-5.4", "b-xhigh")].sort(),
  );
  for (const r of rows) {
    assert.equal(r.modelId, "gpt-5.4");
    assert.equal(r.mappingStatus, "inferred");
    assert.deepEqual(r.candidateIds.sort(), ["b-high", "b-xhigh"]);
    assert.ok(r.expandedBenchmarkId);
    assert.equal(r.pinnedBenchmarkId, undefined);
    assert.ok(r.benchmark);
  }
  assert.notEqual(rows[0].name, rows[1].name);
  assert.notEqual(rows[0].benchmark?.id, rows[1].benchmark?.id);
  // A manual mapping still collapses the model to that single choice.
  const collapsed = compare([copilotModel], benchmarks, defaults, {
    "gpt-5.4": "b-high",
  });
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].id, "gpt-5.4");
  assert.equal(collapsed[0].mappingStatus, "user");
  assert.equal(collapsed[0].benchmark?.id, "b-high");
});

test("variant-level exclusions hide one thinking row; model exclusions hide all", () => {
  const variantId = pinRowId("gpt-5.4", "b-high");
  const oneHidden = compare([copilotModel], benchmarks, defaults, {}, undefined, {
    excluded: [variantId],
  });
  assert.deepEqual(
    oneHidden.map((r) => r.id),
    [pinRowId("gpt-5.4", "b-xhigh")],
  );
  const allHidden = compare([copilotModel], benchmarks, defaults, {}, undefined, {
    excluded: ["gpt-5.4"],
  });
  assert.equal(allHidden.length, 0);
});

test("models reporting a thinking level resolve to that same level", () => {
  const high: AvailableModel = {
    id: "opencode:openai/gpt-5.4#high",
    name: "GPT-5.4 (high)",
    family: "gpt",
    maxInputTokens: 400000,
    source: "opencode",
  };
  const options = {
    ...defaults,
    source: "opencode" as const,
    billing: "usd" as const,
  };
  const single = compare([high], benchmarks, options);
  assert.equal(single.length, 1);
  assert.equal(single[0].id, high.id);
  assert.equal(single[0].benchmark?.id, "b-high");
  assert.equal(single[0].mappingStatus, "inferred");
  // A reported level matching no benchmark still expands every variant.
  const low: AvailableModel = { ...high, id: "opencode:openai/gpt-5.4#low", name: "GPT-5.4 (low)" };
  const expanded = compare([low], benchmarks, options);
  assert.equal(expanded.length, 2);
  assert.ok(expanded.every((r) => r.expandedBenchmarkId));
});

test("thinking labels distinguish benchmark variants", () => {
  assert.equal(thinkingLabelOf("GPT-5.4"), "Standard");
  assert.equal(thinkingLabelOf("GPT-5.4 (high)"), "high");
  assert.equal(
    thinkingLabelOf("Claude Opus 5 (Adaptive Reasoning, Max Effort)"),
    "Adaptive Reasoning, Max Effort",
  );
  assert.equal(thinkingLabelOf("Claude 4.5 Haiku (fast mode)"), "Standard");
  assert.equal(
    modelThinkingOf({
      id: "opencode:openai/gpt-5.4#low",
      name: "GPT-5.4 (low)",
      family: "gpt",
      maxInputTokens: 1,
      source: "opencode",
    }),
    "low",
  );
  assert.equal(
    variantDisplayName("GPT-5.4", "GPT-5.4 (high)"),
    "GPT-5.4 · GPT-5.4 (high)",
  );
  assert.equal(
    variantDisplayName("GPT-5.4 (low)", "GPT-5.4 (low)"),
    "GPT-5.4 (low)",
  );
});

test("base model identity strips source, variant, and pin suffixes", () => {
  assert.equal(baseModelIdOf("gpt-5.4"), "gpt-5.4");
  assert.equal(baseModelIdOf("opencode:openai/gpt-5.4#high"), "openai/gpt-5.4");
  assert.equal(baseModelIdOf("claude-code:claude-sonnet-4-5"), "claude-sonnet-4-5");
  assert.equal(baseModelIdOf(`${pinRowId("gpt-5.4", "b-high")}`), "gpt-5.4");
});

test("checklist exclusions hide models before frontier calculation", () => {
  const second: AvailableModel = {
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    family: "gpt-5-mini",
    maxInputTokens: 400000,
    source: "copilot",
  };
  const all = compare([copilotModel, second], benchmarks, defaults);
  assert.ok(all.length >= 1);
  const filtered = compare([copilotModel, second], benchmarks, defaults, {}, undefined, {
    excluded: ["gpt-5.4"],
  });
  assert.ok(!filtered.some((r) => r.modelId === "gpt-5.4"));
});

test("display settings default, persist, and migrate", () => {
  const parsed = parseOptions({ ...defaults });
  assert.deepEqual(parsed.display, { labels: true, frontier: true, scale: "auto", chart: "task", quadrant: true, sort: "default" });
  assert.equal(parsed.freeOnly, false);
  const migrated = savedOptions({ source: "copilot", preset: "coding", billing: "credits", plan: "pro", filter: "", tokens: defaults.tokens, recommendation: defaults.recommendation });
  assert.deepEqual(migrated.display, { labels: true, frontier: true, scale: "auto", chart: "task", quadrant: true, sort: "default" });
  const legacy = migrateOptions({ source: "codex", billing: "credits" }) as Record<string, unknown>;
  assert.equal(legacy.billing, "usd");
});

test("billing modes are source-scoped", () => {
  assert.deepEqual(allowedBilling("copilot"), ["credits", "legacy"]);
  assert.deepEqual(allowedBilling("codex"), ["usd"]);
  assert.equal(defaultBilling("copilot"), "credits");
  assert.equal(defaultBilling("gemini-cli"), "usd");
  assert.throws(() =>
    parseOptions({ ...defaults, source: "copilot", billing: "usd" }),
  );
});

test("estimate returns a breakdown that multiplies out", () => {
  const entry = staticEntries("codex").find((e) => e.ids[0] === "codex:gpt-5-6-terra")!;
  const options = { ...defaults, source: "codex" as const, billing: "usd" as const };
  const price = estimate(entry, options);
  assert.ok(price.cost !== null && price.breakdown);
  const b = price.breakdown!;
  const write = b.rates.write ?? b.rates.input;
  const expected =
    (b.inputTokens * b.rates.input +
      b.readTokens * b.rates.read +
      b.writeTokens * write +
      b.outputTokens * b.rates.output) /
    b.divisor;
  assert.equal(price.cost, expected);
  assert.equal(b.unit, "USD");
});

test("USD promotional expiry stays unresolved", () => {
  const entry = {
    ids: ["x"],
    name: "X",
    provider: "Test",
    benchmarkFamilies: ["X"],
    rates: { input: 1, read: 1, write: null, output: 1 },
    expires: "2020-01-01",
  };
  const price = estimate(entry, { ...defaults, source: "codex" as const, billing: "usd" as const });
  assert.equal(price.cost, null);
  assert.match(price.reason ?? "", /expired/i);
});

test("static registries expose namespaced models with USD entries", () => {
  for (const source of ["claude-code", "codex", "gemini-cli", "cursor", "windsurf", "aider", "amazon-q"] as const) {
    const models = staticModels(source);
    assert.ok(models.length >= 1, source);
    for (const m of models) {
      assert.ok(m.id.startsWith(`${source}:`), m.id);
      assert.equal(m.source, source);
    }
    assert.ok(staticEntries(source).length >= 1, source);
  }
  const rows = compare(
    staticModels("claude-code"),
    benchmarks,
    { ...defaults, source: "claude-code", billing: "usd" },
  );
  assert.ok(rows.some((r) => r.score !== null));
  assert.ok(rows.every((r) => r.baseModelId.length > 0));
});

test("Row.invocable only carries a doc-verified client id, never a display name or registry key", () => {
  // OpenCode: always derivable from the discovered id, variant included.
  const opencodeRows = compare(
    [
      {
        id: "opencode:openai/gpt-5.4#high",
        name: "GPT-5.4 (high)",
        family: "gpt",
        maxInputTokens: 900000,
        source: "opencode",
      },
    ],
    benchmarks,
    { ...defaults, source: "opencode", billing: "usd" },
  );
  assert.deepEqual(opencodeRows[0].invocable, {
    ref: "openai/gpt-5.4#high",
    usage: 'opencode run -m <id> / "model" in opencode.json',
  });

  // Codex: staticSources.ts carries a verified invocableId with dots, distinct
  // from both the display name and the "gpt-5-6-terra" registry key.
  const codexRows = compare(staticModels("codex"), benchmarks, {
    ...defaults,
    source: "codex",
    billing: "usd",
  });
  const terra = codexRows.find((r) => r.modelId === "codex:gpt-5-6-terra")!;
  assert.equal(terra.invocable?.ref, "gpt-5.6-terra");
  // Even an unpriced preview model gets its documented dotted id — id
  // verification is independent of pricing.
  const spark = codexRows.find((r) => r.modelId === "codex:gpt-5-3-codex-spark")!;
  assert.equal(spark.invocable?.ref, "gpt-5.3-codex-spark");

  // Gemini CLI: the two unverified/rerouting-bug models stay uncopyable.
  const geminiRows = compare(staticModels("gemini-cli"), benchmarks, {
    ...defaults,
    source: "gemini-cli",
    billing: "usd",
  });
  assert.equal(
    geminiRows.find((r) => r.modelId === "gemini-cli:gemini-2-5-pro")?.invocable
      ?.ref,
    "gemini-2.5-pro",
  );
  for (const id of ["gemini-cli:gemini-3-5-flash", "gemini-cli:gemini-3-8-flash"]) {
    assert.equal(geminiRows.find((r) => r.modelId === id)?.invocable, undefined);
  }

  // Sources with no documented id surface at all never carry Row.invocable.
  for (const source of ["cursor", "windsurf", "aider", "amazon-q"] as const) {
    const rows = compare(staticModels(source), benchmarks, {
      ...defaults,
      source,
      billing: "usd",
    });
    assert.ok(rows.every((r) => r.invocable === undefined), source);
  }

  // Copilot: no external id surface at all.
  const copilotRows = compare(
    [{ id: "gpt-5-mini", name: "GPT-5 mini", family: "gpt", maxInputTokens: 400000 }],
    benchmarks,
    defaults,
  );
  assert.equal(copilotRows[0].invocable, undefined);
});

test("static source metadata marks registries as known models", () => {
  assert.equal(sources["claude-code"].live, false);
  assert.match(sources["claude-code"].availabilityNote, /not your account/i);
  assert.ok(sources["amazon-q"].pricingUrl.startsWith("https://"));
});

test("free-only filtering and spotlight use latest discovery", () => {
  const free: AvailableModel = {
    id: "opencode:opencode/free-model",
    name: "Free",
    family: "free",
    maxInputTokens: 200000,
    source: "opencode",
    freeTier: true,
    rates: { input: 0, read: 0, write: null, output: 0 },
  };
  const paid: AvailableModel = {
    id: "opencode:opencode-go/paid-model",
    name: "Paid",
    family: "paid",
    maxInputTokens: 200000,
    source: "opencode",
    rates: { input: 1, read: 1, write: null, output: 1 },
  };
  const models: Benchmark[] = [
    { id: "f", slug: "f", name: "Free", provider: "T", scores: { general: 70, coding: 70, agentic: 70 } },
    { id: "p", slug: "p", name: "Paid", provider: "T", scores: { general: 80, coding: 80, agentic: 80 } },
  ];
  const aliases = { "opencode:opencode/free-model": ["Free"], "opencode:opencode-go/paid-model": ["Paid"] };
  void aliases;
  const usd = { ...defaults, source: "opencode" as const, billing: "usd" as const };
  const spotlight = freeSpotlight([free, paid], models, usd);
  void spotlight;
  const freeOnly = compare([free, paid], models, { ...usd, freeOnly: true });
  assert.ok(freeOnly.every((r) => r.modelId === free.id || r.cost === null || r.score === null || r.modelId !== paid.id));
});

test("workload excludes display settings but keeps source and freeOnly", () => {
  const w = workload({ ...defaults, display: { labels: false, frontier: false, scale: "linear", chart: "workload", quadrant: false, sort: "efficiency" }, freeOnly: true });
  assert.ok(!("display" in w));
  assert.equal(w.source, "copilot");
  assert.equal(w.freeOnly, true);
});

test("host messages validate pins, exclusions, and exports", () => {
  assert.deepEqual(parseMessage({ type: "pin", id: "a", benchmarkId: "b" }), {
    type: "pin",
    id: "a",
    benchmarkId: "b",
  });
  assert.deepEqual(parseMessage({ type: "unpin", id: "a", benchmarkId: "b" }), {
    type: "unpin",
    id: "a",
    benchmarkId: "b",
  });
  assert.deepEqual(parseMessage({ type: "exclude", id: "a", excluded: true }), {
    type: "exclude",
    id: "a",
    excluded: true,
  });
  assert.deepEqual(parseMessage({ type: "excludeAll", excluded: false }), {
    type: "excludeAll",
    excluded: false,
  });
  assert.deepEqual(parseMessage({ type: "exportCsv" }), { type: "exportCsv" });
  assert.throws(() => parseMessage({ type: "pin", id: "a", benchmarkId: "" }));
  assert.throws(() => parseMessage({ type: "exportPng", png: "nope" }));
  assert.deepEqual(parseMessage({ type: "source", source: "gemini-cli" }), {
    type: "source",
    source: "gemini-cli",
  });
  assert.throws(() => parseMessage({ type: "source", source: "other" }));
});

test("host messages validate byokApply and byokReset id lists", () => {
  assert.deepEqual(
    parseMessage({ type: "byokApply", ids: ["opencode:openai/gpt-5.6-terra"] }),
    { type: "byokApply", ids: ["opencode:openai/gpt-5.6-terra"] },
  );
  assert.deepEqual(
    parseMessage({ type: "byokReset", ids: ["a", "b"] }),
    { type: "byokReset", ids: ["a", "b"] },
  );
  assert.throws(() => parseMessage({ type: "byokApply", ids: [] }));
  assert.throws(() => parseMessage({ type: "byokReset", ids: [] }));
  assert.throws(() => parseMessage({ type: "byokApply", ids: "a" }));
  assert.throws(() => parseMessage({ type: "byokApply", ids: [1] }));
  assert.throws(() =>
    parseMessage({ type: "byokApply", ids: Array.from({ length: 201 }, (_, i) => `m${i}`) }),
  );
});

test("CSV export matches rows and escapes hostile values", () => {
  const csv = exportCsv(
    [
      {
        id: "m1",
        modelId: "m1",
        baseModelId: "m1",
        name: "=cmd|calc",
        provider: "Test",
        score: 80,
        cost: 1.5,
        frontier: true,
        reasons: ["a reason"],
        mappingStatus: "exact",
        candidateIds: [],
        dominatedBy: [],
        tier: "Default context",
      },
    ],
    defaults,
    new Set(["m1"]),
  );
  assert.match(csv, /model,model_id,provider/);
  assert.match(csv, /"=cmd\|calc"/);
  assert.match(csv, /,yes,exact,/);
  // A row with no `pricing` (e.g. a hand-built fixture) exports blank
  // pricing columns rather than throwing; provenance tail carries the task
  // basis with configured and effective mixes, then blank dates/issue.
  assert.match(csv, /a reason,,,task,1000,0,0,1000,1000,0,0,1000,,,,,\n$/);
});

test("coverage: source helpers, static guards, and pricing sources", () => {
  assert.equal(isLiveSource("copilot"), true);
  assert.equal(isLiveSource("opencode"), true);
  assert.equal(isLiveSource("codex"), false);
  assert.equal(isLiveSource("amazon-q"), false);
  assert.equal(isStaticSource("codex"), true);
  assert.equal(isStaticSource("copilot"), false);
  assert.equal(isStaticSource("opencode"), false);
  assert.ok(staticPricingSources.codex.startsWith("https://"));
  for (const s of Object.keys(sources) as (keyof typeof sources)[]) {
    assert.ok(sources[s].label.length > 0);
    assert.ok(sources[s].pricingUrl.startsWith("https://"));
    assert.ok(allowedBilling(s).length >= 1);
  }
});

test("coverage: CSV escaping, nulls, and legacy units", () => {
  const mk = (name: string) => ({
    id: "m",
    modelId: "m",
    baseModelId: "m",
    name,
    provider: "P",
    score: null as number | null,
    cost: null as number | null,
    frontier: false,
    reasons: [] as string[],
    mappingStatus: "exact" as const,
    candidateIds: [] as string[],
    dominatedBy: [] as string[],
  });
  const csv = exportCsv(
    [
      { ...mk('a,"b"\nc'), score: 1, cost: 2 },
      { ...mk("@evil"), score: 1, cost: 2 },
      { ...mk("+1"), score: 1, cost: 2 },
      { ...mk("-1"), score: 1, cost: 2 },
      { ...mk("plain"), score: 1, cost: 2 },
    ],
    { ...defaults, billing: "legacy" },
  );
  assert.match(csv, /"a,""b""\nc"/);
  assert.match(csv, /"@evil"/);
  assert.match(csv, /premium requests/);
});

test("coverage: messages validate export PNG and profiles", () => {
  const png = `data:image/png;base64,${"A".repeat(100)}`;
  assert.deepEqual(parseMessage({ type: "exportPng", png }), {
    type: "exportPng",
    png,
  });
  assert.throws(() =>
    parseMessage({ type: "exportPng", png: "data:image/jpeg;base64,AAA" }),
  );
  assert.deepEqual(parseMessage({ type: "select", id: "a" }), {
    type: "select",
    id: "a",
  });
  assert.deepEqual(
    parseMessage({ type: "profile", change: { action: "custom" } }),
    { type: "profile", change: { action: "custom" } },
  );
  assert.deepEqual(
    parseMessage({
      type: "profile",
      change: { action: "saveAs", name: "Work" },
    }),
    { type: "profile", change: { action: "saveAs", name: "Work" } },
  );
  assert.throws(() => parseMessage({ type: "nope" }));
  assert.throws(() => parseMessage(null));
});

test("coverage: options migration edge cases", () => {
  assert.equal(migrateOptions(null), null);
  assert.deepEqual(savedOptions("garbage"), defaults);
  assert.deepEqual(savedOptions(undefined), defaults);
  const badBilling = migrateOptions({
    source: "copilot",
    billing: "usd",
  }) as Record<string, unknown>;
  assert.equal(badBilling.billing, "credits");
  const kept = parseOptions({
    ...defaults,
    display: { labels: false, frontier: false, scale: "linear", chart: "workload", quadrant: false, sort: "efficiency" },
    freeOnly: true,
  });
  assert.equal(kept.display.labels, false);
  assert.equal(kept.display.scale, "linear");
  assert.equal(kept.display.chart, "workload");
  assert.equal(kept.display.quadrant, false);
  const fallback = parseOptions({ ...defaults, display: { labels: 1, frontier: 0, scale: "x" } });
  assert.equal(fallback.display.labels, false);
  assert.equal(fallback.display.scale, "auto");
  assert.equal(fallback.display.chart, "task");
  assert.equal(fallback.display.quadrant, true);
  // Options saved before scenarios existed migrate to the default (off).
  const { scenario: _drop, ...withoutScenario } = defaults;
  assert.deepEqual(parseOptions(withoutScenario).scenario, defaults.scenario);
  // A corrupted scenario never resets the rest of the saved options.
  const corrupted = parseOptions({ ...defaults, scenario: "not an object", preset: "coding" });
  assert.deepEqual(corrupted.scenario, defaults.scenario);
  assert.equal(corrupted.preset, "coding");
  const kept2 = parseOptions({
    ...defaults,
    scenario: { planId: "copilot-pro", requestsLow: 10, requestsHigh: 20 },
  });
  assert.equal(kept2.scenario.planId, "copilot-pro");
  assert.equal(kept2.scenario.requestsLow, 10);
});

test("coverage: estimate legacy, free tier, long context, and missing entry", () => {
  const legacyEntry = {
    ids: ["l"],
    name: "L",
    provider: "P",
    benchmarkFamilies: ["L"],
    legacy: { pro: 2, proPlus: 3 },
  };
  assert.equal(
    estimate(legacyEntry, { ...defaults, billing: "legacy", plan: "pro" }).cost,
    2,
  );
  assert.equal(
    estimate(legacyEntry, { ...defaults, billing: "legacy", plan: "proPlus" }).cost,
    3,
  );
  assert.equal(
    estimate(undefined, defaults).cost,
    null,
  );
  const freeEntry = {
    ids: ["f"],
    name: "F",
    provider: "P",
    benchmarkFamilies: ["F"],
    freeTier: true as const,
  };
  const freePrice = estimate(freeEntry, {
    ...defaults,
    source: "codex" as const,
    billing: "usd" as const,
  });
  assert.equal(freePrice.cost, 0);
  assert.equal(freePrice.breakdown?.unit, "USD");
  const longEntry = {
    ids: ["g"],
    name: "G",
    provider: "P",
    benchmarkFamilies: ["G"],
    rates: { input: 1, read: 1, write: null, output: 1 },
    long: {
      threshold: 10,
      rates: { input: 2, read: 2, write: null, output: 2 },
    },
  };
  assert.equal(
    estimate(longEntry, {
      ...defaults,
      tokens: { input: 11, read: 0, write: 0, output: 1 },
    }).tier,
    "Long context",
  );
  assert.ok(staticRegistryDate.length >= 8);
});

test("coverage: cross-unit, context limits, and benchmark resolution", () => {
  const staticModel = staticModels("codex")[0];
  const badBilling = compare(
    [staticModel],
    benchmarks,
    { ...defaults, source: "codex", billing: "credits" as never },
  );
  void badBilling;
  const cross = compare(
    [copilotModel],
    benchmarks,
    { ...defaults, source: "copilot", billing: "credits" },
  );
  assert.ok(cross.length >= 1);
  const usdCopilot = compare(
    [copilotModel],
    benchmarks,
    // Bypass parseOptions to exercise the cross-unit guard directly.
    { ...defaults, source: "copilot", billing: "usd" as never },
  );
  assert.ok(usdCopilot.every((r) => r.cost === null));
  const tiny: AvailableModel = {
    ...copilotModel,
    id: "tiny",
    name: "Tiny",
    maxInputTokens: 10,
  };
  const tooLong = compare(
    [{ ...tiny, source: "copilot" }],
    [{ id: "t", slug: "t", name: "Tiny", provider: "P", scores: { general: 1, coding: 1, agentic: 1 } }],
    {
      ...defaults,
      display: { ...defaults.display, chart: "workload" },
      tokens: { input: 11, read: 0, write: 0, output: 0 },
    },
  );
  assert.ok(tooLong.every((r) => r.cost === null));
  assert.match(tooLong[0]?.reasons.join(" ") ?? "", /context limit/);
});

test("coverage: free spotlight empty, free-only, and paid-to-best", () => {
  const usd = { ...defaults, source: "opencode" as const, billing: "usd" as const };
  assert.deepEqual(freeSpotlight([], [], usd), {});
  assert.deepEqual(freeSpotlight([], [], { ...defaults, source: "copilot" }), {});
  const paidOnly: AvailableModel = {
    id: "opencode:opencode-go/paid",
    name: "Paid",
    family: "paid",
    maxInputTokens: 500000,
    source: "opencode",
    rates: { input: 1, read: 1, write: null, output: 1 },
  };
  const paidBench: Benchmark[] = [
    { id: "p1", slug: "p1", name: "Paid", provider: "P", scores: { general: 90, coding: 90, agentic: 90 } },
  ];
  const only = freeSpotlight([paidOnly], paidBench, usd);
  assert.ok(only.bestOverall && !only.bestFree);
  const free: AvailableModel = {
    id: "opencode:opencode/free",
    name: "Free",
    family: "free",
    maxInputTokens: 500000,
    source: "opencode",
    freeTier: true,
    rates: { input: 0, read: 0, write: null, output: 0 },
  };
  const both: Benchmark[] = [
    { id: "f1", slug: "f1", name: "Free", provider: "P", scores: { general: 70, coding: 70, agentic: 70 } },
    { id: "p1", slug: "p1", name: "Paid", provider: "P", scores: { general: 95, coding: 95, agentic: 95 } },
  ];
  const withBoth = freeSpotlight([free, paidOnly], both, usd);
  assert.ok(withBoth.bestFree && withBoth.bestOverall);
  assert.ok((withBoth.gapPoints ?? 0) > 0);
});

test("free bar ranks scored free-tier models by score descending", () => {
  const usd = { ...defaults, source: "opencode" as const, billing: "usd" as const };
  assert.deepEqual(freeBar([], [], usd), []);
  assert.deepEqual(freeBar([], [], { ...defaults, source: "copilot" }), []);
  const paid: AvailableModel = {
    id: "opencode:opencode-go/paid",
    name: "Paid",
    family: "paid",
    maxInputTokens: 500000,
    source: "opencode",
    rates: { input: 1, read: 1, write: null, output: 1 },
  };
  const freeA: AvailableModel = {
    id: "opencode:opencode/free-a",
    name: "Free A",
    family: "free",
    maxInputTokens: 500000,
    source: "opencode",
    freeTier: true,
  };
  const freeB: AvailableModel = {
    id: "opencode:opencode/free-b",
    name: "Free B",
    family: "free",
    maxInputTokens: 500000,
    source: "opencode",
    freeTier: true,
  };
  const unscored: AvailableModel = {
    id: "opencode:opencode/free-c",
    name: "Free C",
    family: "free",
    maxInputTokens: 500000,
    source: "opencode",
    freeTier: true,
  };
  const models: Benchmark[] = [
    { id: "fa", slug: "fa", name: "Free A", provider: "P", scores: { general: 70, coding: 70, agentic: 70 } },
    { id: "fb", slug: "fb", name: "Free B", provider: "P", scores: { general: 85, coding: 85, agentic: 85 } },
    { id: "p", slug: "p", name: "Paid", provider: "P", scores: { general: 95, coding: 95, agentic: 95 } },
  ];
  const bar = freeBar([freeA, freeB, unscored, paid], models, usd);
  // Paid and unscored rows never appear; ranking is score-only, descending.
  assert.deepEqual(bar.map((e) => e.name), ["Free B", "Free A"]);
  assert.deepEqual(bar[0], { id: bar[0].id, name: "Free B", score: 85 });
  // Non-OpenCode sources have no free tier.
  assert.deepEqual(freeBar([freeA, freeB], models, { ...defaults, source: "copilot" }), []);
  // The bar ignores the free-only and only-mine restrictions so it stays put
  // while searching, but checklist exclusions still apply.
  assert.deepEqual(
    freeBar([freeA, freeB, paid], models, { ...usd, freeOnly: true }).map((e) => e.name),
    ["Free B", "Free A"],
  );
  assert.deepEqual(
    freeBar([freeA, freeB, paid], models, { ...usd, onlyMine: true }, {}, undefined, { usedCounts: new Map() }).map((e) => e.name),
    ["Free B", "Free A"],
  );
  assert.deepEqual(
    freeBar([freeA, freeB, paid], models, usd, {}, undefined, { excluded: [freeB.id] }).map((e) => e.name),
    ["Free A"],
  );
  // Score ties break by name for a deterministic order.
  const tied: Benchmark[] = [
    { id: "fa", slug: "fa", name: "Free A", provider: "P", scores: { general: 80, coding: 80, agentic: 80 } },
    { id: "fb", slug: "fb", name: "Free B", provider: "P", scores: { general: 80, coding: 80, agentic: 80 } },
  ];
  assert.deepEqual(
    freeBar([freeB, freeA], tied, usd).map((e) => e.name),
    ["Free A", "Free B"],
  );
  // The bar is billing-independent: scores resolve even where USD costs do not.
  assert.deepEqual(
    freeBar([freeA, freeB, paid], models, { ...usd, billing: "credits" }).map((e) => e.name),
    ["Free B", "Free A"],
  );
});

test("workload sweep prices mixes from breakdowns and matches the frontier", () => {
  const srow = (id: string, cost: number | null, score: number | null): Row => ({
    id,
    modelId: id,
    baseModelId: id,
    name: id,
    provider: "P",
    score,
    cost,
    frontier: false,
    reasons: [],
    dominatedBy: [],
    mappingStatus: "exact",
    candidateIds: [],
  });
  // frontierIds follows the same dominance rule as markFrontier.
  const synthetic = [srow("a", 1, 10), srow("b", 2, 20), srow("c", 1, 20), srow("d", null, 30)];
  assert.deepEqual(
    [...frontierIds(synthetic)].sort(),
    markFrontier(synthetic).filter((r) => r.frontier).map((r) => r.id).sort(),
  );
  assert.deepEqual(frontierIds(synthetic), ["c"]);
  // mixCost honors disjoint buckets with write falling back to input.
  const priced = srow("p", 0.002, 90);
  const withRates: Row = {
    ...priced,
    breakdown: {
      inputTokens: 1000,
      readTokens: 0,
      writeTokens: 0,
      outputTokens: 1000,
      rates: { input: 1, read: 2, write: null, output: 10 },
      divisor: 1000000,
      unit: "USD",
    },
  };
  assert.equal(mixCost(withRates, { input: 1000, read: 0, write: 0, output: 1000 }, "usd"), 0.011);
  assert.equal(mixCost(withRates, { input: 0, read: 0, write: 100, output: 0 }, "usd"), 0.0001);
  assert.equal(mixCost({ ...priced, score: null }, { input: 1, read: 0, write: 0, output: 0 }, "usd"), null);
  assert.equal(
    mixCost({ ...withRates, breakdown: { ...withRates.breakdown!, divisor: 0 } }, { input: 1, read: 0, write: 0, output: 0 }, "usd"),
    null,
  );
  // Legacy rows without a breakdown stay constant; anything else unpriced is null.
  assert.equal(mixCost(priced, { input: 5, read: 5, write: 5, output: 5000 }, "legacy"), 0.002);
  assert.equal(mixCost(priced, { input: 5, read: 0, write: 0, output: 5 }, "usd"), null);
});

test("sweep breakpoints track frontier and recommendation changes", () => {
  const model = (
    id: string,
    name: string,
    extra: Partial<AvailableModel> = {},
  ): AvailableModel => ({
    id,
    name,
    family: id,
    maxInputTokens: 500000,
    source: "opencode",
    ...extra,
  });
  const bench = (id: string, name: string, score: number): Benchmark => ({
    id,
    slug: id,
    name,
    provider: "P",
    scores: { general: score, coding: score, agentic: score },
  });
  const available = [
    model("opencode:zen/a", "A", { freeTier: true }),
    model("opencode:paid/b", "B", { rates: { input: 1, read: 1, write: null, output: 10 } }),
    model("opencode:paid/c", "C", { rates: { input: 10, read: 10, write: null, output: 1 } }),
  ];
  const benchmarks = [bench("a", "A", 70), bench("b", "B", 95), bench("c", "C", 90)];
  const options = {
    ...defaults,
    source: "opencode" as const,
    billing: "usd" as const,
    display: { ...defaults.display, chart: "workload" as const },
    tokens: { input: 1000, read: 0, write: 0, output: 1000 },
    recommendation: {
      ...defaults.recommendation,
      budgets: { ...defaults.recommendation.budgets, usd: 0.005 },
    },
  };
  const rows = compare(available, benchmarks, options);
  assert.equal(rows.length, 3);
  // The mid-sweep step reuses the workload tokens, so it must agree with compare().
  const steps = sweepMix(rows, options, 2000);
  assert.equal(steps.length, 11);
  const mid = steps.find((s) => s.share === 50)!;
  assert.deepEqual(
    [...mid.frontierIds].sort(),
    rows.filter((r) => r.frontier).map((r) => r.id).sort(),
  );
  // Input-heavy mixes favour the cheap-input model; output-heavy mixes flip both frontier and recommendation.
  const ranges = compressBreakpoints(steps);
  assert.ok(ranges.length > 1);
  assert.deepEqual(ranges[0].recommendedIds, [rows.find((r) => r.modelId === "opencode:paid/b")!.id]);
  const last = ranges[ranges.length - 1];
  assert.deepEqual(last.recommendedIds, [rows.find((r) => r.modelId === "opencode:paid/c")!.id]);
  // A flat sweep compresses to a single range; degenerate inputs yield none.
  assert.equal(compressBreakpoints([]).length, 0);
  assert.equal(sweepMix(rows, options, 2000, 1).length, 0);
  const legacyRows = [
    { ...rows[0], cost: 2, breakdown: undefined },
    { ...rows[1], cost: 3, breakdown: undefined },
  ];
  const legacySteps = sweepMix(legacyRows, { ...options, billing: "legacy" }, 2000);
  assert.equal(legacySteps.length, 11);
  assert.ok(legacySteps.every((s) => s.frontierIds.length === 2));
  assert.equal(compressBreakpoints(legacySteps).length, 1);
});

test("watchlist reports pinned-model changes and stays silent otherwise", () => {
  const wrow = (
    id: string,
    modelId: string,
    name: string,
    cost: number | null,
    score: number | null,
    mappingStatus: Row["mappingStatus"] = "exact",
  ): Row => ({
    id,
    modelId,
    baseModelId: modelId,
    name,
    provider: "P",
    score,
    cost,
    frontier: false,
    reasons: [],
    dominatedBy: [],
    mappingStatus,
    candidateIds: [],
  });
  const prev = [
    wrow("gpt-5-mini::aa", "gpt-5-mini", "GPT-5 mini · A", 1, 48),
    wrow("gpt-5-mini::bb", "gpt-5-mini", "GPT-5 mini · B", 1, 50),
    wrow("steady::cc", "steady", "Steady", 2, 60),
    wrow("unmapped::dd", "unmapped", "Unmapped", null, null, "missing"),
  ];
  const curr = [
    wrow("gpt-5-mini::aa", "gpt-5-mini", "GPT-5 mini · A", 1.5, 48.3),
    wrow("gpt-5-mini::bb", "gpt-5-mini", "GPT-5 mini · B", 1, 52),
    wrow("steady::cc", "steady", "Steady", 2, 60),
    wrow("unmapped::dd", "unmapped", "Unmapped", null, null, "missing"),
  ];
  const base = {
    prevRows: prev,
    currRows: curr,
    availableIds: ["gpt-5-mini", "steady", "unmapped"],
    excludedIds: [] as string[],
    source: "copilot" as const,
    unit: "AI credits",
  };
  // Price change alerts; sub-threshold score drift and nulls stay silent.
  const changes = watchlistChanges({
    ...base,
    pins: { "gpt-5-mini": ["aa", "bb"], steady: ["cc"], unmapped: ["dd"] },
  });
  assert.deepEqual(
    changes.map((c) => [c.kind, c.name]),
    [
      ["price", "GPT-5 mini · A"],
      ["score", "GPT-5 mini · B"],
    ],
  );
  assert.match(changes[0].before, /1 AI credits/);
  assert.match(changes[0].after, /1\.5 AI credits/);
  // Mapping changes alert with labels; a pin with no rows on either side
  // reads as not discovered when it belongs to the current source.
  const mapped = watchlistChanges({
    ...base,
    prevRows: prev,
    currRows: curr.map((r) =>
      r.id === "steady::cc" ? { ...r, mappingStatus: "missing" as const } : r,
    ),
    pins: { steady: ["cc"], gone: ["ee"] },
  });
  assert.deepEqual(
    mapped.map((c) => [c.kind, c.before, c.after]),
    [
      ["availability", "Discovered", "Not discovered"],
      ["mapping", "Exact match", "Missing benchmark"],
    ],
  );
  // Availability is stateless and source-scoped: same-source pins missing
  // from discovery alert, cross-source pins, excluded pins, and empty pins
  // stay silent — as does everything when no rows are comparable at all.
  const away = watchlistChanges({
    ...base,
    prevRows: [],
    currRows: [wrow("other::x", "other", "Other", 1, 10)],
    availableIds: ["other"],
    source: "opencode" as const,
    pins: {
      "opencode:zen/gone": ["z"],
      "gpt-5-mini": ["aa"],
      other: [],
      "opencode:zen/hidden": ["z"],
    },
    excludedIds: ["opencode:zen/hidden"],
  });
  assert.deepEqual(
    away.map((c) => [c.kind, c.name]),
    [["availability", "opencode:zen/gone"]],
  );
  assert.deepEqual(
    watchlistChanges({ ...base, pins: {} }),
    [],
  );
  assert.deepEqual(
    watchlistChanges({ ...base, currRows: [], pins: { steady: ["cc"] } }),
    [],
  );
  // The summary cites both snapshot versions and retrieval dates.
  const summary = summarizeWatchChanges(
    changes,
    { version: "4.2", fetchedAt: 1000, models: [] },
    { version: "4.3", fetchedAt: 2000, models: [] },
  );
  assert.match(summary, /v4\.2 → v4\.3/);
  assert.match(summary, /GPT-5 mini · A: price/);
  assert.match(summary, /GPT-5 mini · B: score/);
});

test("coverage: recommendations and profiles branches", () => {  const empty = recommend([], defaults);
  assert.deepEqual(empty.modelIds, []);
  const over = recommend(
    [
      {
        id: "e",
        modelId: "e",
        baseModelId: "e",
        name: "e",
        provider: "P",
        score: 90,
        cost: 5,
        frontier: true,
        reasons: [],
        mappingStatus: "exact",
        candidateIds: [],
        dominatedBy: [],
      },
    ],
    defaults,
  );
  assert.deepEqual(over.modelIds, []);
  assert.match(over.explanation, /budget/);
  const near = recommend(
    [
      {
        id: "n",
        modelId: "n",
        baseModelId: "n",
        name: "n",
        provider: "P",
        score: 90,
        cost: 5,
        frontier: true,
        reasons: [],
        mappingStatus: "exact",
        candidateIds: [],
        dominatedBy: [],
      },
    ],
    { ...defaults, recommendation: { mode: "nearBest", budgets: defaults.recommendation.budgets, scoreGap: 3 } },
  );
  assert.deepEqual(near.modelIds, ["n"]);
  const invalid = loadProfiles({
    version: 1,
    items: [
      { id: "", name: "bad", workload: { ...defaults, filter: undefined } },
      { id: "dup", name: "A", workload: { ...defaults } },
      { id: "dup", name: "A", workload: { ...defaults } },
      { id: "ok", name: "  OK  ", workload: { ...defaults } },
    ],
    activeId: "ok",
  });
  assert.ok(invalid.items.some((p) => p.id === "ok"));
  assert.throws(() => changeProfile(invalid, defaults, { action: "apply", id: "missing" }));
});

test("task chart view uses fixed per-task mix, workload view uses tokens", () => {
  const entry = staticEntries("codex").find((e) => e.ids[0] === "codex:gpt-5-6-terra")!;
  const base = { ...defaults, source: "codex" as const, billing: "usd" as const };
  const small = { ...base, tokens: { input: 10, read: 0, write: 0, output: 10 } };
  const large = { ...base, tokens: { input: 50000, read: 0, write: 0, output: 50000 } };
  const price = taskCost(entry, base);
  assert.ok(price.cost !== null && price.breakdown);
  assert.deepEqual(
    { inputTokens: price.breakdown!.inputTokens, outputTokens: price.breakdown!.outputTokens },
    { inputTokens: taskMix.input, outputTokens: taskMix.output },
  );
  // Independent of the user's workload token inputs.
  assert.equal(taskCost(entry, small).cost, taskCost(entry, large).cost);
  // Matches a workload estimate run with the fixed mix.
  assert.equal(
    taskCost(entry, base).cost,
    estimate(entry, { ...base, tokens: { ...taskMix } }).cost,
  );
  const models: Benchmark[] = [
    { id: "t", slug: "t", name: "GPT-5.6 Terra", provider: "OpenAI", scores: { general: 70, coding: 70, agentic: 70 } },
  ];
  const available: AvailableModel[] = [
    { id: "codex:gpt-5-6-terra", name: "GPT-5.6 Terra", family: "gpt", maxInputTokens: 400000, source: "codex" },
  ];
  const taskRows = compare(available, models, {
    ...large,
    display: { ...base.display, chart: "task" },
  });
  const workloadRows = compare(available, models, {
    ...large,
    display: { ...base.display, chart: "workload" },
  });
  assert.equal(taskRows[0].cost, taskCost(entry, base).cost);
  assert.equal(workloadRows[0].cost, estimate(entry, large).cost);
  assert.notEqual(taskRows[0].cost, workloadRows[0].cost);
});

test("table sort defaults to discovery order and accepts efficiency", () => {
  assert.equal(parseOptions({ ...defaults }).display.sort, "default");
  assert.equal(
    parseOptions({ ...defaults, display: { ...defaults.display, sort: "efficiency" } }).display.sort,
    "efficiency",
  );
  assert.equal(
    parseOptions({ ...defaults, display: { ...defaults.display, sort: "x" } }).display.sort,
    "default",
  );
  const migrated = savedOptions({ ...defaults, display: undefined });
  assert.equal(migrated.display.sort, "default");
});

test("efficiency sort ranks cost per quality with nulls last", () => {
  const mk = (id: string, score: number | null, cost: number | null) => ({
    id,
    modelId: id,
    baseModelId: id,
    name: id,
    provider: "P",
    score,
    cost,
    frontier: true,
    reasons: [] as string[],
    mappingStatus: "exact" as const,
    candidateIds: [] as string[],
    dominatedBy: [] as string[],
  });
  assert.equal(efficiencyOf(mk("a", 80, 4)), 0.05);
  assert.equal(efficiencyOf(mk("b", null, 4)), null);
  assert.equal(efficiencyOf(mk("c", 80, null)), null);
  assert.equal(efficiencyOf(mk("d", 0, 4)), null);
  const sorted = sortRowsByEfficiency([
    mk("paid", 80, 8),
    mk("unpriced", 90, null),
    mk("cheap", 40, 2),
  ]);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["cheap", "paid", "unpriced"],
  );
});

test("freshness alert stays silent for current dates and nudges when stale", () => {
  assert.equal(freshnessAlert("2026-09-10", "2026-09-11", Date.parse("2026-09-20")), null);
  const stale = freshnessAlert("2026-01-01", "2026-01-02", Date.parse("2026-09-20"));
  assert.match(stale ?? "", /stale/);
  assert.match(stale ?? "", /docs\/catalog\.md/);
  assert.match(freshnessAlert("not-a-date", "2026-09-11") ?? "", /unavailable/);
  // A stale plan registry date also triggers the nudge and appears in the message.
  assert.equal(
    freshnessAlert("2026-09-10", "2026-09-11", Date.parse("2026-09-20"), "2026-09-12"),
    null,
  );
  const stalePlans = freshnessAlert(
    "2026-09-10",
    "2026-09-11",
    Date.parse("2026-09-20"),
    "2026-01-01",
  );
  assert.match(stalePlans ?? "", /plans 2026-01-01/);
});

test("per-row pricing age flags stale sources with the shared 90-day threshold", () => {
  const now = Date.parse("2026-09-20T00:00:00Z");
  const priced = (source: PricingSource): PricingInfo => ({ status: "priced", source });
  // Day-precision boundary: exactly 90 days old is fresh, 91 days is stale.
  assert.equal(
    pricingAge(priced("copilot-catalog"), "2026-06-22", "2026-09-11", now).stale,
    false,
  );
  const stale = pricingAge(priced("copilot-catalog"), "2026-06-21", "2026-09-11", now);
  assert.equal(stale.stale, true);
  assert.equal(stale.date, "2026-06-21");
  assert.equal(stale.daysOld, 91);
  // Legacy multipliers ride with the catalog; static rows with their registry.
  assert.equal(
    pricingAge(priced("legacy-multiplier"), "2026-06-21", "2026-09-11", now).stale,
    true,
  );
  const registry = pricingAge(priced("static-registry"), "2026-09-10", "2026-06-21", now);
  assert.equal(registry.date, "2026-06-21");
  assert.equal(registry.stale, true);
  // A fresh row under a stale catalog stays clean.
  assert.equal(
    pricingAge(priced("static-registry"), "2026-01-01", "2026-09-11", now).stale,
    false,
  );
  // Registry-provenance BYOK uses its own date.
  const registryByok: PricingInfo = {
    status: "byok",
    source: "byok",
    byok: {
      provenance: { kind: "registry", registry: "codex", registryId: "x", registryDate: "2026-01-01" },
    },
  };
  assert.equal(
    pricingAge(registryByok, "2026-09-10", "2026-09-11", now).stale,
    true,
  );
  // Never flagged: live CLI rates, free tier, manual BYOK, unresolved, cross-unit.
  const undated: PricingInfo[] = [
    { status: "priced", source: "opencode-cli" },
    { status: "free", source: "opencode-cli" },
    { status: "byok", source: "byok", byok: { provenance: { kind: "manual" } } },
    { status: "unresolved", source: "none" },
    { status: "not-comparable", source: "none" },
  ];
  for (const p of undated)
    assert.deepEqual(pricingAge(p, "2026-01-01", "2026-01-01", now), {
      date: null,
      stale: false,
      daysOld: null,
    });
  // An unparseable date is reported without a flag, never as fresh.
  assert.deepEqual(pricingAge(priced("copilot-catalog"), "not-a-date", "2026-09-11", now), {
    date: "not-a-date",
    stale: false,
    daysOld: null,
  });
});

test("snapshot and badge exports reflect displayed rows", () => {
  const rows = compare([copilotModel], benchmarks, defaults);
  assert.ok(rows.length >= 1);
  const recommended = new Set([rows[0].id]);
  const snapshot = JSON.parse(
    exportSnapshot(rows, defaults, recommended, {
      source: "copilot",
      preset: "general",
      billing: "credits",
      catalogDate: "2026-09-10",
      staticRegistryDate: "2026-09-11",
      version: "4.3",
      fetchedAt: 1,
    }),
  );
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.kind, "single");
  assert.equal(snapshot.rows.length, rows.length);
  assert.match(snapshot.disclaimer, /Illustrative/);
  assert.equal(snapshot.catalogDate, "2026-09-10");
  assert.equal(snapshot.staticRegistryDate, "2026-09-11");
  assert.equal(snapshot.rows[0].pricingStatus, rows[0].pricing?.status ?? null);
  assert.equal(snapshot.rows[0].pricingSource, rows[0].pricing?.source ?? null);
  assert.equal(snapshot.rows[0].pricingProvenance, null);
  assert.equal(snapshot.planRegistryDate, null);
  assert.equal(snapshot.scenario, null);
  const scenario = projectScenario({
    scenario: parseScenario({ planId: "copilot-pro", requestsLow: 1, requestsHigh: 1 }),
    options: defaults,
    row: rows[0],
    rowOrigin: "selected",
    catalogDate: "2026-09-10",
  });
  const withScenario = JSON.parse(
    exportSnapshot(rows, defaults, recommended, {
      source: "copilot",
      preset: "general",
      billing: "credits",
      catalogDate: "2026-09-10",
      staticRegistryDate: "2026-09-11",
      planRegistryDate,
      scenario,
    }),
  );
  assert.equal(withScenario.planRegistryDate, planRegistryDate);
  assert.equal(withScenario.scenario.status, scenario.status);
  assert.match(withScenario.scenario.label, /not a bill/);
  const csv = exportCsv(rows, defaults, recommended);
  assert.match(csv, /pricing_status,pricing_source/);
  assert.match(csv, /cost_basis,workload_input,workload_read,workload_write,workload_output/);
  assert.match(csv, /catalog_date,static_registry_date,benchmark_version,benchmark_fetched_at,pricing_issue/);
  assert.ok(csv.includes(`,${rows[0].pricing?.status},${rows[0].pricing?.source},task,`));
  const badge = JSON.parse(exportBadge(rows, defaults, { source: "copilot", preset: "general" }));
  assert.equal(badge.schemaVersion, 1);
  assert.match(badge.label, /pareto copilot general/);
  assert.equal(badge.unit, "AI credits");
  assert.equal(badge.basis, "task");
  assert.ok(badge.message.length > 0);
  const empty = JSON.parse(exportBadge([], defaults, { source: "copilot", preset: "general" }));
  assert.match(empty.message, /no comparable models/);
  assert.deepEqual(parseMessage({ type: "exportSnapshot" }), { type: "exportSnapshot" });
  assert.deepEqual(parseMessage({ type: "exportBadge" }), { type: "exportBadge" });
});

test("drift computes per-preset deltas with unknown, not zero, for gaps", () => {
  const prev = {
    version: "4.2",
    fetchedAt: 1000,
    models: [
      { id: "a", slug: "a", name: "A", provider: "P", scores: { general: 70, coding: 60, agentic: 50 } },
      { id: "b", slug: "b", name: "B", provider: "P", scores: { general: null, coding: 60, agentic: 50 } },
      { id: "gone", slug: "gone", name: "Gone", provider: "P", scores: { general: 10, coding: 10, agentic: 10 } },
    ],
  };
  const curr = [
    { id: "a", slug: "a", name: "A", provider: "P", scores: { general: 74, coding: 60, agentic: 50 } },
    { id: "b", slug: "b", name: "B", provider: "P", scores: { general: 80, coding: 61, agentic: 50 } },
    { id: "new", slug: "new", name: "New", provider: "P", scores: { general: 90, coding: 90, agentic: 90 } },
  ];
  const drift = driftOf(prev, curr, "general");
  assert.equal(drift.a.delta, 4);
  assert.equal(drift.a.prevScore, 70);
  assert.equal(drift.b.delta, null);
  assert.equal(drift.b.prevScore, null);
  assert.equal(drift.new.delta, null);
  assert.equal(drift.new.prevScore, null);
  assert.ok(!("gone" in drift));
  const coding = driftOf(prev, curr, "coding");
  assert.equal(coding.a.delta, 0);
  assert.equal(coding.b.delta, 1);
  assert.deepEqual(driftOf(undefined, curr, "general"), {});
});

test("drift flags sub-threshold deltas as measurement noise", () => {
  assert.equal(noiseThreshold, 1);
  const prev = {
    version: "4.2",
    fetchedAt: 1000,
    models: [
      { id: "tiny", slug: "tiny", name: "Tiny", provider: "P", scores: { general: 50, coding: 50, agentic: 50 } },
    ],
  };
  const curr = (score: number | null) => [
    { id: "tiny", slug: "tiny", name: "Tiny", provider: "P", scores: { general: score, coding: score, agentic: score } },
  ];
  // Boundary: just under 1 point is noise, exactly 1 is a real change.
  assert.equal(driftOf(prev, curr(50.99), "general").tiny.noisy, true);
  assert.equal(driftOf(prev, curr(51), "general").tiny.noisy, false);
  assert.equal(driftOf(prev, curr(51.01), "general").tiny.noisy, false);
  // Sign is irrelevant; an exact zero is noise (no claimed change).
  assert.equal(driftOf(prev, curr(49.5), "general").tiny.noisy, true);
  assert.equal(driftOf(prev, curr(50), "general").tiny.noisy, true);
  // Unknown deltas are never labelled noise.
  assert.equal(driftOf(prev, curr(null), "general").tiny.noisy, false);
  assert.equal(driftOf(prev, curr(null), "general").tiny.delta, null);
});

test("previous snapshots validate, stay older, and never equal current", () => {
  const curr = { version: "4.3", fetchedAt: 2000, models: [] };
  const older = { version: "4.2", fetchedAt: 1000, models: [] };
  assert.deepEqual(selectPrevSnapshot(older, curr), older);
  assert.equal(selectPrevSnapshot({ ...older, fetchedAt: 2000 }, curr), undefined);
  assert.equal(selectPrevSnapshot({ ...older, fetchedAt: 3000 }, curr), undefined);
  assert.equal(selectPrevSnapshot({ version: "x", fetchedAt: 1000, models: [] }, curr), undefined);
  assert.equal(selectPrevSnapshot(null, curr), undefined);
});

test("BYOK store validates ids, rates, and thresholds", () => {
  const good = parseByokStore({
    "opencode:openai/gpt-5.4": { rates: { input: 1, read: 0.5, write: null, output: 4 } },
    "opencode:openai/gpt-5.4#low": {
      rates: { input: 1, read: 1, write: 2, output: 3 },
      long: { threshold: 100, rates: { input: 2, read: 2, write: null, output: 5 } },
    },
  });
  assert.equal(good["opencode:openai/gpt-5.4"].rates.write, null);
  assert.equal(good["opencode:openai/gpt-5.4#low"].long?.threshold, 100);
  assert.deepEqual(loadByokStore("garbage"), {});
  assert.throws(() => parseByokStore(null));
  assert.throws(() => parseByokStore({ "not-an-id": { rates: { input: 1, read: 1, write: null, output: 1 } } }));
  assert.throws(() =>
    parseByokStore({ "opencode:openai/x": { rates: { input: -1, read: 1, write: null, output: 1 } } })
  );
  assert.throws(() =>
    parseByokStore({ "opencode:openai/x": { rates: { input: 1, read: 1, write: null, output: NaN } } })
  );
  assert.throws(() =>
    parseByokStore({
      "opencode:openai/x": {
        rates: { input: 1, read: 1, write: null, output: 1 },
        long: { threshold: 0, rates: { input: 1, read: 1, write: null, output: 1 } },
      },
    }),
  );
  assert.throws(() => parseMessage({ type: "byok", rates: { "bad id": {} } }));
  assert.deepEqual(parseMessage({ type: "byok", rates: {} }), { type: "byok", rates: {} });
});

test("BYOK provenance: a missing source migrates to manual; an invalid one is rejected strictly", () => {
  const manual = parseByokStore({
    "opencode:openai/gpt-5.4": { rates: { input: 1, read: 1, write: null, output: 1 } },
  });
  assert.deepEqual(manual["opencode:openai/gpt-5.4"].source, { kind: "manual" });
  const registry = parseByokStore({
    "opencode:openai/gpt-5.4": {
      rates: { input: 1, read: 1, write: null, output: 1 },
      source: { kind: "registry", registry: "codex", registryId: "codex:gpt-5-6-terra", registryDate: "2026-09-11" },
    },
  });
  assert.deepEqual(registry["opencode:openai/gpt-5.4"].source, {
    kind: "registry",
    registry: "codex",
    registryId: "codex:gpt-5-6-terra",
    registryDate: "2026-09-11",
  });
  assert.throws(() =>
    parseByokStore({
      "opencode:openai/gpt-5.4": {
        rates: { input: 1, read: 1, write: null, output: 1 },
        source: { kind: "registry", registry: "not-a-real-registry", registryId: "x", registryDate: "2026-09-11" },
      },
    }),
  );
  assert.throws(() =>
    parseByokStore({
      "opencode:openai/gpt-5.4": {
        rates: { input: 1, read: 1, write: null, output: 1 },
        source: { kind: "registry", registry: "codex", registryId: "codex:x", registryDate: "09/11/2026" },
      },
    }),
  );
  assert.throws(() =>
    parseByokStore({
      "opencode:openai/gpt-5.4": {
        rates: { input: 1, read: 1, write: null, output: 1 },
        source: { kind: "bogus" },
      },
    }),
  );
});

test("parseByokFormStore always ignores any source the webview sends", () => {
  const parsed = parseByokFormStore({
    "opencode:openai/gpt-5.4": {
      rates: { input: 1, read: 1, write: null, output: 1 },
      source: { kind: "registry", registry: "codex", registryId: "codex:gpt-5-6-terra", registryDate: "2026-09-11" },
    },
  });
  assert.deepEqual(parsed["opencode:openai/gpt-5.4"].source, { kind: "manual" });
  assert.throws(() => parseByokFormStore(null));
  assert.throws(() => parseByokFormStore({ "not-an-id": { rates: { input: 1, read: 1, write: null, output: 1 } } }));
});

test("loadByokStore tolerates a malformed source and drops only entries with invalid rates", () => {
  const loaded = loadByokStore({
    "opencode:openai/gpt-5.4": {
      rates: { input: 1, read: 1, write: null, output: 1 },
      source: { kind: "bogus-not-real" },
    },
    "opencode:openai/gpt-5.5": {
      rates: { input: -1, read: 1, write: null, output: 1 },
    },
    "opencode:openai/gpt-5.6-luna": {
      rates: { input: 2, read: 0.2, write: null, output: 1.2 },
      source: { kind: "registry", registry: "codex", registryId: "codex:gpt-5-6-luna", registryDate: "2026-09-11" },
    },
  });
  assert.deepEqual(loaded["opencode:openai/gpt-5.4"].source, { kind: "manual" });
  assert.ok(loaded["opencode:openai/gpt-5.4"].rates);
  assert.equal("opencode:openai/gpt-5.5" in loaded, false);
  assert.deepEqual(loaded["opencode:openai/gpt-5.6-luna"].source, {
    kind: "registry",
    registry: "codex",
    registryId: "codex:gpt-5-6-luna",
    registryDate: "2026-09-11",
  });
});

test("mergeByokForm keeps registry provenance on a no-op save and downgrades on an edit", () => {
  const prev = {
    "opencode:openai/gpt-5.4": {
      rates: { input: 2, read: 0.2, write: 2.5, output: 12 },
      source: {
        kind: "registry" as const,
        registry: "codex",
        registryId: "codex:gpt-5-6-terra",
        registryDate: "2026-09-11",
      },
    },
  };
  const unchanged = mergeByokForm(prev, {
    "opencode:openai/gpt-5.4": {
      rates: { input: 2, read: 0.2, write: 2.5, output: 12 },
      source: { kind: "manual" },
    },
  });
  assert.deepEqual(unchanged["opencode:openai/gpt-5.4"].source, prev["opencode:openai/gpt-5.4"].source);
  const edited = mergeByokForm(prev, {
    "opencode:openai/gpt-5.4": {
      rates: { input: 3, read: 0.2, write: 2.5, output: 12 },
      source: { kind: "manual" },
    },
  });
  assert.deepEqual(edited["opencode:openai/gpt-5.4"].source, { kind: "manual" });
  // A brand-new id (not in prev) is always manual.
  const added = mergeByokForm(prev, {
    "opencode:openai/gpt-5.5": { rates: { input: 1, read: 1, write: null, output: 1 }, source: { kind: "manual" } },
  });
  assert.deepEqual(added["opencode:openai/gpt-5.5"].source, { kind: "manual" });
  // Long-context tiers are compared too: adding, dropping, or changing one
  // counts as an edit even when the base rates are unchanged.
  const withLong = {
    "opencode:openai/gpt-5.4": {
      ...prev["opencode:openai/gpt-5.4"],
      long: { threshold: 200000, rates: { input: 4, read: 0.4, write: 5, output: 24 } },
    },
  };
  const addedLong = mergeByokForm(withLong, {
    "opencode:openai/gpt-5.4": {
      rates: withLong["opencode:openai/gpt-5.4"].rates,
      source: { kind: "manual" },
    },
  });
  assert.deepEqual(addedLong["opencode:openai/gpt-5.4"].source, { kind: "manual" });
  const sameLong = mergeByokForm(withLong, {
    "opencode:openai/gpt-5.4": {
      rates: withLong["opencode:openai/gpt-5.4"].rates,
      long: withLong["opencode:openai/gpt-5.4"].long,
      source: { kind: "manual" },
    },
  });
  assert.deepEqual(sameLong["opencode:openai/gpt-5.4"].source, withLong["opencode:openai/gpt-5.4"].source);
});

test("BYOK rates price provider-billed models without touching free tier or CLI rates", () => {
  const unpriced: AvailableModel = {
    id: "opencode:openai/gpt-5.4",
    name: "GPT-5.4",
    family: "gpt",
    maxInputTokens: 400000,
    source: "opencode",
  };
  const usd = { ...defaults, source: "opencode" as const, billing: "usd" as const };
  const plain = compare([unpriced], benchmarks, usd);
  assert.ok(plain.length > 0 && plain.every((r) => r.cost === null));
  const byok = { "opencode:openai/gpt-5.4": { rates: { input: 2, read: 1, write: null, output: 8 } } };
  const priced = compare([unpriced], benchmarks, usd, {}, undefined, { byok });
  assert.ok(priced.length > 0 && priced.every((r) => r.cost !== null));
  assert.ok(priced.every((r) => (r.tier ?? "").includes("BYOK")));
  assert.ok(priced.every((r) => r.reasons.some((x) => /BYOK/.test(x))));
  const free: AvailableModel = {
    ...unpriced,
    id: "opencode:opencode/free",
    name: "Free",
    freeTier: true,
    rates: { input: 0, read: 0, write: null, output: 0 },
  };
  const freeRows = compare([free], benchmarks, usd, {}, undefined, {
    byok: { "opencode:opencode/free": { rates: { input: 9, read: 9, write: null, output: 9 } } },
  });
  assert.ok(freeRows.every((r) => r.cost === 0 && r.tier === "Free tier"));
  const cliPriced: AvailableModel = {
    ...unpriced,
    rates: { input: 1, read: 1, write: null, output: 1 },
  };
  const cliRows = compare([cliPriced], benchmarks, usd, {}, undefined, { byok });
  assert.ok(cliRows.every((r) => !(r.tier ?? "").includes("BYOK")));
  const cross = compare([unpriced], benchmarks, { ...usd, billing: "credits" as never }, {}, undefined, { byok });
  assert.ok(cross.every((r) => r.cost === null && r.reasons.some((x) => /USD billing/.test(x))));
});

test("usage multipliers select era by timestamp with labeled fallbacks", () => {
  const pre = Date.parse("2026-05-01");
  const post = Date.parse("2026-09-01");
  assert.deepEqual(usageMultiplier("copilot/gpt-5-mini", pre), { value: 0, estimated: false });
  assert.deepEqual(usageMultiplier("copilot/gpt-5-mini", post), { value: 0.33, estimated: false });
  assert.deepEqual(usageMultiplier("copilot/gpt-5.4", pre), { value: 1, estimated: false });
  assert.deepEqual(usageMultiplier("copilot/gpt-5.4", post), { value: 6, estimated: false });
  assert.deepEqual(usageMultiplier("copilot/gpt-5.4"), { value: 6, estimated: false });
  assert.deepEqual(usageMultiplier("copilot/unknown-model", post), { value: 1, estimated: true });
  assert.deepEqual(usageMultiplier(null, post), { value: 1, estimated: true });
  assert.equal(usageMultiplier("copilot/gpt-5.4", post, true).value, 5.4);
  assert.equal(usageMultiplier("copilot/auto", post, true).value, 0);
});

test("usage JSONL parser honors token, model, and timestamp precedence", () => {
  const lines = [
    JSON.stringify({
      kind: 0,
      v: {
        sessionId: "s1",
        creationDate: 1000,
        inputState: { selectedModel: { identifier: "copilot/gpt-5-mini" } },
      },
    }),
    JSON.stringify({ kind: 2, k: ["requests"], v: [null, { modelId: "copilot/appended", requestId: "r1", timestamp: 1100 }] }),
    JSON.stringify({
      kind: 1,
      k: ["requests", 1, "result"],
      v: {
        metadata: { promptTokens: 10, outputTokens: 5, toolCallRounds: [{}, {}] },
        usage: { promptTokens: 99, completionTokens: 99 },
        timings: { requestSent: 1200 },
      },
    }),
    JSON.stringify({
      kind: 1,
      k: ["requests", 2, "result"],
      v: { metadata: { resolvedModel: "claude-opus-4-7" }, usage: {} },
    }),
    "not json",
  ].join("\n");
  const parsed = parseUsageJsonl(lines, "ws1", "stem");
  assert.equal(parsed.anchor.sessionId, "s1");
  assert.equal(parsed.requests.length, 2);
  const first = parsed.requests[0];
  assert.equal(first.promptTokens, 10);
  assert.equal(first.outputTokens, 5);
  assert.equal(first.modelId, "copilot/appended");
  assert.equal(first.timestampMs, 1200);
  assert.equal(first.toolCallRounds, 2);
  assert.equal(first.tokensEstimated, false);
  const second = parsed.requests[1];
  assert.equal(second.modelId, "copilot/claude-opus-4.7");
  assert.equal(second.timestampMs, 1000);
  assert.equal(second.promptTokens, 0);
  const fallback = parseUsageJsonl("", "ws1", "stem");
  assert.equal(fallback.anchor.sessionId, "stem");
  assert.deepEqual(fallback.requests, []);
});

test("usage legacy parser estimates missing tokens from text", () => {
  const text = JSON.stringify({
    sessionId: "old",
    creationDate: 500,
    selectedModel: { id: "copilot/gpt-4o" },
    requests: [
      {
        message: { text: "hello world, this is a prompt" },
        variableData: { variables: [{ value: "context" }] },
        response: { result: { value: "response text here, fairly long", metadata: {}, usage: {} } },
      },
      {
        message: { text: "x" },
        response: { result: { metadata: { promptTokens: 7, outputTokens: 3 }, usage: {} } },
      },
    ],
  });
  const parsed = parseUsageLegacyJson(text, "ws1", "stem");
  assert.equal(parsed.requests.length, 2);
  assert.equal(parsed.requests[0].tokensEstimated, true);
  assert.ok(parsed.requests[0].promptTokens > 0 && parsed.requests[0].outputTokens > 0);
  assert.equal(parsed.requests[1].tokensEstimated, false);
  assert.equal(parsed.requests[1].promptTokens, 7);
  assert.deepEqual(parseUsageLegacyJson("broken", "ws1", "stem").requests, []);
});

test("usage file index selects changed files and reports deletions", () => {
  const cand = (filePath: string, size: number, mtime: number) => ({
    workspaceId: "w",
    workspacePath: "/repo",
    filePath,
    size,
    mtime,
    legacy: false,
  });
  const index = blankUsageIndex();
  assert.equal(index.version, 1);
  assert.equal(usageParserVersion, 3);
  index.files["/a.jsonl"] = { size: 10, mtime: 100, parser: usageParserVersion };
  index.files["/gone.jsonl"] = { size: 1, mtime: 1, parser: usageParserVersion };
  const { changed, deleted } = selectChangedFiles(
    [cand("/a.jsonl", 10, 100), cand("/b.jsonl", 5, 50)],
    index,
  );
  assert.deepEqual(changed.map((c) => c.filePath), ["/b.jsonl"]);
  assert.deepEqual(deleted, ["/gone.jsonl"]);
  index.files["/a.jsonl"] = { size: 11, mtime: 100, parser: usageParserVersion };
  assert.equal(selectChangedFiles([cand("/a.jsonl", 12, 100)], index).changed.length, 1);
  index.files["/a.jsonl"] = { size: 10, mtime: 100, parser: 0 };
  assert.equal(selectChangedFiles([cand("/a.jsonl", 10, 100)], index).changed.length, 1);
});

test("usage storage roots and URIs resolve per platform", () => {
  assert.ok(storageCandidates("linux", {}).some((p) => p.endsWith("Code/User/workspaceStorage")));
  assert.ok(storageCandidates("darwin", {}).some((p) => p.includes("Application Support")));
  assert.ok(storageCandidates("win32", { APPDATA: "C:/A" }).some((p) => p.startsWith("C:/A")));
  assert.equal(uriToPath("file:///c%3A/repo", "/root"), "c:/repo");
  assert.equal(uriToPath("plain/path", "/root"), "plain/path");
  assert.ok(uriToPath("vscode-userdata:///Code/settings.json", "/a/b/Code/User/workspaceStorage").endsWith("Code/settings.json"));
});

test("usage aggregation totals requests with per-event premium eras", () => {
  const summary = aggregateUsage([
    {
      workspaceId: "w1",
      workspacePath: "/repo",
      requests: [
        {
          sessionId: "s", workspaceId: "w1", requestIndex: 0, modelId: "copilot/gpt-5-mini",
          timestampMs: Date.parse("2026-05-01"), promptTokens: 100, outputTokens: 50,
          toolCallRounds: 0, tokensEstimated: false, promptProvenance: "observed" as const, outputProvenance: "observed" as const,
        },
        {
          sessionId: "s", workspaceId: "w1", requestIndex: 1, modelId: "copilot/gpt-5-mini",
          timestampMs: Date.parse("2026-09-01"), promptTokens: 100, outputTokens: 50,
          toolCallRounds: 0, tokensEstimated: true,
        },
        {
          sessionId: "s", workspaceId: "w1", requestIndex: 2, modelId: "copilot/mystery",
          timestampMs: null, promptTokens: 10, outputTokens: 5,
          toolCallRounds: 0, tokensEstimated: false, promptProvenance: "observed" as const, outputProvenance: "observed" as const,
        },
      ],
    },
  ]);
  assert.equal(summary.requestCount, 3);
  assert.equal(summary.fileCount, 1);
  assert.equal(summary.promptTokens, 210);
  assert.equal(summary.estimatedTokens, 1);
  assert.equal(summary.premiumEstimate, 0.33 + 1);
  assert.deepEqual(summary.unknownModels, ["copilot/mystery"]);
  assert.ok(summary.dateRange && summary.dateRange.from < summary.dateRange.to);
  assert.equal(summary.models[0].modelId, "copilot/gpt-5-mini");
  assert.equal(summary.days.length, 2);
  assert.equal(summary.workspaces[0].id, "w1");
  assert.deepEqual(premiumForRequest({
    sessionId: "s", workspaceId: "w", requestIndex: 0, modelId: "x",
    timestampMs: null, promptTokens: 0, outputTokens: 0, toolCallRounds: 0, tokensEstimated: false, promptProvenance: "observed" as const, outputProvenance: "observed" as const,
  }), { value: 0, estimated: false });
  assert.ok(validUsageFile({ version: 2, scannedAt: 1, index: blankUsageIndex(), files: {} }));
  assert.equal(validUsageFile({ version: 2 }), false);
  assert.equal(validUsageFile(null), false);
});

test("usage budget suggestions handle empty and unpriced windows", () => {
  const req = (modelId: string | null) => ({
    sessionId: "s", workspaceId: "w", requestIndex: 0, modelId,
    timestampMs: null as number | null, promptTokens: 100, outputTokens: 50,
    toolCallRounds: 0, tokensEstimated: false, promptProvenance: "observed" as const, outputProvenance: "observed" as const,
  });
  const free = aggregateUsage([
    { workspaceId: "w", workspacePath: "/r", requests: [req("copilot/auto"), req("copilot/auto")] },
  ]);
  assert.equal(free.medianSample, 2);
  assert.equal(free.premiumP90, 0);
  assert.equal(free.dateRange, null);
  const legacyNote = suggestBudget(free, "legacy");
  assert.equal(legacyNote?.value, 0);
  assert.match(legacyNote?.note ?? "", /p90 of 2 requests/);
  const mystery = aggregateUsage([
    { workspaceId: "w", workspacePath: "/r", requests: [req("copilot/mystery")] },
  ]);
  const creditNote = suggestBudget(mystery, "credits");
  assert.equal(creditNote?.value, null);
  assert.match(creditNote?.note ?? "", /No priced credit/);
  const tied = aggregateUsage([
    { workspaceId: "b", workspacePath: "/b", requests: [req("copilot/gpt-5.4")] },
    { workspaceId: "a", workspacePath: "/a", requests: [req("copilot/gpt-5-mini")] },
  ]);
  assert.deepEqual(
    tied.workspaces.map((w) => w.id),
    ["a", "b"],
  );
  assert.deepEqual(
    tied.models.map((m) => m.modelId),
    ["copilot/gpt-5-mini", "copilot/gpt-5.4"],
  );
});

test("usage messages validate scan and clear actions", () => {
  assert.deepEqual(parseMessage({ type: "scanUsage" }), { type: "scanUsage" });
  assert.deepEqual(parseMessage({ type: "clearUsage" }), { type: "clearUsage" });
  assert.deepEqual(parseMessage({ type: "pauseUsage" }), { type: "pauseUsage" });
  assert.deepEqual(parseMessage({ type: "resumeUsage" }), { type: "resumeUsage" });
  assert.deepEqual(parseMessage({ type: "showUsageData" }), {
    type: "showUsageData",
  });
  assert.deepEqual(parseMessage({ type: "setUsageRetention", days: 30 }), {
    type: "setUsageRetention",
    days: 30,
  });
  assert.deepEqual(parseMessage({ type: "setUsageRetention", days: 0 }), {
    type: "setUsageRetention",
    days: 0,
  });
  assert.throws(
    () => parseMessage({ type: "setUsageRetention", days: -1 }),
    /Invalid usage retention/,
  );
  assert.throws(
    () => parseMessage({ type: "setUsageRetention" }),
    /Invalid usage retention/,
  );
});

test("usage medians and p90s summarize priced requests", () => {
  const req = (promptTokens: number, outputTokens: number, modelId: string | null = "copilot/gpt-5-mini") => ({
    sessionId: "s", workspaceId: "w", requestIndex: 0, modelId,
    timestampMs: Date.parse("2026-09-01"), promptTokens, outputTokens,
    toolCallRounds: 0, tokensEstimated: false, promptProvenance: "observed" as const, outputProvenance: "observed" as const,
  });
  const summary = aggregateUsage([
    { workspaceId: "w", workspacePath: "/r", requests: [req(0, 0), req(100, 50), req(200, 100), req(300, 150)] },
  ]);
  assert.equal(summary.medianPrompt, 150);
  assert.equal(summary.medianOutput, 75);
  assert.equal(summary.medianSample, 4);
  assert.ok((summary.premiumP90 ?? 0) > 0);
  assert.ok((summary.creditP90 ?? 0) > 0);
  assert.equal(summary.creditSample, 4);
  const empty = aggregateUsage([]);
  assert.equal(empty.medianSample, 0);
  assert.equal(empty.premiumP90, null);
  assert.equal(suggestBudget(null, "credits"), null);
  assert.equal(suggestBudget(empty, "credits"), null);
  const legacy = suggestBudget(summary, "legacy");
  assert.equal(legacy?.value, summary.premiumP90);
  assert.match(legacy?.note ?? "", /p90 of 4 requests/);
  const credits = suggestBudget(summary, "credits");
  assert.equal(credits?.value, summary.creditP90);
  const usd = suggestBudget(summary, "usd");
  assert.equal(usd?.value, null);
  assert.match(usd?.note ?? "", /Copilot/);
  assert.equal(normalizeUsageModelId("copilot/gpt-5-mini"), "gpt-5-mini");
  assert.equal(normalizeUsageModelId("bare-id"), "bare-id");
  assert.equal(normalizeUsageModelId(null), null);
});

test("only-my-models filters before the frontier with preserved exclusions", () => {
  const second: AvailableModel = {
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    family: "gpt-5-mini",
    maxInputTokens: 400000,
    source: "copilot",
  };
  const used = new Map([["gpt-5-mini", 4]]);
  const mine = compare([copilotModel, second], benchmarks, { ...defaults, onlyMine: true }, {}, undefined, {
    usedCounts: used,
  });
  assert.ok(mine.length > 0 && mine.every((r) => r.modelId === "gpt-5-mini"));
  assert.ok(mine.every((r) => r.requests === 4));
  const all = compare([copilotModel, second], benchmarks, defaults, {}, undefined, { usedCounts: used });
  assert.ok(all.some((r) => r.modelId !== "gpt-5-mini"));
  assert.ok(all.find((r) => r.modelId === "gpt-5.4")?.requests === 0);
  const excluded = compare([copilotModel, second], benchmarks, { ...defaults, onlyMine: true }, {}, undefined, {
    usedCounts: used,
    excluded: ["gpt-5-mini"],
  });
  assert.equal(excluded.length, 0);
  assert.equal(parseOptions({ ...defaults }).onlyMine, false);
  assert.equal(savedOptions({ ...defaults, onlyMine: undefined }).onlyMine, false);
  assert.equal(parseOptions({ ...defaults, onlyMine: true }).onlyMine, true);
});

test("usage discovery resolves workspaces across storage roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "pareto-ws-"));
  const repo = join(root, "myrepo");
  mkdirSync(join(root, "ws1", "chatSessions"), { recursive: true });
  mkdirSync(join(root, "ws2", "chatSessions"), { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(
    join(root, "ws1", "workspace.json"),
    JSON.stringify({ folder: `file://${repo}` }),
  );
  const line = JSON.stringify({
    kind: 1,
    k: ["requests", 0, "result"],
    v: { metadata: { promptTokens: 3, outputTokens: 1 }, usage: {} },
  });
  writeFileSync(join(root, "ws1", "chatSessions", "a.jsonl"), `${line}\n`);
  writeFileSync(
    join(root, "ws1", "chatSessions", "b.json"),
    JSON.stringify({ sessionId: "old", requests: [] }),
  );
  writeFileSync(join(root, "ws1", "chatSessions", "notes.txt"), "ignore me");
  writeFileSync(join(root, "ws2", "chatSessions", "c.jsonl"), "\n");
  const found = await discoverUsageFiles([root, join(root, "missing")]);
  assert.equal(found.length, 3);
  const byFile = new Map(found.map((c) => [c.filePath.split("/").pop(), c]));
  assert.equal(byFile.get("a.jsonl")?.workspacePath, repo);
  assert.equal(byFile.get("a.jsonl")?.legacy, false);
  assert.equal(byFile.get("b.json")?.legacy, true);
  assert.equal(byFile.get("c.jsonl")?.workspacePath, "");
  assert.ok((byFile.get("a.jsonl")?.size ?? 0) > 0);
  const single = await resolveWorkspace(join(root, "ws1"), root);
  assert.deepEqual(single, { id: "ws1", path: repo });
  const multiRoot = join(root, "ws3");
  mkdirSync(join(multiRoot, "chatSessions"), { recursive: true });
  writeFileSync(
    join(multiRoot, "workspace.json"),
    JSON.stringify({ workspace: `file://${join(root, "w.code-workspace")}` }),
  );
  writeFileSync(
    join(root, "w.code-workspace"),
    JSON.stringify({ folders: [{ uri: `file://${repo}` }, { path: "rel" }] }),
  );
  const multi = await resolveWorkspace(multiRoot, root);
  assert.equal(multi.path, `${repo}; ${root}/rel`);
  const missing = await resolveWorkspace(join(root, "nope"), root);
  assert.deepEqual(missing, { id: "nope", path: "" });
});

test("usage resolution tolerates malformed workspace metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "pareto-ws-edge-"));
  const dir = join(root, "edge");
  mkdirSync(join(dir, "chatSessions"), { recursive: true });
  mkdirSync(join(root, "bare", "chatSessions"), { recursive: true });
  mkdirSync(join(root, "plain"), { recursive: true });
  writeFileSync(join(dir, "workspace.json"), JSON.stringify({ folder: 42, workspace: `file://${join(root, "ghost.code-workspace")}` }));
  writeFileSync(join(root, "wsArray.json"), "{}");
  const ghost = await resolveWorkspace(dir, root);
  assert.ok(ghost.path.endsWith("ghost.code-workspace"));
  const empty = await resolveWorkspace(join(root, "bare"), root);
  assert.deepEqual(empty, { id: "bare", path: "" });
  writeFileSync(join(dir, "workspace.json"), JSON.stringify({ workspace: `file://${join(root, "flat.code-workspace")}` }));
  writeFileSync(join(root, "flat.code-workspace"), JSON.stringify({ folders: [null, {}, { uri: "" }, { path: "r" }] }));
  const flat = await resolveWorkspace(dir, root);
  assert.ok(flat.path.endsWith("r"));
  writeFileSync(join(root, "flat.code-workspace"), JSON.stringify({ folders: "nope" }));
  const fallback = await resolveWorkspace(dir, root);
  assert.ok(fallback.path.endsWith("flat.code-workspace"));
  mkdirSync(join(root, "plain", "chatSessions", "d.jsonl"), { recursive: true });
  mkdirSync(join(root, "nochats"));
  const found = await discoverUsageFiles([root, root]);
  const names = found.map((c) => c.filePath.split("/").pop());
  assert.ok(!names.includes("d.jsonl"));
  assert.ok(storageCandidates("win32", {}).some((p) => p.includes("AppData")));
  assert.ok(uriToPath("vscode-userdata:///Code/x", "").startsWith("/"));
  assert.ok(!validUsageFile({ version: 1, scannedAt: NaN, index: blankUsageIndex(), files: {} }));
  assert.ok(!validUsageFile({
    version: 1,
    scannedAt: 1,
    index: { version: 1, files: { f: { size: "x", mtime: 1, parser: usageParserVersion } } },
    files: {},
  }));
});

test("usage legacy array responses estimate from joined text", () => {
  const text = JSON.stringify({
    sessionId: "arr",
    requests: [
      {
        message: { text: "do the thing" },
        response: [{ value: "first part " }, { content: "second part" }],
      },
    ],
  });
  const parsed = parseUsageLegacyJson(text, "w", "stem");
  assert.equal(parsed.requests.length, 1);
  assert.equal(parsed.requests[0].tokensEstimated, true);
  assert.ok(parsed.requests[0].outputTokens > 0);
  assert.ok(!validUsageFile({ version: 1, scannedAt: 1, index: blankUsageIndex(), files: { bad: 1 } }));
  assert.ok(!validUsageFile({
    version: 1,
    scannedAt: 1,
    index: blankUsageIndex(),
    files: { f: { workspaceId: "w", workspacePath: "", requests: [{ promptTokens: "x" }] } },
  }));
});

test("BYOK rejects non-object entries and oversized tables", () => {
  assert.throws(() => parseByokStore({ "opencode:openai/x": 5 }));
  const big: Record<string, unknown> = {};
  for (let i = 0; i < 1001; i++) big[`opencode:p/m${i}`] = { rates: { input: 1, read: 1, write: null, output: 1 } };
  assert.throws(() => parseByokStore(big));
});

test("efficiency ties break deterministically by name then id", () => {
  const mk = (id: string, name: string) => ({
    id,
    modelId: id,
    baseModelId: id,
    name,
    provider: "P",
    score: null as number | null,
    cost: 1,
    frontier: false,
    reasons: [] as string[],
    mappingStatus: "exact" as const,
    candidateIds: [] as string[],
    dominatedBy: [] as string[],
  });
  const sorted = sortRowsByEfficiency([mk("b", "same"), mk("a", "same")]);
  assert.deepEqual(sorted.map((r) => r.id), ["a", "b"]);
  const priced = (id: string) => ({ ...mk(id, "same"), score: 10 as number | null, cost: 10 as number | null });
  assert.deepEqual(
    sortRowsByEfficiency([priced("b"), priced("a")]).map((r) => r.id),
    ["a", "b"],
  );
});

test("workspace labels shorten paths and explain unmapped storage", () => {
  assert.equal(workspaceLabel("/home/user/repo", "abc123", false), "repo");
  assert.equal(workspaceLabel("C:\\Users\\me\\proj", "abc123", false), "proj");
  assert.equal(workspaceLabel("/a/one; /b/two", "abc123", false), "one; two");
  assert.equal(workspaceLabel("/home/user/repo", "abc123", true), "/home/user/repo");
  assert.equal(workspaceLabel("", "abc123", false), "abc123 · unmapped workspace (no readable workspace.json)");
  assert.equal(workspaceLabel("", "abc123", true), "abc123 · unmapped workspace (no readable workspace.json)");
  assert.equal(workspaceLabel(";", "abc123", false), "abc123");
});

test("coverage: webview shell exposes new controls and CSP", async () => {
  const { html } = await import("../src/html");
  const out = html("https://s/webview.js", "https://s/style.css", "https://s", "nonce123");
  for (const id of ["claude-code", "codex", "gemini-cli", "cursor", "windsurf", "aider", "amazon-q", "display-labels", "display-frontier", "display-chart", "display-quadrant", "display-scale", "display-sort", "free-only", "free-bar", "free-bar-title", "free-bar-empty", "free-bar-list", "custom-card", "custom-title", "custom-clear", "custom-chart", "custom-empty", "custom-rows", "custom-cost-heading", "sensitivity-card", "sensitivity-title", "sensitivity-note", "sensitivity-rows", "watchlist-alerts", "checklist", "export-csv", "export-snapshot", "export-badge", "export-png", "spotlight-result", "byok-card", "byok-save", "byok-clear", "byok-table", "usage-card", "usage-scan", "usage-pause", "usage-clear", "usage-watching", "usage-summary", "usage-models", "usage-days", "usage-workspaces", "usage-unknown", "usage-full-paths", "scenario-card", "scenario-plan", "scenario-requests-low", "scenario-requests-high", "scenario-prefill", "scenario-prefill-note", "scenario-custom", "scenario-custom-fee", "scenario-custom-allowance", "scenario-custom-overage", "scenario-plan-note", "scenario-result", "scenario-notes"]) {
    if (!out.includes(id)) throw new Error("missing "+id);
  }
  if (!out.includes("nonce-nonce123")) throw new Error("missing nonce");
});


test("usage p90 includes free requests in mixed and all-free samples", () => {
  const requests = Array.from({ length: 10 }, (_, i) => ({
    sessionId: "s", workspaceId: "w", requestIndex: i,
    modelId: i === 9 ? "copilot/gpt-5.4" : "copilot/auto",
    timestampMs: Date.parse("2026-09-01"), promptTokens: 100, outputTokens: 50,
    toolCallRounds: 0, tokensEstimated: false, promptProvenance: "observed" as const, outputProvenance: "observed" as const,
  }));
  const summary = aggregateUsage([{ workspaceId: "w", workspacePath: "/r", requests }]);
  assert.equal(summary.premiumP90, 0);
  assert.equal(suggestBudget(summary, "legacy")?.value, 0);
  const entry = { name: "Auto", provider: "Test", benchmarkFamilies: [], ids: ["auto"], rates: { input: 0, read: 0, write: null, output: 0 } };
  const free = aggregateUsage([{ workspaceId: "w", workspacePath: "/r", requests: requests.slice(0, 9) }], Date.now(), [entry]);
  assert.equal(free.creditP90, 0);
  assert.equal(free.creditSample, 9);
  assert.equal(suggestBudget(free, "credits")?.value, 0);
});

test("loadMappings tolerates malformed input and drops invalid entries individually", () => {
  assert.deepEqual(loadMappings(null), {});
  assert.deepEqual(loadMappings(undefined), {});
  assert.deepEqual(loadMappings("nope"), {});
  assert.deepEqual(loadMappings([1, 2]), {});
  assert.deepEqual(
    loadMappings({ "gpt-5.4": "b-high", bad1: 5, bad2: "", "": "x", bad3: null }),
    { "gpt-5.4": "b-high" },
  );
  const long = "x".repeat(1001);
  assert.deepEqual(loadMappings({ [long]: "b-high", "gpt-5.4": long }), {});
  const many: Record<string, string> = {};
  for (let i = 0; i < 5001; i++) many[`m${i}`] = `b${i}`;
  assert.equal(Object.keys(loadMappings(many)).length, 5000);
});

test("pricing status/source/issue: Copilot catalog matches, legacy, and cross-unit", () => {
  const opts = { ...defaults, source: "copilot" as const, billing: "credits" as const };
  const [priced] = compare([copilotModel], benchmarks, opts);
  assert.equal(priced.pricing?.status, "priced");
  assert.equal(priced.pricing?.source, "copilot-catalog");
  const legacyEntry = {
    ids: ["gpt-5.4"],
    name: "GPT-5.4",
    provider: "OpenAI",
    benchmarkFamilies: ["GPT-5.4"],
    legacy: { pro: 2, proPlus: 3 },
  };
  const [legacyRow] = compare(
    [copilotModel],
    benchmarks,
    { ...opts, billing: "legacy", plan: "pro" },
    {},
    [legacyEntry],
  );
  assert.equal(legacyRow.pricing?.status, "priced");
  assert.equal(legacyRow.pricing?.source, "legacy-multiplier");
  const [noMultiplier] = compare(
    [copilotModel],
    benchmarks,
    { ...opts, billing: "legacy", plan: "pro" },
    {},
    [{ ...legacyEntry, legacy: { proPlus: 3 } as never }],
  );
  assert.equal(noMultiplier.pricing?.status, "unresolved");
  assert.equal(noMultiplier.pricing?.issue, "legacy-no-multiplier");
  const [noRates] = compare(
    [copilotModel],
    benchmarks,
    opts,
    {},
    [{ ...legacyEntry, legacy: undefined }],
  );
  assert.equal(noRates.pricing?.status, "unresolved");
  assert.equal(noRates.pricing?.issue, "no-credit-rates");
  const [expired] = compare(
    [copilotModel],
    benchmarks,
    opts,
    {},
    [{ ...legacyEntry, rates: { input: 1, read: 1, write: null, output: 1 }, expires: "2020-01-01" }],
  );
  assert.equal(expired.pricing?.status, "unresolved");
  assert.equal(expired.pricing?.issue, "promo-expired");
  const [crossUnit] = compare([copilotModel], benchmarks, { ...opts, billing: "usd" as never });
  assert.equal(crossUnit.pricing?.status, "not-comparable");
  assert.equal(crossUnit.pricing?.issue, "cross-unit");
});

test("pricing status/issue: zero vs several Copilot catalog matches", () => {
  const [none] = compare([copilotModel], benchmarks, defaults, {}, []);
  assert.equal(none.pricing?.status, "unresolved");
  assert.equal(none.pricing?.issue, "no-catalog-entry");
  assert.equal(none.mapping?.issue, "no-catalog-entry");
  const dup = {
    ids: ["gpt-5.4"],
    name: "GPT-5.4",
    provider: "OpenAI",
    benchmarkFamilies: ["GPT-5.4"],
    rates: { input: 1, read: 1, write: null, output: 1 },
  };
  const [ambiguous] = compare([copilotModel], benchmarks, defaults, {}, [dup, dup]);
  assert.equal(ambiguous.pricing?.status, "unresolved");
  assert.equal(ambiguous.pricing?.issue, "ambiguous-catalog-entry");
  assert.equal(ambiguous.mapping?.issue, "ambiguous-catalog-entry");
});

test("pricing status/source: static registries, priced and unpriced", () => {
  const priced = compare(
    staticModels("codex"),
    benchmarks,
    { ...defaults, source: "codex", billing: "usd" },
  ).find((r) => r.modelId === "codex:gpt-5-6-terra")!;
  assert.equal(priced.pricing?.status, "priced");
  assert.equal(priced.pricing?.source, "static-registry");
  const unpriced = compare(
    staticModels("codex"),
    benchmarks,
    { ...defaults, source: "codex", billing: "usd" },
  ).find((r) => r.modelId === "codex:gpt-5-3-codex-spark")!;
  assert.equal(unpriced.pricing?.status, "unresolved");
  assert.equal(unpriced.pricing?.issue, "registry-unpriced");
  const crossUnit = compare(
    staticModels("codex"),
    benchmarks,
    { ...defaults, source: "codex", billing: "credits" as never },
  )[0];
  assert.equal(crossUnit.pricing?.status, "not-comparable");
  assert.equal(crossUnit.pricing?.issue, "cross-unit");
});

const terraModel: AvailableModel = {
  id: "opencode:openai/gpt-5.6-terra",
  name: "GPT-5.6 Terra",
  family: "gpt",
  maxInputTokens: 1050000,
  source: "opencode",
};
const usdOpts = { ...defaults, source: "opencode" as const, billing: "usd" as const };

test("pricing status/source: OpenCode CLI-priced, free tier, and cross-unit", () => {
  const cliPriced: AvailableModel = {
    ...terraModel,
    id: "opencode:opencode-go/gpt-5.6-terra",
    rates: { input: 2, read: 0.2, write: 2.5, output: 12 },
  };
  const [priced] = compare([cliPriced], benchmarks, usdOpts);
  assert.equal(priced.pricing?.status, "priced");
  assert.equal(priced.pricing?.source, "opencode-cli");
  const free: AvailableModel = {
    ...terraModel,
    id: "opencode:opencode/free",
    freeTier: true,
    rates: { input: 0, read: 0, write: null, output: 0 },
  };
  const [freeRow] = compare([free], benchmarks, usdOpts);
  assert.equal(freeRow.pricing?.status, "free");
  assert.equal(freeRow.pricing?.source, "opencode-cli");
  const [crossUnit] = compare([terraModel], benchmarks, { ...usdOpts, billing: "credits" as never });
  assert.equal(crossUnit.pricing?.status, "not-comparable");
  assert.equal(crossUnit.pricing?.issue, "cross-unit");
});

test("pricing suggestion: same-identifier registry rate for an unpriced provider-billed OpenCode model", () => {
  const [row] = compare([terraModel], benchmarks, usdOpts);
  assert.equal(row.pricing?.status, "unresolved");
  assert.equal(row.pricing?.issue, "provider-billed-no-rate");
  assert.equal(row.pricing?.suggestion?.registry, "codex");
  assert.equal(row.pricing?.suggestion?.registryId, "codex:gpt-5-6-terra");
  assert.equal(row.pricing?.suggestion?.registryDate, staticRegistryDate);
  // No suggestion when nothing in the registry matches the identifier.
  const [noHit] = compare(
    [{ ...terraModel, id: "opencode:openai/gpt-5.4-fast" }],
    benchmarks,
    usdOpts,
  );
  assert.equal(noHit.pricing?.suggestion, undefined);
});

test("pricing byok: manual provenance, registry provenance, and staleness wired from compare()", () => {
  const manual = compare([terraModel], benchmarks, usdOpts, {}, undefined, {
    byok: { "opencode:openai/gpt-5.6-terra": { rates: { input: 9, read: 9, write: null, output: 9 } } },
  })[0];
  assert.equal(manual.pricing?.status, "byok");
  assert.equal(manual.pricing?.byok?.provenance.kind, "manual");
  assert.equal(manual.pricing?.byok?.stale, undefined);
  assert.ok(manual.tier?.includes("BYOK"));

  const current = compare([terraModel], benchmarks, usdOpts, {}, undefined, {
    byok: {
      "opencode:openai/gpt-5.6-terra": {
        rates: { input: 2, read: 0.2, write: 2.5, output: 12 },
        source: { kind: "registry", registry: "codex", registryId: "codex:gpt-5-6-terra", registryDate: staticRegistryDate },
      },
    },
  })[0];
  assert.equal(current.pricing?.byok?.provenance.kind, "registry");
  assert.equal(current.pricing?.byok?.stale, undefined);

  const stale = compare([terraModel], benchmarks, usdOpts, {}, undefined, {
    byok: {
      "opencode:openai/gpt-5.6-terra": {
        rates: { input: 2, read: 0.2, write: 2.5, output: 12 },
        source: { kind: "registry", registry: "codex", registryId: "codex:does-not-exist", registryDate: "2020-01-01" },
      },
    },
  })[0];
  assert.equal(stale.pricing?.byok?.stale, "registry-missing");
  // The current real registry rate is offered as an unverified suggestion once stale.
  assert.equal(stale.pricing?.suggestion?.registryId, "codex:gpt-5-6-terra");
});

test("snapshot exports BYOK provenance for a registry-priced row", () => {
  const [row] = compare([terraModel], benchmarks, usdOpts, {}, undefined, {
    byok: {
      "opencode:openai/gpt-5.6-terra": {
        rates: { input: 2, read: 0.2, write: 2.5, output: 12 },
        source: { kind: "registry", registry: "codex", registryId: "codex:gpt-5-6-terra", registryDate: staticRegistryDate },
      },
    },
  });
  const snapshot = JSON.parse(
    exportSnapshot([row], usdOpts, new Set(), {
      source: "opencode",
      preset: "general",
      billing: "usd",
      catalogDate: "2026-09-10",
      staticRegistryDate,
    }),
  );
  assert.equal(snapshot.rows[0].pricingStatus, "byok");
  assert.equal(snapshot.rows[0].pricingSource, "byok");
  assert.deepEqual(snapshot.rows[0].pricingProvenance, {
    kind: "registry",
    registry: "codex",
    registryId: "codex:gpt-5-6-terra",
    registryDate: staticRegistryDate,
  });
});

test("mapping assist: no-alias-hit vs identifier-slug suggestion, independent of entry presence", () => {
  const entry = {
    ids: ["gpt-5.4"],
    name: "GPT-5.4",
    provider: "OpenAI",
    benchmarkFamilies: ["Something Else"],
  };
  const [noSuggestion] = compare(
    [copilotModel],
    [{ id: "x", slug: "totally-different", name: "Unrelated", provider: "P", scores: { general: 1, coding: 1, agentic: 1 } }],
    defaults,
    {},
    [entry],
  );
  assert.equal(noSuggestion.mapping?.issue, "no-alias-hit");
  assert.deepEqual(noSuggestion.mapping?.aliases, ["Something Else"]);
  assert.deepEqual(noSuggestion.mapping?.suggestions, []);
  const [withSuggestion] = compare(
    [copilotModel],
    [{ id: "s1", slug: "gpt-5-4", name: "GPT-5.4", provider: "P", scores: { general: 1, coding: 1, agentic: 1 } }],
    defaults,
    {},
    [entry],
  );
  assert.equal(withSuggestion.mapping?.issue, "no-alias-hit");
  assert.equal(withSuggestion.mapping?.suggestions.length, 1);
  assert.equal(withSuggestion.mapping?.suggestions[0].benchmarkId, "s1");
  assert.equal(withSuggestion.mapping?.suggestions[0].rule, "identifier-slug");
  // Suggestions do not require a catalog entry at all.
  const [noEntry] = compare(
    [copilotModel],
    [{ id: "s1", slug: "gpt-5-4", name: "GPT-5.4", provider: "P", scores: { general: 1, coding: 1, agentic: 1 } }],
    defaults,
    {},
    [],
  );
  assert.equal(noEntry.mapping?.issue, "no-catalog-entry");
  assert.deepEqual(noEntry.mapping?.aliases, []);
  assert.equal(noEntry.mapping?.suggestions.length, 1);
});

test("mapping assist: a stale override is explained, never silently substituted", () => {
  const [row] = compare([copilotModel], benchmarks, defaults, { "gpt-5.4": "missing-id" });
  assert.equal(row.mappingStatus, "missing");
  assert.equal(row.mapping?.issue, "override-stale");
  assert.equal(row.mapping?.staleBenchmarkId, "missing-id");
  assert.equal(row.selectedBenchmarkId, "missing-id");
});

test("a benchmark override on an unpriced model never establishes a price", () => {
  const automatic = compare([copilotModel], benchmarks, defaults, {}, [])[0];
  const overridden = compare(
    [copilotModel],
    benchmarks,
    defaults,
    { "gpt-5.4": "b-high" },
    [],
  )[0];
  assert.equal(automatic.cost, null);
  assert.equal(overridden.cost, null);
  assert.equal(overridden.mappingStatus, "user");
  assert.deepEqual(overridden.pricing, automatic.pricing);
});
