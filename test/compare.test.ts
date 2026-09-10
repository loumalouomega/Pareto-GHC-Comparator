import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compare,
  estimate,
  markFrontier,
  parseOptions,
  resolveBenchmark,
} from "../src/compare";
import { catalog } from "../src/catalog";
import { defaults, type Benchmark, type Row } from "../src/types";
const row = (id: string, cost: number | null, score: number | null): Row => ({
  id,
  name: id,
  provider: "Test",
  cost,
  score,
  frontier: false,
  reasons: [],
  dominatedBy: [],
});
const benchmark = (id: string, name = "GPT-5.4 (xhigh)"): Benchmark => ({
  id,
  slug: id,
  name,
  provider: "OpenAI",
  scores: { general: 80, coding: 70, agentic: null },
});
test("Pareto frontier retains ties and excludes dominated and incomplete records", () => {
  const rows = markFrontier([
    row("a", 0, 10),
    row("b", 1, 20),
    row("tie", 1, 20),
    row("c", 2, 20),
    row("d", 1, 15),
    row("missing", null, 90),
    row("no score", 3, null),
  ]);
  assert.deepEqual(
    rows.filter((r) => r.frontier).map((r) => r.id),
    ["a", "b", "tie"],
  );
  assert.deepEqual(rows[3].dominatedBy, ["b", "tie"]);
});
test("AI credit formula uses disjoint buckets and cache-write rate", () => {
  const e = catalog.find((e) => e.name === "Claude Haiku 4.5")!;
  assert.equal(
    estimate(e, {
      ...defaults,
      tokens: { input: 1000, read: 1000, write: 1000, output: 1000 },
    }).cost,
    0.735,
  );
  assert.equal(
    estimate(
      catalog.find((e) => e.name === "GPT-5 mini"),
      { ...defaults, tokens: { input: 0, read: 0, write: 1000, output: 0 } },
    ).cost,
    0.025,
  );
});
test("context threshold counts all input buckets and uses strict greater-than", () => {
  const e = catalog.find((e) => e.name === "GPT-5.4")!;
  assert.equal(
    estimate(e, {
      ...defaults,
      tokens: { input: 270000, read: 1000, write: 1000, output: 0 },
    }).tier,
    "Default context",
  );
  assert.equal(
    estimate(e, {
      ...defaults,
      tokens: { input: 270001, read: 1000, write: 1000, output: 1000 },
    }).cost,
    (270001 * 5 + 1000 * 0.5 + 1000 * 5 + 1000 * 22.5) / 10000,
  );
});
test("legacy plans use documented multipliers and do not invent new-model rates", () => {
  for (const plan of ["pro", "proPlus"] as const)
    assert.equal(
      estimate(
        catalog.find((e) => e.name === "GPT-5.5"),
        { ...defaults, billing: "legacy", plan },
      ).cost,
      57,
    );
  assert.equal(
    estimate(
      catalog.find((e) => e.name === "GPT-6 Astra"),
      { ...defaults, billing: "legacy" },
    ).cost,
    null,
  );
});
test("expired promotions and unknown models are unpriced", () => {
  assert.equal(
    estimate(
      catalog.find((e) => e.name === "Gemini 3.8 Flash"),
      defaults,
      Date.parse("2027-01-01"),
    ).cost,
    null,
  );
  assert.equal(estimate(undefined, defaults).cost, null);
});
test("mapping is exact, ambiguity requires explicit resolution, and stale mappings fail closed", () => {
  const e = catalog.find((e) => e.name === "GPT-5.4")!;
  assert.equal(resolveBenchmark(e, [benchmark("a")]).benchmark?.id, "a");
  assert.match(
    resolveBenchmark(e, [benchmark("a"), benchmark("b", "GPT-5.4 (high)")])
      .reason!,
    /Ambiguous/,
  );
  assert.equal(
    resolveBenchmark(e, [benchmark("a"), benchmark("b")], "b").benchmark?.id,
    "b",
  );
  assert.match(
    resolveBenchmark(e, [benchmark("a")], "gone").reason!,
    /no longer/,
  );
  assert.equal(
    resolveBenchmark(e, [benchmark("a", "GPT-5.4 mini")]).benchmark,
    undefined,
  );
});
test("filter recomputes frontier and context limits exclude impossible estimates", () => {
  const available = [
    {
      id: "gpt-5.4",
      name: "GPT-5.4",
      family: "gpt-5.4",
      maxInputTokens: 300000,
    },
    { id: "gpt-5.5", name: "GPT-5.5", family: "gpt-5.5", maxInputTokens: 500 },
  ];
  const results = compare(
    available,
    [benchmark("a"), benchmark("b", "GPT-5.5")],
    defaults,
  );
  assert.equal(results[0].frontier, true);
  assert.equal(results[1].cost, null);
  assert.match(results[1].reasons.join(), /context limit/);
  assert.equal(
    compare(available, [benchmark("a")], { ...defaults, filter: "5.4" }).length,
    1,
  );
  const subset = markFrontier([row("a", 1, 10), row("b", 2, 9)]).filter(
    (r) => r.id === "b",
  );
  assert.equal(markFrontier(subset)[0].frontier, true);
  assert.equal(
    compare(available, [benchmark("a")], { ...defaults, preset: "agentic" })[0]
      .score,
    null,
  );
});
test("input validation rejects negative, fractional, nonfinite and malformed values", () => {
  for (const input of [-1, 0.1, Infinity, NaN, 100000001])
    assert.throws(() =>
      parseOptions({ ...defaults, tokens: { ...defaults.tokens, input } }),
    );
  assert.throws(() => parseOptions(null));
  assert.throws(() => parseOptions({ ...defaults, tokens: {} }));
  assert.deepEqual(parseOptions(defaults), defaults);
});
