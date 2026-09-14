import { test } from "vitest";
import assert from "node:assert/strict";
import { defaults, type Billing, type ChartType, type UsageRequest } from "../src/types";
import {
  loadComparison,
  optionResult,
  comparisonDelta,
  overlayResult,
  type ComparisonOption,
  type OptionResult,
} from "../src/comparison";
import { normalizeCost } from "../src/normalize";
import { parseMessage } from "../src/messages";
import {
  aggregateUsage,
  parseUsageJsonl,
  parseUsageLegacyJson,
  emptyUsageDiagnostics,
  validUsageFile,
  blankUsageIndex,
  usageParserVersion,
  selectChangedFiles,
} from "../src/usage";
const option = (): ComparisonOption => ({
  name: "A",
  options: structuredClone(defaults),
  mappings: {},
  pins: {},
  excluded: {},
});
const stored = () => ({
  version: 1,
  enabled: true,
  active: "A",
  normalize: false,
  sides: { A: option(), B: option() },
});
test("comparison store validates independently and synchronizes shared settings", () => {
  const raw = stored();
  raw.sides.B.options.preset = "coding";
  raw.sides.B.options.display.chart = "workload";
  const loaded = loadComparison(raw)!;
  assert.ok(loaded);
  assert.equal(loaded.sides.B.options.preset, "general");
  assert.equal(loaded.sides.B.options.display.chart, "task");
  assert.equal(loaded.normalize, false);
  assert.equal(loadComparison({ ...raw, normalize: true })?.normalize, true);
  assert.equal(
    loadComparison({ ...raw, normalize: "yes" })?.normalize,
    false,
  );
  // A store saved before the overlay view existed, or with a corrupted
  // value, still loads and defaults to the original side-by-side view.
  assert.equal(loaded.view, "side-by-side");
  assert.equal(loadComparison({ ...raw, view: "overlay" })?.view, "overlay");
  assert.equal(
    loadComparison({ ...raw, view: "bogus" })?.view,
    "side-by-side",
  );
  loaded.sides.A.options.tokens.input = 700;
  assert.equal(raw.sides.A.options.tokens.input, 1000);
  for (const v of [
    undefined,
    {},
    { ...raw, version: 2 },
    { ...raw, enabled: 1 },
    { ...raw, active: "C" },
    { ...raw, sides: null },
  ])
    assert.equal(loadComparison(v), undefined);
  for (const change of [
    { name: "" },
    { name: 7 },
    { name: "a".repeat(61) },
    { options: {} },
    { mappings: [] },
    { mappings: { x: 7 } },
    { pins: { x: "bad" } },
    { pins: { x: [7] } },
    { excluded: null },
    { selected: 7 },
    { selected: "a".repeat(1001) },
  ]) {
    assert.equal(
      loadComparison({
        ...raw,
        sides: { A: { ...option(), ...change }, B: option() },
      }),
      undefined,
    );
  }
  raw.sides.A.selected = "x";
  assert.equal(loadComparison(raw)?.sides.A.selected, "x");
  const huge = Object.fromEntries(
    Array.from({ length: 5001 }, (_, i) => [String(i), "a"]),
  );
  assert.equal(
    loadComparison({
      ...raw,
      sides: { A: { ...option(), mappings: huge }, B: option() },
    }),
    undefined,
  );
});
test("comparison result keeps structure independent and explains deltas", () => {
  const available = [
    {
      id: "gpt-5-mini",
      family: "gpt-5-mini",
      name: "GPT-5 mini",
      maxInputTokens: 100000,
    },
  ];
  const benchmarks = [
    {
      id: "aa",
      slug: "gpt-5-mini",
      name: "GPT-5 mini",
      provider: "OpenAI",
      scores: { general: 30, coding: 40, agentic: 20 },
    },
  ];
  const a = option();
  a.options.billing = "legacy";
  const result = optionResult(a, available, benchmarks, {}, new Map());
  assert.equal(result.rows.length, 1);
  assert.equal(result.selected, "gpt-5-mini");
  assert.equal(comparisonDelta(result, result).cost, 0);
  assert.equal(comparisonDelta(result, result).score, 0);
  const b = structuredClone(result);
  b.options.billing = "usd";
  assert.match(comparisonDelta(result, b).reason, /units/);
  b.options.billing = "legacy";
  b.options.plan = "proPlus";
  assert.match(comparisonDelta(result, b).reason, /plans/);
  b.options.plan = "pro";
  b.options.display.chart = "workload";
  assert.match(comparisonDelta(result, b).reason, /bases/);
  const c = structuredClone(b);
  c.options.billing = "credits";
  b.options.billing = "credits";
  c.options.tokens.input++;
  assert.match(comparisonDelta(b, c).reason, /workloads/);
  a.options.onlyMine = true;
  a.options.display.sort = "efficiency";
  const hidden = optionResult(a, available, benchmarks, {}, new Map());
  assert.equal(hidden.rows.length, 0);
  assert.equal(hidden.structureIds.length, 2);
  assert.equal(comparisonDelta(hidden, hidden).cost, null);
  a.options.onlyMine = false;
  a.excluded.copilot = ["gpt-5-mini"];
  assert.equal(
    optionResult(a, available, benchmarks, {}, new Map()).rows.length,
    0,
  );
  a.excluded = {};
  a.selected = "gpt-5-mini";
  assert.equal(
    optionResult(a, available, benchmarks, {}, new Map()).selected,
    a.selected,
  );
});
test("comparisonDelta computes an optional USD equivalent delta only when requested", () => {
  const available = [
    { id: "gpt-5-mini", family: "gpt-5-mini", name: "GPT-5 mini", maxInputTokens: 100000 },
  ];
  const benchmarks = [
    {
      id: "aa",
      slug: "gpt-5-mini",
      name: "GPT-5 mini",
      provider: "OpenAI",
      scores: { general: 30, coding: 40, agentic: 20 },
    },
  ];
  const a = option();
  const result = optionResult(a, available, benchmarks, {}, new Map());
  assert.equal(comparisonDelta(result, result).usd, null);
  assert.equal(comparisonDelta(result, result, true).usd?.reason, "Same billing unit: see the cost delta.");

  const b = structuredClone(result);
  b.options.billing = "usd";
  const usdCredits = comparisonDelta(result, b, true).usd!;
  assert.equal(usdCredits.A.status, "converted");
  assert.equal(usdCredits.B.status, "native");
  if (usdCredits.A.status === "converted")
    assert.equal(usdCredits.A.usd, Math.round(usdCredits.A.original.value * 0.01 * 1e10) / 1e10);
  assert.equal(typeof usdCredits.delta, "number");
  assert.match(usdCredits.reason, /pay-as-you-go/);

  const c = structuredClone(result);
  c.options.billing = "legacy";
  const legacyDelta = comparisonDelta(c, b, true).usd!;
  assert.match(legacyDelta.reason, /A not converted: .*never converted/);
  assert.equal(legacyDelta.delta, null);

  const d = structuredClone(result);
  d.options.display.chart = "workload";
  assert.match(comparisonDelta(d, b, true).usd!.reason, /bases/);

  const noSelection = structuredClone(result);
  noSelection.selected = undefined;
  const noneDelta = comparisonDelta(noSelection, b, true).usd!;
  assert.match(noneDelta.reason, /A not converted: Cost unavailable/);
});
// Minimal OptionResult stand-in: overlayResult only reads `options` and
// `rows`/`selected`, so tests can hand it exact cost/score pairs instead of
// routing through the full catalog-dependent compare() pipeline.
const fakeResult = (
  billing: Billing,
  chart: ChartType,
  rows: Array<{ id: string; cost: number; score: number; frontier?: boolean }>,
  selected?: string,
): OptionResult => {
  const options = structuredClone(defaults);
  options.billing = billing;
  options.display.chart = chart;
  return {
    name: "X",
    options,
    rows: rows.map((r) => ({
      id: r.id,
      modelId: r.id,
      baseModelId: r.id,
      name: r.id,
      provider: "Test",
      score: r.score,
      cost: r.cost,
      frontier: r.frontier ?? false,
      reasons: [],
      dominatedBy: [],
      mappingStatus: "exact",
      candidateIds: [],
    })),
    recommendation: { modelIds: [], explanation: "" },
    selected,
    groups: [],
    structureIds: [],
    scenario: { status: "off" },
  } as unknown as OptionResult;
};
test("overlayResult keeps native costs when both sides share a billing unit", () => {
  const a = fakeResult(
    "credits",
    "task",
    [{ id: "m1", cost: 2, score: 30, frontier: true }],
    "m1",
  );
  const b = fakeResult("credits", "task", [
    { id: "m2", cost: 5, score: 50, frontier: true },
  ]);
  const overlay = overlayResult(a, b);
  assert.equal(overlay.unit, "AI credits");
  assert.equal(overlay.converted, false);
  assert.equal(overlay.rows.length, 2);
  assert.deepEqual(overlay.excluded, { A: 0, B: 0 });
  assert.equal(overlay.notices.length, 0);
  const rowA = overlay.rows.find((r) => r.side === "A")!;
  assert.equal(rowA.x, 2);
  assert.equal(rowA.selected, true);
  assert.equal(rowA.sideFrontier, true);
});
test("overlayResult converts to a USD-equivalent axis when billing units differ, dropping rows it can't convert", () => {
  const a = fakeResult("credits", "task", [{ id: "m1", cost: 200, score: 30 }]);
  const b = fakeResult("usd", "task", [{ id: "m2", cost: 1.5, score: 50 }]);
  const overlay = overlayResult(a, b);
  assert.equal(overlay.unit, "USD equivalent");
  assert.equal(overlay.converted, true);
  const converted = normalizeCost(200, "credits", "task");
  assert.equal(converted.status, "converted");
  if (converted.status === "converted")
    assert.equal(overlay.rows.find((r) => r.side === "A")!.x, converted.usd);
  assert.equal(overlay.rows.find((r) => r.side === "B")!.x, 1.5);
  // Legacy premium requests never convert to a USD equivalent (see
  // normalize.ts): those rows are dropped and counted rather than mixed in.
  const legacy = fakeResult("legacy", "task", [{ id: "m3", cost: 1, score: 20 }]);
  const overlayLegacy = overlayResult(legacy, b);
  assert.equal(overlayLegacy.excluded.A, 1);
  assert.equal(overlayLegacy.rows.filter((r) => r.side === "A").length, 0);
  assert.match(overlayLegacy.notices[0], /never converted/);
  assert.match(overlayLegacy.notices[0], /1 from A, 0 from B/);
});
test("overlayResult blocks the combined frontier when the options aren't comparable, but keeps each side's own frontier flag", () => {
  const a = fakeResult("credits", "workload", [
    { id: "m1", cost: 2, score: 30, frontier: true },
  ]);
  const b = fakeResult("credits", "workload", [
    { id: "m2", cost: 5, score: 50, frontier: true },
  ]);
  b.options.tokens.input += 1;
  const overlay = overlayResult(a, b);
  assert.ok(overlay.rows.every((r) => !r.combinedFrontier));
  assert.match(overlay.notices.join(" "), /Combined frontier unavailable/);
  assert.match(overlay.notices.join(" "), /workloads/);
  assert.ok(overlay.rows.every((r) => r.sideFrontier));
});
test("overlayResult computes a combined Pareto frontier across both sides, without conflating rows that share an id", () => {
  const a = fakeResult("credits", "task", [
    { id: "shared", cost: 1, score: 20 },
    { id: "extra", cost: 3, score: 20 },
  ]);
  const b = fakeResult("credits", "task", [
    { id: "shared", cost: 4, score: 60 },
    { id: "extra", cost: 0.2, score: 10 },
  ]);
  const overlay = overlayResult(a, b);
  const at = (side: "A" | "B", id: string) =>
    overlay.rows.find((r) => r.side === side && r.id === id)!;
  assert.equal(at("A", "shared").combinedFrontier, true);
  assert.equal(at("B", "shared").combinedFrontier, true);
  assert.equal(at("A", "extra").combinedFrontier, false);
  // Same id "extra" reused on the other side is a distinct, non-dominated
  // point: the combined frontier must key off the row itself, not the id.
  assert.equal(at("B", "extra").combinedFrontier, true);
  assert.equal(
    overlay.notices.some((n) => /Combined frontier unavailable/.test(n)),
    false,
  );
});
test("each comparison side projects its own spending scenario, defaulting off", () => {
  const available = [
    { id: "gpt-5-mini", family: "gpt-5-mini", name: "GPT-5 mini", maxInputTokens: 100000 },
  ];
  const benchmarks = [
    {
      id: "aa",
      slug: "gpt-5-mini",
      name: "GPT-5 mini",
      provider: "OpenAI",
      scores: { general: 30, coding: 40, agentic: 20 },
    },
  ];
  const a = option();
  const off = optionResult(a, available, benchmarks, {}, new Map());
  assert.equal(off.scenario.status, "off");
  assert.equal(comparisonDelta(off, off).scenario.reason, "Scenario off or unavailable on at least one option.");

  const withScenario = option();
  withScenario.options.scenario = {
    ...defaults.scenario,
    planId: "copilot-pro",
    requestsLow: 10,
    requestsHigh: 10,
  };
  const projected = optionResult(withScenario, available, benchmarks, {}, new Map());
  assert.equal(projected.scenario.status, "projected");
  if (projected.scenario.status === "projected") {
    // No selected row, so it falls back to the recommended row and notes it.
    assert.equal(projected.scenario.row.origin, "recommended");
    assert.ok(projected.scenario.notes.some((n) => /recommended model/.test(n)));
  }
  const other = option();
  other.options.scenario = { ...defaults.scenario, planId: "copilot-max", requestsLow: 10, requestsHigh: 10 };
  const projectedOther = optionResult(other, available, benchmarks, {}, new Map());
  const delta = comparisonDelta(projected, projectedOther);
  assert.equal(typeof delta.scenario.low, "number");
  assert.match(delta.scenario.reason, /not a bound/);
});
test("comparison messages reject malformed targets and nested envelopes", () => {
  assert.deepEqual(
    parseMessage({
      type: "target",
      side: "B",
      action: { type: "select", id: "x" },
    }),
    { type: "target", side: "B", action: { type: "select", id: "x" } },
  );
  assert.equal(
    parseMessage({
      type: "comparison",
      enabled: true,
      active: "B",
      name: "Two",
    }).type,
    "comparison",
  );
  assert.deepEqual(
    parseMessage({ type: "comparison", normalize: true }),
    { type: "comparison", enabled: undefined, active: undefined, name: undefined, normalize: true, view: undefined },
  );
  const viewMessage = parseMessage({ type: "comparison", view: "overlay" });
  assert.equal(viewMessage.type, "comparison");
  assert.equal(
    viewMessage.type === "comparison" ? viewMessage.view : undefined,
    "overlay",
  );
  for (const v of [
    { type: "comparison", enabled: 1 },
    { type: "comparison", active: "C" },
    { type: "comparison", name: "" },
    { type: "comparison", normalize: "yes" },
    { type: "comparison", view: "bogus" },
    { type: "target", side: "C", action: {} },
    { type: "target", side: "A", action: { type: "target" } },
    { type: "target", side: "A", action: null },
  ])
    assert.throws(() => parseMessage(v));
});
const record = (metadata: unknown, index = 0) =>
  JSON.stringify({
    kind: 1,
    k: ["requests", index, "result"],
    v: { metadata, timings: { requestSent: -5 } },
  });
