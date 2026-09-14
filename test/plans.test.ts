import { test } from "vitest";
import assert from "node:assert/strict";
import {
  historyScenarioPrefill,
  parseScenario,
  planRegistry,
  planRegistryDate,
  plansFor,
  projectScenario,
  scenarioDelta,
  scenarioDisclaimer,
  type PlanEntry,
} from "../src/plans";
import { defaults, type Options, type Row, type UsageSummary } from "../src/types";

const row = (overrides: Partial<Row> = {}): Row => ({
  id: "m",
  modelId: "m",
  baseModelId: "m",
  name: "Model",
  provider: "P",
  score: 80,
  cost: 1,
  frontier: false,
  reasons: [],
  mappingStatus: "exact",
  candidateIds: [],
  dominatedBy: [],
  ...overrides,
});

const scenario = (overrides: Record<string, unknown> = {}) =>
  parseScenario({ planId: "copilot-pro", requestsLow: 0, requestsHigh: 0, ...overrides });

const opts = (overrides: Partial<Options> = {}): Pick<Options, "source" | "billing" | "plan" | "display"> => ({
  source: "copilot",
  billing: "credits",
  plan: "pro",
  display: defaults.display,
  ...overrides,
});

const input = (over: Record<string, unknown> = {}) => ({
  scenario: scenario((over.scenario as Record<string, unknown>) ?? {}),
  options: opts((over.options as Partial<Options>) ?? {}),
  row: "row" in over ? (over.row as Row | undefined) : row(),
  rowOrigin: (over.rowOrigin as "selected" | "recommended" | "first-comparable") ?? "selected",
  catalogDate: "2026-09-10",
  ...(over.registry ? { registry: over.registry as readonly PlanEntry[] } : {}),
  ...(over.registryDate ? { registryDate: over.registryDate as string } : {}),
});

test("zero usage: allowance covers it, total equals the fee, within-base", () => {
  const result = projectScenario(
    input({ scenario: { requestsLow: 0, requestsHigh: 0 }, row: row({ cost: 1 }) }),
  );
  assert.equal(result.status, "projected");
  if (result.status !== "projected") return;
  assert.deepEqual(result.usage, { low: 0, high: 0 });
  assert.deepEqual(result.overageUnits, { low: 0, high: 0 });
  assert.deepEqual(result.overageUsd, { low: 0, high: 0, provenance: { kind: "provider", date: planRegistryDate, sources: result.overageUsd!.provenance.kind === "provider" ? result.overageUsd!.provenance.sources : [] } });
  assert.deepEqual(result.totalUsd, { low: 10, high: 10 });
  assert.deepEqual(result.boundary, { low: "within-base", high: "within-base" });
});

test("a zero-cost row adds its note but still projects", () => {
  const result = projectScenario(
    input({ scenario: { requestsLow: 100, requestsHigh: 100 }, row: row({ cost: 0 }) }),
  );
  assert.equal(result.status, "projected");
  if (result.status !== "projected") return;
  assert.ok(result.notes.some((n) => /costs 0 per request/.test(n)));
  assert.deepEqual(result.totalUsd, { low: 10, high: 10 });
});

