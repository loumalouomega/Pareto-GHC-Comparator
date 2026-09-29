import { test } from "vitest";
import assert from "node:assert/strict";
import { defaults, type Row } from "../src/types";
import { markFrontier } from "../src/compare";
import { recommend } from "../src/recommend";
import { budgetLadder, rawCapability } from "../src/value";

const row = (
  id: string,
  cost: number | null,
  score: number | null,
  name = id,
): Row => ({
  id,
  modelId: id,
  baseModelId: id,
  name,
  cost,
  score,
  provider: "Test",
  frontier: false,
  dominatedBy: [],
  reasons: [],
  mappingStatus: "exact",
  candidateIds: [],
});

const rows = markFrontier([
  row("cheap", 1, 30),
  row("mid", 2, 50),
  row("dominated", 3, 45),
  row("top", 5, 70),
  row("unpriced", null, 90),
  row("unscored", 1, null),
]);

test("budget ladder walks the frontier with a runner-up that also fits", () => {
  const tiers = budgetLadder(rows);
  assert.deepEqual(
    tiers.map((t) => [t.pick.id, t.from, t.to, t.runnerUp?.id ?? null]),
    [
      ["cheap", 1, 2, null],
      ["mid", 2, 5, "cheap"],
      ["top", 5, null, "mid"],
    ],
  );
});

test("budget ladder never includes unpriced or unscored rows", () => {
  const ids = budgetLadder(rows).flatMap((t) => [
    t.pick.id,
    ...(t.runnerUp ? [t.runnerUp.id] : []),
  ]);
  assert.ok(!ids.includes("unpriced"));
  assert.ok(!ids.includes("unscored"));
  assert.deepEqual(budgetLadder([row("x", null, 10)]), []);
  assert.deepEqual(budgetLadder([]), []);
});

test("budget ladder retains exact ties and does not offer a tie as the runner-up", () => {
  const tiers = budgetLadder(
    markFrontier([row("b", 2, 50, "B"), row("a", 2, 50, "A"), row("c", 1, 10)]),
  );
  assert.equal(tiers.length, 2);
  assert.equal(tiers[1].pick.id, "a");
  assert.deepEqual(tiers[1].tied.map((t) => t.id), ["b"]);
  assert.equal(tiers[1].runnerUp?.id, "c");
});

test("budget ladder picks match the budget recommendation at each band's lower bound", () => {
  for (const tier of budgetLadder(rows)) {
    const result = recommend(rows, {
      ...defaults,
      recommendation: {
        ...defaults.recommendation,
        mode: "budget",
        budgets: { credits: tier.from, legacy: tier.from, usd: tier.from },
      },
    });
    assert.ok(result.modelIds.includes(tier.pick.id), tier.pick.id);
  }
});

test("raw capability ranks by score with deterministic tiebreaks, ignoring cost", () => {
  const ranking = rawCapability(
    markFrontier([
      row("b", 2, 50, "B"),
      row("a", 3, 50, "A"),
      row("c", null, 50, "C"),
      row("top", 9, 90),
      row("none", 1, null),
    ]),
  );
  assert.deepEqual(
    ranking.entries.map((e) => e.id),
    ["top", "b", "a", "c"],
  );
  assert.equal(ranking.total, 4);
  assert.equal(ranking.entries[3].cost, null);
  assert.equal(ranking.entries.find((e) => e.id === "top")?.frontier, true);
});

test("raw capability limit caps entries but reports the full count", () => {
  const ranking = rawCapability(rows, 2);
  assert.equal(ranking.entries.length, 2);
  assert.equal(ranking.total, 5);
  assert.equal(ranking.entries[0].id, "unpriced");
  assert.deepEqual(rawCapability([]).entries, []);
});