test("usage diagnostics preserve zero, reject bad counters, and identify partial files", () => {
  const parsed = parseUsageJsonl(
    [
      JSON.stringify({ kind: 0, v: { sessionId: "s" } }),
      record({ promptTokens: 0, outputTokens: 0 }),
      record({ promptTokens: -1, outputTokens: 3 }, 1),
      "{truncated",
      JSON.stringify({ kind: 99, v: { unrelated: true } }),
    ].join("\n"),
    "w",
    "s",
  );
  assert.equal(parsed.diagnostics.malformed, 1);
  assert.equal(parsed.diagnostics.unsupported, 0);
  assert.equal(parsed.diagnostics.missingTokens, 1);
  assert.equal(parsed.requests[0].promptProvenance, "observed");
  assert.equal(parsed.requests[0].timestampMs, null);
  assert.equal(parsed.requests[1].promptProvenance, "missing");
  const total = aggregateUsage([
    { workspaceId: "w", workspacePath: "", ...parsed },
  ]);
  assert.equal(total.medianSample, 1);
  assert.equal(total.medianPrompt, 0);
  assert.equal(parseUsageJsonl("{}", "w", "s").diagnostics.unsupported, 1);
  assert.equal(
    parseUsageJsonl('{"kind":0,"v":{}}', "w", "s").diagnostics.unsupported,
    0,
  );
  assert.equal(
    parseUsageJsonl("4\n" + record({}, -1), "w", "s").diagnostics.malformed,
    2,
  );
  assert.equal(
    parseUsageJsonl(
      record({ promptTokens: 1 }) + "\n" + record({ promptTokens: 2 }),
      "w",
      "s",
    ).requests.length,
    1,
  );
  assert.equal(
    parseUsageJsonl(
      record({ promptTokens: 1 }) + "\n" + record({ promptTokens: 2 }),
      "w",
      "s",
    ).requests[0].promptTokens,
    2,
  );
});
test("legacy formats separate observations from text estimates and unsupported input", () => {
  const p = parseUsageLegacyJson(
    JSON.stringify({
      requests: [
        {
          message: { text: "long prompt" },
          response: {
            result: { metadata: { promptTokens: 0, outputTokens: 0 } },
          },
        },
        {
          message: { text: "estimate this" },
          response: [{ content: "answer" }],
        },
        false,
      ],
    }),
    "w",
    "s",
  );
  assert.equal(p.requests[0].tokensEstimated, false);
  assert.equal(p.requests[0].promptTokens, 0);
  assert.equal(p.requests[1].promptProvenance, "estimated");
  assert.equal(p.diagnostics.estimatedTokens, 1);
  assert.equal(p.diagnostics.malformed, 1);
  assert.equal(
    aggregateUsage([{ workspaceId: "w", workspacePath: "", ...p }])
      .medianSample,
    1,
  );
  assert.equal(parseUsageLegacyJson("{}", "w", "s").diagnostics.unsupported, 1);
  assert.equal(
    parseUsageLegacyJson('{"requests":[]}', "w", "s").diagnostics.unsupported,
    0,
  );
});
test("usage v2 storage validates provenance and parser version forces old files to rescan", () => {
  const parsed = parseUsageJsonl(
    record({ promptTokens: 0, outputTokens: 2 }),
    "w",
    "s",
  );
  const value = {
    version: 2,
    scannedAt: 1,
    index: blankUsageIndex(),
    files: { f: { workspaceId: "w", workspacePath: "", ...parsed } },
  };
  assert.ok(validUsageFile(value));
  assert.ok(!validUsageFile({ ...value, version: 1 }));
  for (const edit of [
    { promptTokens: -1 },
    { outputTokens: Infinity },
    { timestampMs: Infinity },
    { promptProvenance: undefined },
    { workspaceId: 4 },
    { requestIndex: -1 },
    { modelId: 4 },
  ]) {
    assert.ok(
      !validUsageFile({
        ...value,
        files: {
          f: {
            ...value.files.f,
            requests: [{ ...parsed.requests[0], ...edit }],
          },
        },
      }),
    );
  }
  assert.ok(
    !validUsageFile({
      ...value,
      files: { f: { ...value.files.f, diagnostics: {} } },
    }),
  );
  assert.ok(
    !validUsageFile({
      ...value,
      index: { version: 1, files: { f: { size: 1, mtime: 1, parser: 0 } } },
    }),
  );
  const c = {
    filePath: "f",
    workspaceId: "w",
    workspacePath: "",
    legacy: false,
    size: 1,
    mtime: 1,
  };
  assert.equal(
    selectChangedFiles([c], {
      version: 1,
      files: { f: { size: 1, mtime: 1, parser: usageParserVersion - 1 } },
    }).changed.length,
    1,
  );
});

test("synthetic stable, Insiders, legacy and damaged format fixtures disclose completeness", async () => {
  const { readFile } = await import("node:fs/promises");
  const parse = async (name: string) =>
    parseUsageJsonl(
      await readFile(`test/fixtures/usage/${name}.jsonl`, "utf8"),
      "w",
      name,
    );
  for (const name of ["stable", "insiders"]) {
    const p = await parse(name);
    assert.equal(p.requests.length, 1);
    assert.equal(p.diagnostics.unsupported, 0);
    assert.equal(p.requests[0].promptProvenance, "observed");
  }
  assert.equal((await parse("truncated")).diagnostics.malformed, 1);
  assert.equal((await parse("unsupported")).diagnostics.unsupported, 1);
  assert.equal((await parse("empty")).requests.length, 0);
  assert.equal((await parse("empty")).diagnostics.unsupported, 0);
  const legacy = parseUsageLegacyJson(
    await readFile("test/fixtures/usage/legacy.json", "utf8"),
    "w",
    "s",
  );
  assert.equal(legacy.diagnostics.estimatedTokens, 1);
});