test("allowance boundaries on Copilot Pro (base 1000, flex 500, fee $10, overage $0.01)", () => {
  const at = (n: number) =>
    projectScenario(
      input({ scenario: { requestsLow: n, requestsHigh: n }, row: row({ cost: 1 }) }),
    );
  const exactBase = at(1000);
  assert.equal(exactBase.status, "projected");
  if (exactBase.status === "projected") {
    assert.deepEqual(exactBase.boundary, { low: "within-base", high: "within-base" });
    assert.equal(exactBase.overageUnits.high, 0);
  }
  const overBaseByOne = at(1001);
  if (overBaseByOne.status === "projected") {
    assert.deepEqual(overBaseByOne.boundary, { low: "within-flex", high: "within-flex" });
    assert.equal(overBaseByOne.overageUnits.high, 1);
    assert.equal(overBaseByOne.overageUsd?.high, 0.01);
  }
  const exactAllowance = at(1500);
  if (exactAllowance.status === "projected") {
    assert.deepEqual(exactAllowance.boundary, { low: "within-flex", high: "within-flex" });
    // The boundary is within-flex (flex covers it), but the high (worst-case,
    // base-only) overage figure is still reported: flex is documented as
    // variable, so it is never assumed guaranteed for the pessimistic bound.
    assert.equal(exactAllowance.overageUnits.high, 500);
    assert.equal(exactAllowance.overageUnits.low, 0);
  }
  const overAllowance = at(1501);
  if (overAllowance.status === "projected") {
    assert.deepEqual(overAllowance.boundary, { low: "over-allowance", high: "over-allowance" });
    assert.equal(overAllowance.overageUnits.high, 501);
    assert.equal(overAllowance.overageUnits.low, 1);
  }
});

test("floating-point noise at a boundary is absorbed by rounding", () => {
  // 0.1 + 0.1 + 0.1 !== 0.3 in IEEE 754; 5000 requests at that per-request
  // cost lands 2e-13 past 1500 without rounding.
  const noisyCost = 0.1 + 0.1 + 0.1;
  assert.notEqual(noisyCost * 5000, 1500);
  const result = projectScenario(
    input({ scenario: { requestsLow: 5000, requestsHigh: 5000 }, row: row({ cost: noisyCost }) }),
  );
  assert.equal(result.status, "projected");
  if (result.status !== "projected") return;
  assert.equal(result.usage.high, 1500);
  assert.deepEqual(result.boundary, { low: "within-flex", high: "within-flex" });
  assert.equal(result.overageUnits.high, 500);
});

test("Business and Enterprise have no flex, so the allowance range collapses and is pooled", () => {
  for (const [planId, base] of [
    ["copilot-business", 1900],
    ["copilot-enterprise", 3900],
  ] as const) {
    const result = projectScenario(
      input({ scenario: { planId, requestsLow: 10, requestsHigh: 10 }, row: row({ cost: 1 }) }),
    );
    assert.equal(result.status, "projected");
    if (result.status !== "projected") continue;
    assert.equal(result.allowance.low, base);
    assert.equal(result.allowance.high, base);
    assert.equal(result.allowance.flexVariable, false);
    assert.ok(result.notes.some((n) => /pooled/.test(n)));
  }
});

test("legacy plans follow options.plan for the allowance, cost $0.04/request over, and never total", () => {
  const pro = projectScenario(
    input({
      scenario: { planId: "copilot-legacy-annual", requestsLow: 301, requestsHigh: 301 },
      options: { billing: "legacy", plan: "pro" },
      row: row({ cost: 1 }),
    }),
  );
  assert.equal(pro.status, "projected");
  if (pro.status === "projected") {
    assert.equal(pro.allowance.low, 300);
    assert.equal(pro.overageUnits.high, 1);
    assert.equal(pro.overageUsd?.high, 0.04);
    assert.equal(pro.totalUsd, null);
    assert.equal(pro.feeUsd.value, null);
    assert.ok(pro.notes.some((n) => /annual plan fee is not documented/.test(n)));
    assert.ok(pro.notes.some((n) => /ends when the annual plan ends/.test(n)));
  }
  const proPlus = projectScenario(
    input({
      scenario: { planId: "copilot-legacy-annual", requestsLow: 1500, requestsHigh: 1500 },
      options: { billing: "legacy", plan: "proPlus" },
      row: row({ cost: 1 }),
    }),
  );
  if (proPlus.status === "projected") {
    assert.equal(proPlus.allowance.low, 1500);
    assert.equal(proPlus.overageUnits.high, 0);
  }
});

test("plans with no verified data stay unavailable, with a reason", () => {
  for (const planId of ["copilot-free", "copilot-student", "opencode-go"]) {
    const result = projectScenario(input({ scenario: { planId } }));
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.ok(result.reason.length > 0);
  }
});

