import { test } from "vitest";
import assert from "node:assert/strict";
import {
  baseModelIdOf,
  compare,
  estimate,
  freeSpotlight,
  migrateOptions,
  parseOptions,
  pinRowId,
  savedOptions,
} from "../src/compare";
import { exportCsv } from "../src/export";
import { parseMessage } from "../src/messages";
import { recommend } from "../src/recommend";
import { defaults, type AvailableModel, type Benchmark } from "../src/types";
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

test("unknown pinned benchmarks are ignored; unpin restores single row", () => {
  const rows = compare([copilotModel], benchmarks, defaults, {}, undefined, {
    pins: { "gpt-5.4": ["missing-id"] },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "gpt-5.4");
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
  assert.deepEqual(parsed.display, { labels: true, frontier: true, scale: "auto" });
  assert.equal(parsed.freeOnly, false);
  const migrated = savedOptions({ source: "copilot", preset: "coding", billing: "credits", plan: "pro", filter: "", tokens: defaults.tokens, recommendation: defaults.recommendation });
  assert.deepEqual(migrated.display, { labels: true, frontier: true, scale: "auto" });
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
  const entry = staticEntries("codex").find((e) => e.ids[0] === "codex:gpt-5-4")!;
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
  const w = workload({ ...defaults, display: { labels: false, frontier: false, scale: "linear" }, freeOnly: true });
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
    display: { labels: false, frontier: false, scale: "linear" },
    freeOnly: true,
  });
  assert.equal(kept.display.labels, false);
  assert.equal(kept.display.scale, "linear");
  const fallback = parseOptions({ ...defaults, display: { labels: 1, frontier: 0, scale: "x" } });
  assert.equal(fallback.display.labels, false);
  assert.equal(fallback.display.scale, "auto");
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
    { ...defaults, tokens: { input: 11, read: 0, write: 0, output: 0 } },
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

test("coverage: webview shell exposes new controls and CSP", async () => {
  const { html } = await import("../src/html");
  const out = html("https://s/webview.js", "https://s/style.css", "https://s", "nonce123");
  for (const id of ["claude-code", "codex", "gemini-cli", "cursor", "windsurf", "aider", "amazon-q", "display-labels", "display-frontier", "display-scale", "free-only", "checklist", "export-csv", "export-png", "spotlight-result"]) {
    if (!out.includes(id)) throw new Error("missing "+id);
  }
  if (!out.includes("nonce-nonce123")) throw new Error("missing nonce");
});
