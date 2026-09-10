import { test } from "vitest";
import assert from "node:assert/strict";
import {
  defaults,
  type Row,
  type ProfileStore,
  type Benchmark,
} from "../src/types";
import { recommend } from "../src/recommend";
import { changeProfile, loadProfiles, profileModified } from "../src/profiles";
import { savedOptions, resolveBenchmark, compare } from "../src/compare";
import { parseMessage } from "../src/messages";
import { catalog } from "../src/catalog";
const row = (id: string, cost: number | null, score: number | null): Row => ({
  id,
  name: id,
  cost,
  score,
  provider: "Test",
  frontier: true,
  dominatedBy: [],
  reasons: [],
  mappingStatus: "exact",
  candidateIds: [],
});
test("budget recommendation uses inclusive boundaries, breaks score ties by cost, and retains exact ties", () => {
  const rows = [
    row("a", 1, 80),
    row("b", 0.5, 80),
    row("c", 0.5, 80),
    row("expensive", 1.01, 99),
    row("missing", null, 100),
  ];
  assert.deepEqual(recommend(rows, defaults).modelIds, ["b", "c"]);
  assert.deepEqual(recommend([rows[0]], defaults).modelIds, ["a"]);
  assert.deepEqual(recommend([rows[3]], defaults).modelIds, []);
  assert.match(recommend([rows[3]], defaults).explanation, /budget/);
});
test("near-best uses score points, cost first, then quality, and exact ties", () => {
  const options = {
    ...defaults,
    recommendation: { ...defaults.recommendation, mode: "nearBest" as const },
  };
  const rows = [
    row("best", 9, 80),
    row("cheap", 1, 77),
    row("better", 1, 78),
    row("tie", 1, 78),
    row("outside", 0, 76.9),
  ];
  assert.deepEqual(recommend(rows, options).modelIds, ["better", "tie"]);
  assert.equal(recommend(rows, options).threshold, 77);
  assert.deepEqual(
    recommend(rows, {
      ...options,
      recommendation: { ...options.recommendation, scoreGap: 0 },
    }).modelIds,
    ["best"],
  );
  assert.deepEqual(recommend(rows.slice(1), options).modelIds, ["outside"]);
});
test("zero budgets, zero scores, missing data, and independent billing budgets", () => {
  const options = {
    ...defaults,
    recommendation: {
      ...defaults.recommendation,
      budgets: { credits: 0, legacy: 2, usd: 0 },
    },
  };
  assert.deepEqual(
    recommend([row("free", 0, 0), row("paid", 2, 10)], options).modelIds,
    ["free"],
  );
  assert.deepEqual(
    recommend([row("free", 0, 0), row("paid", 2, 10)], {
      ...options,
      billing: "legacy",
    }).modelIds,
    ["paid"],
  );
  assert.match(
    recommend([row("none", 1, null)], defaults).explanation,
    /No comparable/,
  );
});
test("mapping recognizes Anthropic aliases and preserves all reasoning variants", () => {
  const entry = catalog.find((e) => e.ids.includes("claude-haiku-4.5"))!;
  const benchmark = (id: string, name: string): Benchmark => ({
    id,
    slug: id,
    name,
    provider: "Anthropic",
    scores: { general: 1, coding: 2, agentic: 3 },
  });
  const a = benchmark("a", "Claude 4.5 Haiku (Reasoning)"),
    b = benchmark("b", "Claude 4.5 Haiku (Non-reasoning)");
  assert.equal(resolveBenchmark(entry, [a]).status, "exact");
  const multiple = resolveBenchmark(entry, [a, b]);
  assert.equal(multiple.status, "selection");
  assert.deepEqual(multiple.candidateIds, ["a", "b"]);
  assert.equal(resolveBenchmark(entry, [a, b], "b").status, "user");
  assert.equal(resolveBenchmark(entry, [a], "gone").status, "missing");
  assert.equal(resolveBenchmark(entry, [a], "gone").benchmark, undefined);
  assert.equal(
    resolveBenchmark(entry, [benchmark("c", "Claude 4.5 Haiku Mini")]).status,
    "missing",
  );
  assert.equal(
    resolveBenchmark(entry, [benchmark("c", "Claude 4.5 Haiku (fast mode)")])
      .status,
    "missing",
  );
  const opus = catalog.find((e) => e.ids.includes("claude-opus-5"))!;
  assert.equal(
    resolveBenchmark(opus, [
      benchmark("c", "Claude Opus 5 (Adaptive Reasoning, Max Effort)"),
    ]).status,
    "exact",
  );
});
test("comparison propagates explicit mapping status and candidate IDs", () => {
  const model = {
    id: "claude-haiku-4.5",
    name: "Haiku",
    family: "",
    maxInputTokens: 10000,
  };
  const benchmark: Benchmark = {
    id: "a",
    slug: "a",
    name: "Claude 4.5 Haiku (Reasoning)",
    provider: "Anthropic",
    scores: { general: 1, coding: 2, agentic: 3 },
  };
  const result = compare([model], [benchmark], defaults, {
    [model.id]: "gone",
  })[0];
  assert.equal(result.mappingStatus, "missing");
  assert.equal(result.score, null);
  assert.deepEqual(result.candidateIds, ["a"]);
  assert.equal(result.selectedBenchmarkId, "gone");
});
test("v0.1 settings migrate without losing workload, filter, or billing choice", () => {
  const { recommendation: _, ...legacy } = defaults;
  const loaded = savedOptions({
    ...legacy,
    billing: "legacy",
    tokens: { input: 2000, read: 30, write: 40, output: 50 },
    filter: "Claude",
  });
  assert.equal(loaded.billing, "legacy");
  assert.equal(loaded.filter, "Claude");
  assert.equal(loaded.tokens.input, 2000);
  assert.deepEqual(loaded.recommendation, defaults.recommendation);
});
test("profiles support save, modify, apply, update, rename, delete and round-trip persistence", () => {
  const initial: ProfileStore = { version: 1, items: [] };
  const saved = changeProfile(
    initial,
    { ...defaults, filter: "Claude" },
    { action: "saveAs", name: " Debugging " },
    () => "profile-1",
  );
  assert.equal(saved.store.items[0].name, "Debugging");
  assert.ok(!("filter" in saved.store.items[0].workload));
  assert.equal(initial.items.length, 0);
  const detached = changeProfile(saved.store, defaults, { action: "custom" });
  assert.equal(detached.store.activeId, undefined);
  assert.equal(detached.store.items.length, 1);
  const edited = { ...defaults, tokens: { ...defaults.tokens, input: 5000 } };
  assert.equal(profileModified(saved.store, edited), true);
  assert.equal(
    profileModified(saved.store, { ...defaults, filter: "unrelated" }),
    false,
  );
  const applied = changeProfile(
    saved.store,
    { ...edited, filter: "preserved" },
    { action: "apply", id: "profile-1" },
  );
  assert.equal(applied.options.tokens.input, 1000);
  assert.equal(applied.options.filter, "preserved");
  assert.equal(profileModified(applied.store, applied.options), false);
  const updated = changeProfile(saved.store, edited, {
    action: "update",
    id: "profile-1",
  });
  assert.equal(updated.store.items[0].workload.tokens.input, 5000);
  const renamed = changeProfile(updated.store, edited, {
    action: "rename",
    id: "profile-1",
    name: "Tests",
  });
  assert.equal(renamed.store.items[0].name, "Tests");
  assert.deepEqual(
    loadProfiles(JSON.parse(JSON.stringify(renamed.store))),
    renamed.store,
  );
  const deleted = changeProfile(renamed.store, edited, {
    action: "delete",
    id: "profile-1",
  });
  assert.equal(deleted.store.items.length, 0);
  assert.equal(deleted.store.activeId, undefined);
  assert.deepEqual(deleted.options, edited);
});
test("profiles reject invalid names, duplicates, and stale actions; invalid persistence is ignored", () => {
  const store = changeProfile(
    { version: 1, items: [] },
    defaults,
    { action: "saveAs", name: "Saved" },
    () => "a",
  ).store;
  for (const name of ["", " ", "a".repeat(61), " saved "])
    assert.throws(() =>
      changeProfile(store, defaults, { action: "saveAs", name }),
    );
  assert.throws(() =>
    changeProfile(store, defaults, { action: "apply", id: "gone" }),
  );
  const corrupt = {
    ...store,
    items: [...store.items, { id: "bad", name: "bad", workload: {} }],
  };
  assert.equal(loadProfiles(corrupt).items.length, 1);
  assert.deepEqual(loadProfiles(null), { version: 1, items: [] });
});
test("typed messages validate profile actions and recommendation controls", () => {
  assert.deepEqual(
    parseMessage({
      type: "profile",
      change: { action: "saveAs", name: "Test", secret: "ignored" },
    }),
    { type: "profile", change: { action: "saveAs", name: "Test" } },
  );
  for (const raw of [
    { type: "profile", change: { action: "delete" } },
    { type: "profile", change: { action: "unknown", id: "a" } },
    { type: "mapping", id: "a", benchmarkId: 7 },
  ])
    assert.throws(() => parseMessage(raw));
  for (const value of [-1, NaN, Infinity])
    assert.throws(() =>
      parseMessage({
        type: "options",
        options: {
          ...defaults,
          recommendation: { ...defaults.recommendation, scoreGap: value },
        },
      }),
    );
});