test("an unknown saved plan id is kept and shown unavailable, never substituted", () => {
  const result = projectScenario(input({ scenario: { planId: "copilot-pro-x" } }));
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") {
    assert.equal(result.planId, "copilot-pro-x");
    assert.match(result.reason, new RegExp(planRegistryDate));
  }
});

test("an incomplete custom plan stays unavailable until every field is entered", () => {
  const missingFee = projectScenario(
    input({
      scenario: {
        planId: "custom",
        custom: { monthlyFeeUsd: null, allowance: 100, overageUsdPerUnit: 0.01 },
      },
    }),
  );
  assert.equal(missingFee.status, "unavailable");
  const complete = projectScenario(
    input({
      scenario: {
        planId: "custom",
        requestsLow: 50,
        requestsHigh: 50,
        custom: { monthlyFeeUsd: 5, allowance: 100, overageUsdPerUnit: 0.02 },
      },
      row: row({ cost: 1 }),
    }),
  );
  assert.equal(complete.status, "projected");
  if (complete.status === "projected") {
    assert.equal(complete.allowance.low, 100);
    assert.equal(complete.allowance.high, 100);
    assert.equal(complete.feeUsd.value, 5);
    assert.deepEqual(complete.feeUsd.provenance, { kind: "user" });
    assert.deepEqual(complete.allowance.provenance, { kind: "user" });
    assert.ok(complete.notes.some((n) => /not verified/.test(n)));
  }
});

test("a null or missing row leaves the scenario unavailable; missing data is never treated as 0", () => {
  const noRow = projectScenario(input({ row: undefined }));
  assert.equal(noRow.status, "unavailable");
  if (noRow.status === "unavailable") assert.match(noRow.reason, /no priced model/i);
  const unpriced = projectScenario(
    input({ row: row({ cost: null, reasons: ["No verified pricing mapping."] }) }),
  );
  assert.equal(unpriced.status, "unavailable");
  if (unpriced.status === "unavailable")
    assert.match(unpriced.reason, /No verified pricing mapping/);
});

test("low above high stays unavailable rather than silently swapped", () => {
  const result = projectScenario(input({ scenario: { requestsLow: 10, requestsHigh: 5 } }));
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") assert.match(result.reason, /exceeds/);
});

test("a plan only projects for its own source and billing unit; nothing is converted", () => {
  const wrongBilling = projectScenario(
    input({ scenario: { planId: "copilot-pro" }, options: { billing: "legacy" } }),
  );
  assert.equal(wrongBilling.status, "unavailable");
  if (wrongBilling.status === "unavailable")
    assert.match(wrongBilling.reason, /AI credits/);
  const wrongSource = projectScenario(
    input({ scenario: { planId: "copilot-pro" }, options: { source: "opencode", billing: "usd" } }),
  );
  assert.equal(wrongSource.status, "unavailable");
  if (wrongSource.status === "unavailable")
    assert.match(wrongSource.reason, /GitHub Copilot only/);
});

test("plansFor generates an unavailable entry for a source with no plan registry data", () => {
  const choices = plansFor("codex", "usd");
  assert.equal(choices.length, 2); // generated source entry + custom
  assert.equal(choices[0].available, false);
  assert.match(choices[0].reason ?? "", /No verified billing rules/);
  const custom = choices.find((c) => c.id === "custom")!;
  assert.equal(custom.available, false);
  assert.match(custom.reason ?? "", /USD billing/);
});

test("plansFor marks a mismatched billing mode unavailable without hiding the plan", () => {
  const choices = plansFor("copilot", "usd");
  const pro = choices.find((c) => c.id === "copilot-pro")!;
  assert.equal(pro.available, false);
  assert.match(pro.reason ?? "", /AI credits/);
});

