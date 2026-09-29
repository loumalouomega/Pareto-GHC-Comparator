import { test } from "vitest";
import assert from "node:assert/strict";
import {
  applyDisplayFilters,
  compare,
  markFrontier,
  parseOptions,
  savedOptions,
  withoutViewFilters,
} from "../src/compare";
import { optionResult, type ComparisonOption } from "../src/comparison";
import { defaults, type AvailableModel, type Benchmark, type Row } from "../src/types";

const row = (
  id: string,
  score: number | null,
  cost: number | null,
  extra: Partial<Row> = {},
): Row => ({
  id,
  modelId: id,
  baseModelId: id,
  name: id,
  provider: "Test",
  score,
  cost,
  frontier: false,
  reasons: [],
  dominatedBy: [],
  mappingStatus: "exact",
  candidateIds: [],
  ...extra,
});

const display = (patch: Partial<typeof defaults.display>) => ({
  ...defaults.display,
  ...patch,
});

test("min score keeps rows at the floor and rows with an unknown score", () => {
  const rows = [row("low", 29, 1), row("edge", 30, 1), row("top", 60, 2), row("none", null, 1)];
  assert.deepEqual(
    applyDisplayFilters(rows, display({ minScore: 30 })).map((r) => r.id),
    ["edge", "top", "none"],
  );
  assert.equal(applyDisplayFilters(rows, display({ minScore: 0 })).length, 4);
});

test("maker filters by benchmark maker exactly", () => {
  const rows = [row("a", 1, 1, { provider: "OpenAI" }), row("b", 2, 2, { provider: "Anthropic" })];
  assert.deepEqual(
    applyDisplayFilters(rows, display({ maker: "Anthropic" })).map((r) => r.id),
    ["b"],
  );
  assert.deepEqual(applyDisplayFilters(rows, display({ maker: "anthropic" })), []);
});

test("collapse keeps the best-scoring variant per base model, cheaper on a tie", () => {
  const rows = [
    row("m::low", 40, 1, { baseModelId: "m" }),
    row("m::high", 70, 5, { baseModelId: "m" }),
    row("m::high2", 70, 3, { baseModelId: "m" }),
    row("m::unscored", null, 1, { baseModelId: "m" }),
    row("n::only", null, 1, { baseModelId: "n" }),
    row("other", 10, 1),
  ];
  assert.deepEqual(
    applyDisplayFilters(rows, display({ collapse: true })).map((r) => r.id),
    ["m::high2", "n::only", "other"],
  );
});

test("filters apply before the frontier so dominance reflects what is shown", () => {
  const rows = [
    row("cheap-low", 20, 1, { provider: "A" }),
    row("pricey-high", 90, 9, { provider: "B" }),
    row("mid", 50, 3, { provider: "B" }),
  ];
  const all = markFrontier(rows);
  assert.ok(all.find((r) => r.id === "mid")!.frontier);
  const floored = markFrontier(applyDisplayFilters(rows, display({ minScore: 60 })));
  assert.deepEqual(floored.map((r) => r.id), ["pricey-high"]);
  assert.ok(floored[0].frontier);
  const maker = markFrontier(applyDisplayFilters(rows, display({ maker: "A" })));
  assert.ok(maker[0].frontier);
});

const benchmarks: Benchmark[] = [
  { id: "b-high", slug: "b-high", name: "GPT-5.4 (high)", provider: "OpenAI", scores: { general: 80, coding: 85, agentic: 70 } },
  { id: "b-xhigh", slug: "b-xhigh", name: "GPT-5.4 (xhigh)", provider: "OpenAI", scores: { general: 82, coding: 88, agentic: 71 } },
];
const model: AvailableModel = {
  id: "gpt-5.4",
  name: "GPT-5.4",
  family: "gpt-5.4",
  maxInputTokens: 400000,
  source: "copilot",
};

test("compare collapses expanded thinking rows to the best variant", () => {
  assert.equal(compare([model], benchmarks, defaults).length, 2);
  const collapsed = compare([model], benchmarks, {
    ...defaults,
    display: display({ collapse: true }),
  });
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].benchmark?.id, "b-xhigh");
  assert.ok(collapsed[0].frontier);
});

test("the checklist structure and free-tier baselines ignore the view filters", () => {
  const filtered = {
    ...defaults,
    display: display({ minScore: 99, collapse: true, maker: "Nobody" }),
  };
  assert.deepEqual(compare([model], benchmarks, filtered), []);
  const baseline = withoutViewFilters(filtered);
  assert.equal(baseline.display.minScore, 0);
  assert.equal(baseline.display.collapse, false);
  assert.equal(baseline.display.maker, "");
  assert.equal(compare([model], benchmarks, baseline).length, 2);
  const option: ComparisonOption = {
    name: "A",
    options: filtered,
    mappings: {},
    pins: {},
    excluded: {},
    selected: undefined,
  } as unknown as ComparisonOption;
  const result = optionResult(option, [model], benchmarks, {}, new Map());
  assert.equal(result.rows.length, 0);
  assert.equal(result.structureIds.filter((id) => id.includes("::")).length, 2);
  assert.deepEqual(result.makers, ["OpenAI"]);
});

test("display filter settings migrate to safe defaults and reject junk", () => {
  const migrated = savedOptions({
    source: "copilot",
    preset: "coding",
    billing: "credits",
    plan: "pro",
    filter: "",
    tokens: defaults.tokens,
    recommendation: defaults.recommendation,
  });
  assert.equal(migrated.display.minScore, 0);
  assert.equal(migrated.display.collapse, false);
  assert.equal(migrated.display.maker, "");
  const junk = parseOptions({
    ...defaults,
    display: { ...defaults.display, minScore: -5, collapse: "yes", maker: 7 },
  });
  assert.equal(junk.display.minScore, 0);
  assert.equal(junk.display.collapse, false);
  assert.equal(junk.display.maker, "");
  const valid = parseOptions({
    ...defaults,
    display: { ...defaults.display, minScore: 35, collapse: true, maker: "OpenAI" },
  });
  assert.deepEqual(
    [valid.display.minScore, valid.display.collapse, valid.display.maker],
    [35, true, "OpenAI"],
  );
});
