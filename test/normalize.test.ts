import { test } from "vitest";
import assert from "node:assert/strict";
import {
  allowanceTreatment,
  conversionDate,
  conversionSources,
  costUnit,
  normalizeCost,
  normalizeReasons,
  usdPerAiCredit,
} from "../src/normalize";
import { estimate } from "../src/compare";
import { planRegistry, planRegistryDate, projectScenario } from "../src/plans";
import { defaults, type CatalogEntry, type Options } from "../src/types";

const opts = (overrides: Partial<Options> = {}): Options => ({
  ...structuredClone(defaults),
  ...overrides,
});

test("converts AI credits to USD at the documented pay-as-you-go rate", () => {
  const n = normalizeCost(4.5, "credits", "task");
  assert.equal(n.status, "converted");
  if (n.status !== "converted") return;
  assert.equal(n.original.value, 4.5);
  assert.equal(n.original.unit, "AI credits");
  assert.equal(n.usd, 0.045);
  assert.equal(n.rate.usdPerUnit, usdPerAiCredit);
  assert.equal(n.provenance.date, conversionDate);
  assert.equal(conversionDate, planRegistryDate);
  assert.deepEqual(n.provenance.sources, [...conversionSources]);
  assert.equal(n.allowanceTreatment, allowanceTreatment);
  assert.equal(n.basis, "task");
});

test("USD billing passes through unchanged as native", () => {
  const n = normalizeCost(1.23, "usd", "workload");
  assert.equal(n.status, "native");
  if (n.status !== "native") return;
  assert.equal(n.original.value, 1.23);
  assert.equal(n.original.unit, "USD");
  assert.equal(n.usd, 1.23);
  assert.equal(n.basis, "workload");
});

test("credits and USD formulas agree on the same catalog rates, after conversion", () => {
  const entry: CatalogEntry = {
    ids: ["m"],
    name: "Model",
    provider: "P",
    benchmarkFamilies: ["m"],
    rates: { input: 3, read: 0.5, write: null, output: 15 },
  };
  const credits = estimate(entry, opts({ billing: "credits" })).cost!;
  const usd = estimate(entry, opts({ billing: "usd" })).cost!;
  const converted = normalizeCost(credits, "credits", "task");
  assert.equal(converted.status, "converted");
  if (converted.status === "converted")
    assert.equal(converted.usd, Math.round(usd * 1e10) / 1e10);
});

test("zero cost is a valid free-tier value, not unavailable", () => {
  const credits = normalizeCost(0, "credits", "task");
  assert.equal(credits.status, "converted");
  if (credits.status === "converted") assert.equal(credits.usd, 0);
  const usd = normalizeCost(0, "usd", "task");
  assert.equal(usd.status, "native");
  if (usd.status === "native") assert.equal(usd.usd, 0);
});

test("rounds away float noise without collapsing small non-zero task costs", () => {
  const n = normalizeCost(0.07, "credits", "task");
  assert.equal(n.status, "converted");
  if (n.status === "converted") assert.equal(n.usd, 0.0007);
  const tiny = normalizeCost(4e-5, "credits", "task");
  assert.equal(tiny.status, "converted");
  if (tiny.status === "converted") {
    assert.equal(tiny.original.value, 4e-5);
    assert.ok(tiny.usd > 0);
  }
});

test("invalid costs are unavailable, distinct from legacy", () => {
  for (const cost of [null, undefined, NaN, Infinity, -1]) {
    const n = normalizeCost(cost, "credits", "task");
    assert.equal(n.status, "unavailable");
    if (n.status === "unavailable") {
      assert.equal(n.reason, normalizeReasons.cost);
      assert.equal(n.original.value, null);
      assert.equal(n.original.unit, "AI credits");
    }
  }
});

test("legacy premium requests are never converted, even at cost 0", () => {
  for (const cost of [0, 5, null]) {
    const n = normalizeCost(cost, "legacy", "task");
    assert.equal(n.status, "unavailable");
    if (n.status === "unavailable") {
      assert.equal(n.reason, normalizeReasons.legacy);
      assert.equal(n.original.unit, "premium requests");
      assert.equal(n.original.value, cost === null ? null : cost);
    }
  }
});

test("costUnit matches the billing mode's displayed unit", () => {
  assert.equal(costUnit("credits"), "AI credits");
  assert.equal(costUnit("legacy"), "premium requests");
  assert.equal(costUnit("usd"), "USD");
});

test("the conversion rate matches every AI-credit plan's documented overage rate", () => {
  for (const e of planRegistry)
    if (e.unit === "ai-credits" && e.availability.status === "available")
      assert.equal(e.overageUsdPerUnit, usdPerAiCredit);
});

test("the USD conversion ignores allowance, unlike the monthly spending scenario", () => {
  const custom = {
    planId: "custom",
    requestsLow: 100,
    requestsHigh: 100,
    origin: "user" as const,
    history: null,
    custom: { monthlyFeeUsd: 0, allowance: 0, overageUsdPerUnit: 0.01 },
  };
  const row = {
    id: "m",
    modelId: "m",
    baseModelId: "m",
    name: "Model",
    provider: "P",
    score: 80,
    cost: 3,
    frontier: false,
    reasons: [],
    mappingStatus: "exact" as const,
    candidateIds: [],
    dominatedBy: [],
  };
  const converted = normalizeCost(row.cost, "credits", "task");
  assert.equal(converted.status, "converted");
  const zeroAllowance = projectScenario({
    scenario: custom,
    options: { source: "copilot", billing: "credits", plan: "pro", display: defaults.display },
    row,
    rowOrigin: "selected",
    catalogDate: "2026-01-01",
  });
  assert.equal(zeroAllowance.status, "projected");
  if (zeroAllowance.status === "projected" && converted.status === "converted")
    assert.equal(zeroAllowance.totalUsd!.low, Math.round(100 * converted.usd * 1e6) / 1e6);

  const withinAllowance = projectScenario({
    scenario: { ...custom, custom: { ...custom.custom, allowance: 1000 } },
    options: { source: "copilot", billing: "credits", plan: "pro", display: defaults.display },
    row,
    rowOrigin: "selected",
    catalogDate: "2026-01-01",
  });
  assert.equal(withinAllowance.status, "projected");
  if (withinAllowance.status === "projected") {
    assert.equal(withinAllowance.boundary.low, "within-base");
    assert.equal(withinAllowance.totalUsd!.low, 0);
  }
  // The conversion itself is unchanged by allowance: same non-zero USD figure
  // whether or not the scenario's allowance absorbs the cost.
  if (converted.status === "converted") assert.ok(converted.usd > 0);
});