test("an injected registry with different rates changes the result and reports its own date", () => {
  const injected: PlanEntry[] = planRegistry.map((e) =>
    e.id === "copilot-pro"
      ? { ...e, baseAllowance: 2000, flexAllowance: 0, overageUsdPerUnit: 0.02, monthlyFeeUsd: 20 }
      : e,
  );
  const result = projectScenario(
    input({
      scenario: { requestsLow: 2500, requestsHigh: 2500 },
      row: row({ cost: 1 }),
      registry: injected,
      registryDate: "2027-01-01",
    }),
  );
  assert.equal(result.status, "projected");
  if (result.status !== "projected") return;
  assert.equal(result.allowance.low, 2000);
  assert.equal(result.allowance.high, 2000);
  assert.equal(result.overageUnits.high, 500);
  assert.equal(result.overageUsd?.high, 10);
  assert.equal(result.feeUsd.value, 20);
  assert.equal(result.plan.registryDate, "2027-01-01");
  assert.deepEqual((result.allowance.provenance as { date: string }).date, "2027-01-01");
});

test("no double counting: the fee is added once and never scales with requests", () => {
  const low = projectScenario(
    input({ scenario: { requestsLow: 1, requestsHigh: 1 }, row: row({ cost: 1 }) }),
  );
  const high = projectScenario(
    input({ scenario: { requestsLow: 900, requestsHigh: 900 }, row: row({ cost: 1 }) }),
  );
  assert.equal(low.status, "projected");
  assert.equal(high.status, "projected");
  if (low.status === "projected" && high.status === "projected") {
    assert.equal(low.feeUsd.value, 10);
    assert.equal(high.feeUsd.value, 10);
    assert.equal(low.totalUsd?.low, 10);
    assert.equal(high.totalUsd?.low, 10);
  }
});

test("scenarioDelta requires two comparable projections and never bounds the difference", () => {
  const a = projectScenario(
    input({ scenario: { requestsLow: 100, requestsHigh: 100 }, row: row({ cost: 1 }) }),
  );
  const b = projectScenario(
    input({ scenario: { requestsLow: 200, requestsHigh: 200 }, row: row({ cost: 1 }) }),
  );
  const delta = scenarioDelta(a, b);
  assert.equal(delta.low, 0);
  assert.equal(delta.high, 0);
  assert.match(delta.reason, /not a bound/);

  const off = scenarioDelta({ status: "off" }, b);
  assert.equal(off.low, null);
  assert.match(off.reason, /off or unavailable/);

  const legacyA = projectScenario(
    input({
      scenario: { planId: "copilot-legacy-annual", requestsLow: 1, requestsHigh: 1 },
      options: { billing: "legacy" },
      row: row({ cost: 1 }),
    }),
  );
  const legacyDelta = scenarioDelta(legacyA, legacyA);
  assert.equal(legacyDelta.low, null);
  assert.match(legacyDelta.reason, /not documented/);

  const unitMismatch = scenarioDelta(
    a,
    projectScenario(
      input({
        scenario: { planId: "copilot-legacy-annual", requestsLow: 1, requestsHigh: 1 },
        options: { billing: "legacy" },
        row: row({ cost: 1 }),
      }),
    ),
  );
  assert.equal(unitMismatch.low, null);
  assert.match(unitMismatch.reason, /Different scenario units/);
});

test("provenance kinds match each field's actual origin", () => {
  const result = projectScenario(
    input({
      scenario: { requestsLow: 10, requestsHigh: 20 },
      options: { display: { ...defaults.display, chart: "workload" } },
      row: row({ cost: 1 }),
    }),
  );
  assert.equal(result.status, "projected");
  if (result.status !== "projected") return;
  assert.equal(result.requests.provenance.kind, "user");
  assert.equal(result.perRequest.provenance.kind, "estimate");
  assert.equal((result.perRequest.provenance as { basis: string }).basis, "workload");
  assert.equal(result.allowance.provenance.kind, "provider");
});

