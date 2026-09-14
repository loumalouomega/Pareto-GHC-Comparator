import { test } from "vitest";
import assert from "node:assert/strict";
import { compare } from "../src/compare";
import { exportCsv, exportSnapshot } from "../src/export";
import { aggregateUsage, suggestBudget } from "../src/usage";
import { defaults, type Benchmark, type UsageRequest } from "../src/types";

test("uncatalogued OpenCode name matches stay inferred in exports and manual choices stay explicit", () => {
  const model = { id: "opencode:example/new-model", name: "New Model", family: "new-model",
    maxInputTokens: 10000, source: "opencode" as const };
  const benchmark: Benchmark = { id: "new", slug: "new-model", name: "New Model", provider: "Example",
    scores: { general: 42, coding: 42, agentic: 42 } };
  const options = { ...defaults, source: "opencode" as const, billing: "usd" as const };
  const rows = compare([model], [benchmark], options);
  assert.equal(rows[0].mappingStatus, "inferred");
  assert.equal(rows[0].cost, null);
  assert.match(rows[0].reasons.join(" "), /display name/);
  assert.match(exportCsv(rows, options), /inferred/);
  const snapshot = JSON.parse(exportSnapshot(rows, options, new Set(), {
    source: "opencode", billing: "usd", preset: options.preset, catalogDate: "2026-09-10", staticRegistryDate: "2026-09-10",
  }));
  assert.equal(snapshot.rows[0].mappingStatus, "inferred");
  assert.equal(compare([model], [benchmark], options, { [model.id]: "new" })[0].mappingStatus, "user");
  assert.equal(compare([model], [benchmark], options, { [model.id]: "gone" })[0].mappingStatus, "missing");
  assert.equal(compare([model], [benchmark], options, {}, [], { pins: { [model.id]: ["new"] } })[0].mappingStatus, "user");
  // A matching name does not create a catalog/pricing entry for unknown Copilot IDs.
  assert.equal(compare([{ ...model, source: "copilot", id: "new-model" }], [benchmark], defaults)[0].mappingStatus, "missing");
});

test("usage completeness and fallback counts survive JSON without turning missing tokens into observed zero", () => {
  const base: UsageRequest = { sessionId: "session", workspaceId: "workspace", requestIndex: 0,
    modelId: "copilot/mystery", timestampMs: Date.parse("2026-09-14"), promptTokens: 0, outputTokens: 0,
    promptProvenance: "observed", outputProvenance: "observed", tokensEstimated: false, toolCallRounds: 0 };
  const requests: UsageRequest[] = [base,
    { ...base, requestIndex: 1, promptProvenance: "missing", outputProvenance: "missing" },
    { ...base, requestIndex: 2, promptTokens: 10 },
    { ...base, requestIndex: 3, modelId: null, outputTokens: 10 },
    { ...base, requestIndex: 4, promptProvenance: "estimated", promptTokens: 10, tokensEstimated: true },
  ];
  const summary = aggregateUsage([{ workspaceId: "workspace", workspacePath: "/example", requests }]);
  assert.deepEqual(summary.completeness, { observedPairs: 3, observedZeroPairs: 1, missingPairs: 1, estimatedPairs: 1, fallbackMultipliers: 3 });
  assert.deepEqual(summary.days[0].completeness, summary.completeness);
  assert.deepEqual(summary.workspaces[0].completeness, summary.completeness);
  assert.equal(summary.models.find(m => m.modelId === "unknown")?.completeness?.fallbackMultipliers, 1);
  assert.ok(summary.unknownModels.includes("unknown (missing model id)"));
  assert.match(suggestBudget(summary, "legacy")!.note, /Unknown model — default multiplier applied/);
  const stored = JSON.parse(JSON.stringify({ requests, summary }));
  assert.equal(stored.requests[1].promptProvenance, "missing");
  assert.equal(stored.summary.completeness.observedZeroPairs, 1);
  assert.equal(stored.summary.medianSample, 3);
  const partial = aggregateUsage([{ workspaceId: "workspace", workspacePath: "/example",
    requests: [{ ...base, promptProvenance: "estimated", outputProvenance: "missing", tokensEstimated: true }],
    diagnostics: { malformed: 0, unsupported: 0, unreadable: 0, stale: 1, missingTokens: 99, estimatedTokens: 99 },
  }]);
  assert.deepEqual(partial.completeness, { observedPairs: 0, observedZeroPairs: 0, missingPairs: 1, estimatedPairs: 1, fallbackMultipliers: 0 });
});