test("the origin note explains when no model is selected", () => {
  const result = projectScenario(
    input({ scenario: { requestsLow: 1, requestsHigh: 1 }, row: row({ cost: 1 }), rowOrigin: "recommended" }),
  );
  assert.equal(result.status, "projected");
  if (result.status === "projected")
    assert.ok(result.notes.some((n) => /recommended model/.test(n)));
});

test("history-derived requests are labelled and explain the all-models assumption", () => {
  const result = projectScenario(
    input({
      scenario: {
        requestsLow: 30,
        requestsHigh: 60,
        origin: "history",
        history: { from: "2026-09-01", to: "2026-09-02", activeDays: 2, calendarDays: 2, requests: 3 },
      },
      row: row({ cost: 1 }),
    }),
  );
  assert.equal(result.status, "projected");
  if (result.status !== "projected") return;
  assert.equal(result.requests.provenance.kind, "history");
  assert.ok(result.notes.some((n) => /all Copilot models/.test(n)));
});

test("no output describes a projection as a bill", () => {
  const result = projectScenario(
    input({ scenario: { requestsLow: 1, requestsHigh: 1 }, row: row({ cost: 1 }) }),
  );
  assert.equal(result.status, "projected");
  if (result.status !== "projected") return;
  const text = [result.disclaimer, ...result.notes].join(" ");
  assert.match(text, /not a bill/);
  assert.doesNotMatch(text.replace(/not a bill/g, ""), /\bbill\b/);
  assert.equal(scenarioDisclaimer, result.disclaimer);
});

test("historyScenarioPrefill handles no summary, no dated days, a single day, and gaps", () => {
  assert.equal(historyScenarioPrefill(null), null);
  assert.equal(historyScenarioPrefill({ days: [], requestCount: 5 }), null);
  const single: Pick<UsageSummary, "days" | "requestCount"> = {
    days: [{ date: "2026-09-05", requests: 10, promptTokens: 0, outputTokens: 0, premiumEstimate: 0 }],
    requestCount: 12,
  };
  const single1 = historyScenarioPrefill(single);
  assert.ok(single1);
  assert.equal(single1!.low, single1!.high);
  assert.equal(single1!.activeDays, 1);
  assert.equal(single1!.calendarDays, 1);
  assert.equal(single1!.undated, 2);

  const gapped: Pick<UsageSummary, "days" | "requestCount"> = {
    days: [
      { date: "2026-09-01", requests: 10, promptTokens: 0, outputTokens: 0, premiumEstimate: 0 },
      { date: "2026-09-10", requests: 10, promptTokens: 0, outputTokens: 0, premiumEstimate: 0 },
    ],
    requestCount: 20,
  };
  const gap = historyScenarioPrefill(gapped);
  assert.ok(gap);
  assert.equal(gap!.activeDays, 2);
  assert.equal(gap!.calendarDays, 10);
  assert.ok(gap!.low < gap!.high);
  assert.equal(gap!.undated, 0);
});

test("parseScenario defaults, falls back per field, and keeps stable key order", () => {
  assert.deepEqual(parseScenario(undefined), defaults.scenario);
  assert.deepEqual(parseScenario(null), defaults.scenario);
  assert.deepEqual(parseScenario("nope"), defaults.scenario);
  const partial = parseScenario({ planId: "copilot-pro", requestsLow: "bad", requestsHigh: 5 });
  assert.equal(partial.planId, "copilot-pro");
  assert.equal(partial.requestsLow, 0);
  assert.equal(partial.requestsHigh, 5);
  assert.deepEqual(Object.keys(parseScenario({})), Object.keys(defaults.scenario));
  // A malformed history is dropped, not partially trusted.
  const badHistory = parseScenario({
    planId: "copilot-pro",
    origin: "history",
    history: { from: "not-a-date", to: "2026-09-02", activeDays: 1, calendarDays: 1, requests: 1 },
  });
  assert.equal(badHistory.origin, "user");
  assert.equal(badHistory.history, null);
  // An invalid planId format falls back to "none" rather than being kept unsafe.
  assert.equal(parseScenario({ planId: "../etc" }).planId, "none");
});
