import { test } from "vitest";
import assert from "node:assert/strict";
import {
  exportPairSnapshot,
  exportSnapshot,
  snapshotSchemaVersion,
  type PairMeta,
  type PairSideInput,
  type SnapshotMeta,
} from "../src/export";
import { taskMix } from "../src/compare";
import {
  allowedWhileImported,
  importedDisplay,
  importedFileName,
  importedViewState,
  parseImportedSnapshot,
  type ImportedComparison,
  type ImportedContext,
  type ImportedSingle,
  type ImportedView,
} from "../src/snapshotImport";
import { projectScenario } from "../src/plans";
import { costUnit, defaults, type Options, type Row } from "../src/types";

const row = (over: Partial<Row> = {}): Row => ({
  id: "m1",
  modelId: "m1",
  baseModelId: "m1",
  name: "Model One",
  provider: "Test",
  score: 80,
  cost: 1.5,
  frontier: true,
  dominatedBy: [],
  reasons: ["priced"],
  mappingStatus: "exact",
  candidateIds: [],
  pricing: { status: "priced", source: "copilot-catalog" },
  ...over,
});

const context = (over: Partial<ImportedContext> = {}): ImportedContext => ({
  options: defaults,
  hasKey: true,
  watchlistAlerts: false,
  fileName: "snap.json",
  ...over,
});

const meta = (over: Partial<SnapshotMeta> = {}): SnapshotMeta => ({
  source: "copilot",
  preset: "coding",
  billing: "credits",
  catalogDate: "2026-09-10",
  staticRegistryDate: "2026-09-11",
  planRegistryDate: "2026-09-14",
  version: "4.3",
  fetchedAt: 77,
  scenario: { status: "off" },
  ...over,
});

const parseOk = (text: string) => {
  const parsed = parseImportedSnapshot(text);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.failure.message);
  return parsed.snapshot;
};
const parseFail = (text: string) => {
  const parsed = parseImportedSnapshot(text);
  assert.equal(parsed.ok, false);
  if (parsed.ok) throw new Error("unreachable");
  return parsed.failure;
};

const view = (
  snapshot: ImportedSingle | ImportedComparison,
  over: Partial<ImportedView> = {},
): ImportedView => ({
  snapshot,
  selected: {},
  filter: "",
  display: defaults.display,
  ...over,
});

test("an exported single snapshot round-trips into the same rows and basis", () => {
  const rows = [
    row({
      id: "a1",
      modelId: "a1",
      baseModelId: "a1",
      benchmark: {
        id: "b1",
        slug: "model-one",
        name: "Bench One",
        provider: "Test",
        scores: { general: 70, coding: 80, agentic: 60 },
      },
    }),
    row({
      id: "a2",
      modelId: "a2",
      baseModelId: "a2",
      name: "Model Two",
      provider: "Other",
      score: 40,
      cost: null,
      frontier: false,
      mappingStatus: "missing",
      reasons: ["No catalog entry."],
      pricing: { status: "unresolved", source: "none", issue: "no-catalog-entry" },
    }),
  ];
  const text = exportSnapshot(rows, defaults, new Set(["a1"]), meta());
  const snapshot = parseOk(text) as ImportedSingle;
  assert.equal(snapshot.kind, "single");
  assert.equal(snapshot.source, "copilot");
  assert.equal(snapshot.catalogDate, "2026-09-10");
  assert.equal(snapshot.staticRegistryDate, "2026-09-11");
  assert.equal(snapshot.planRegistryDate, "2026-09-14");
  assert.equal(snapshot.benchmarkVersion, "4.3");
  assert.equal(snapshot.benchmarkFetchedAt, 77);
  assert.ok(snapshot.disclaimer.includes("Illustrative"));
  assert.equal(snapshot.costBasis.basis, "task");
  assert.equal(snapshot.costBasis.unit, "AI credits");
  assert.deepEqual(snapshot.costBasis.effectiveTokens, taskMix);
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[0].score, 80);
  assert.equal(snapshot.rows[0].cost, 1.5);
  assert.equal(snapshot.rows[0].frontier, true);
  // The projection records id and name only; the rest is rebuilt, never
  // invented from a live benchmark list.
  assert.equal(snapshot.rows[0].benchmark?.id, "b1");
  assert.equal(snapshot.rows[0].benchmark?.name, "Bench One");
  assert.equal(snapshot.rows[0].benchmark?.slug, "b1");
  assert.equal(snapshot.rows[0].benchmark?.scores.coding, null);
  assert.equal(snapshot.rows[0].baseModelId, "a1");
  assert.deepEqual(snapshot.rows[0].dominatedBy, []);
  assert.deepEqual(snapshot.rows[0].candidateIds, []);
  assert.equal(snapshot.rows[0].breakdown, undefined);
  assert.equal(snapshot.rows[0].invocable, undefined);
  assert.equal(snapshot.rows[0].pricing?.status, "priced");
  assert.equal(snapshot.rows[0].pricing?.source, "copilot-catalog");
  assert.equal(snapshot.rows[1].cost, null);
  assert.equal(snapshot.rows[1].pricing?.issue, "no-catalog-entry");
  // Recommendations come from the exported flags, not a recomputation.
  assert.deepEqual(snapshot.recommended, ["a1"]);
  assert.equal(snapshot.options.preset, "coding");
  assert.equal(snapshot.options.billing, "credits");
  assert.equal(snapshot.options.display.chart, "task");
});

test("BYOK and registry provenance survive the round trip", () => {
  const rows = [
    row({
      id: "b1",
      pricing: {
        status: "byok",
        source: "byok",
        byok: {
          provenance: {
            kind: "registry",
            registry: "codex",
            registryId: "gpt-5-6-luna",
            registryDate: "2026-09-02",
          },
        },
      },
    }),
    row({
      id: "b2",
      pricing: {
        status: "byok",
        source: "byok",
        byok: { provenance: { kind: "manual" } },
      },
    }),
  ];
  const snapshot = parseOk(
    exportSnapshot(rows, defaults, new Set(), meta()),
  ) as ImportedSingle;
  assert.equal(
    snapshot.rows[0].pricing?.byok?.provenance.kind,
    "registry",
  );
  assert.equal(
    snapshot.rows[0].pricing?.byok?.provenance.kind === "registry" &&
      snapshot.rows[0].pricing?.byok?.provenance.registry,
    "codex",
  );
  assert.equal(snapshot.rows[1].pricing?.byok?.provenance.kind, "manual");
});

test("a workload-basis snapshot locks the chart to its own token mix", () => {
  const options: Options = {
    ...defaults,
    source: "codex",
    billing: "usd",
    tokens: { input: 900, read: 100, write: 0, output: 300 },
    display: { ...defaults.display, chart: "workload" },
  };
  const snapshot = parseOk(
    exportSnapshot(
      [row({ pricing: { status: "priced", source: "static-registry" } })],
      options,
      new Set(),
      meta({ source: "codex", billing: "usd" }),
    ),
  ) as ImportedSingle;
  assert.equal(snapshot.costBasis.basis, "workload");
  assert.equal(snapshot.costBasis.unit, "USD");
  assert.deepEqual(snapshot.options.tokens, {
    input: 900,
    read: 100,
    write: 0,
    output: 300,
  });
  assert.equal(snapshot.options.display.chart, "workload");
});

test("a legacy snapshot keeps premium-request units and no token mix", () => {
  const options: Options = {
    ...defaults,
    billing: "legacy",
    plan: "proPlus",
    display: { ...defaults.display, chart: "workload" },
  };
  const snapshot = parseOk(
    exportSnapshot(
      [row({ pricing: { status: "priced", source: "legacy-multiplier" } })],
      options,
      new Set(),
      meta({ billing: "legacy" }),
    ),
  ) as ImportedSingle;
  assert.equal(snapshot.costBasis.basis, "legacy");
  assert.equal(snapshot.costBasis.unit, "premium requests");
  assert.equal(snapshot.costBasis.effectiveTokens, null);
  assert.equal(snapshot.costBasis.legacyPlan, "proPlus");
  // Legacy pricing is per interaction, so the chart never claims a workload.
  assert.equal(snapshot.options.display.chart, "task");
  assert.equal(snapshot.options.plan, "proPlus");
});

test("the imported view is read-only state with the file's own dates", () => {
  const snapshot = parseOk(
    exportSnapshot([row()], defaults, new Set(["m1"]), meta()),
  ) as ImportedSingle;
  const state = importedViewState(view(snapshot), context());
  assert.equal(state.rows.length, 1);
  assert.equal(state.recommendation.modelIds[0], "m1");
  assert.ok(state.recommendation.explanation.includes("Not recomputed"));
  assert.equal(state.version, "4.3");
  assert.equal(state.fetchedAt, 77);
  assert.equal(state.catalogDate, "2026-09-10");
  assert.equal(state.planRegistryDate, "2026-09-14");
  // Live-only surfaces stay empty so nothing historical can be edited.
  assert.deepEqual(state.models, []);
  assert.deepEqual(state.checklist, []);
  assert.deepEqual(state.groups, []);
  assert.deepEqual(state.freeBar, []);
  assert.equal(state.usage, null);
  assert.equal(state.budgetSuggestion, null);
  assert.equal(state.comparison, undefined);
  assert.equal(state.freeSpotlight.enabled, false);
  assert.equal(state.imported?.kind, "single");
  assert.equal(state.imported?.fileName, "snap.json");
  assert.equal(state.imported?.schemaVersion, snapshotSchemaVersion);
  assert.equal(state.imported?.costBasis.unit, "AI credits");
  assert.equal(state.imported?.costBasis.basis, "task");
  // The display toggles come from the host; the basis never does.
  assert.equal(state.options.display.chart, "task");
  assert.equal(state.options.filter, "");
});

test("an imported view filters with the same rule compare() uses", () => {
  const rows = [
    row({ id: "a1", name: "Alpha" }),
    row({ id: "a2", name: "Beta", frontier: false }),
  ];
  const snapshot = parseOk(
    exportSnapshot(rows, defaults, new Set(["a1"]), meta()),
  ) as ImportedSingle;
  const filtered = importedViewState(
    view(snapshot, { filter: "bet" }),
    context(),
  );
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].id, "a2");
  assert.equal(filtered.selected, "a2");
  const sorted = importedViewState(
    view(snapshot, { display: { ...defaults.display, sort: "efficiency" } }),
    context(),
  );
  assert.deepEqual(
    sorted.rows.map((r) => r.id),
    ["a1", "a2"],
  );
});

test("an imported selection survives while its row is displayed", () => {
  const rows = [
    row({ id: "a1", name: "Alpha" }),
    row({ id: "a2", name: "Beta", frontier: false }),
  ];
  const snapshot = parseOk(
    exportSnapshot(rows, defaults, new Set(["a1"]), meta()),
  ) as ImportedSingle;
  // A selection the filter removes falls back to the exported recommendation
  // rather than pointing at a row that is no longer on screen.
  const state = importedViewState(
    view(snapshot, { filter: "bet", selected: { A: "a1" } }),
    context(),
  );
  assert.equal(state.selected, "a2");
  const kept = importedViewState(
    view(snapshot, { selected: { A: "a2" } }),
    context(),
  );
  assert.equal(kept.selected, "a2");
});

test("display toggles from the host never change an imported cost basis", () => {
  const snapshot = parseOk(
    exportSnapshot([row()], defaults, new Set(), meta()),
  ) as ImportedSingle;
  const state = importedViewState(
    view(snapshot, {
      display: { ...defaults.display, chart: "workload", labels: false },
    }),
    context(),
  );
  assert.equal(state.options.display.chart, "task");
  assert.equal(state.options.display.labels, false);
  assert.deepEqual(importedDisplay(defaults.display, "workload").chart, "workload");
});

test("a two-option snapshot reopens as two read-only panels with a delta", () => {
  const side = (over: Partial<PairSideInput>): PairSideInput => ({
    side: "A",
    name: "Side",
    options: defaults,
    rows: [],
    recommendation: { modelIds: [], explanation: "none" },
    scenario: { status: "off" },
    costNormalization: { status: "off" },
    availabilityNote: "available",
    pricingNote: "priced",
    discoveryError: "",
    ...over,
  });
  const sides = [
    side({
      side: "A",
      name: "Copilot",
      rows: [row({ id: "a1", modelId: "a1", baseModelId: "a1", cost: 2 })],
      recommendation: { modelIds: ["a1"], explanation: "best" },
      selected: "a1",
    }),
    side({
      side: "B",
      name: "Codex",
      options: { ...defaults, source: "codex", billing: "usd" },
      rows: [
        row({
          id: "b1",
          modelId: "b1",
          baseModelId: "b1",
          cost: 1,
          pricing: { status: "priced", source: "static-registry" },
        }),
      ],
      recommendation: { modelIds: ["b1"], explanation: "best" },
      selected: "b1",
      costNormalization: {
        status: "native",
        original: { value: 1, unit: "USD" },
        usd: 1,
        basis: "task",
      },
    }),
  ];
  const pairMeta: PairMeta = {
    catalogDate: "2026-09-10",
    staticRegistryDate: "2026-09-11",
    planRegistryDate: "2026-09-14",
    version: "4.3",
    fetchedAt: 77,
    normalize: true,
    usdCostDelta: null,
  };
  const snapshot = parseOk(
    exportPairSnapshot(sides, pairMeta),
  ) as ImportedComparison;
  assert.equal(snapshot.kind, "comparison");
  assert.equal(snapshot.normalize, true);
  assert.equal(snapshot.sides.A.name, "Copilot");
  assert.equal(snapshot.sides.B.options.source, "codex");
  // Each side's rows were already filtered by its own filter.
  assert.equal(snapshot.sides.A.options.filter, "");
  assert.deepEqual(snapshot.sides.A.recommended, ["a1"]);
  assert.equal(snapshot.sides.A.selected, "a1");
  assert.equal(snapshot.delta.direction, "B minus A");
  // Different billing units: no native cost delta, but a USD one.
  assert.equal(snapshot.delta.cost, null);
  assert.equal(snapshot.delta.reason, "Different billing units.");
  assert.equal(snapshot.delta.usd?.A.status, "converted");
  assert.equal(snapshot.delta.usd?.B.status, "native");
  assert.equal(snapshot.delta.usd?.delta, 0.98);
  assert.equal(snapshot.overlay.unit, "USD equivalent");
  assert.equal(snapshot.overlay.converted, true);
  assert.equal(snapshot.overlay.rows.length, 2);
  const state = importedViewState(view(snapshot), context());
  assert.equal(state.comparison?.sides.A.rows.length, 1);
  assert.equal(state.comparison?.sides.B.rows[0].cost, 1);
  assert.equal(state.comparison?.normalize, true);
  assert.equal(state.comparison?.active, "A");
  assert.deepEqual(state.models, []);
  assert.equal(state.imported?.costBasis.basis, "per side");
  assert.deepEqual(state.imported?.options, ["A: Copilot", "B: Codex"]);
  // A pair snapshot reopens exactly as exported, side by side.
  assert.equal(state.comparison?.view, "side-by-side");
});

test("a two-option snapshot with USD equivalents off is reported as off", () => {
  const side = (over: Partial<PairSideInput>): PairSideInput => ({
    side: "A",
    name: "Side",
    options: defaults,
    rows: [row()],
    recommendation: { modelIds: [], explanation: "none" },
    scenario: { status: "off" },
    costNormalization: { status: "off" },
    availabilityNote: "",
    pricingNote: "",
    discoveryError: "",
    ...over,
  });
  const snapshot = parseOk(
    exportPairSnapshot(
      [side({ side: "A" }), side({ side: "B", name: "Other" })],
      {
        catalogDate: "2026-09-10",
        staticRegistryDate: "2026-09-11",
        planRegistryDate: "2026-09-14",
        normalize: false,
        usdCostDelta: null,
      },
    ),
  ) as ImportedComparison;
  assert.equal(snapshot.normalize, false);
  assert.equal(snapshot.delta.usd, null);
  assert.equal(snapshot.overlay.converted, false);
});

test("non-JSON, badge, cache, and older snapshot files are refused by name", () => {
  assert.equal(parseFail("not json").reason, "invalid-json");
  assert.equal(parseFail("[1,2,3]").reason, "not-a-snapshot");
  // The shields badge is JSON this extension writes, but not a snapshot.
  assert.equal(
    parseFail(
      JSON.stringify({ schemaVersion: 1, label: "pareto copilot" }),
    ).reason,
    "not-a-snapshot",
  );
  // The benchmark cache has a version but no snapshot kind: it is simply not a
  // comparison snapshot, and says so instead of blaming the schema.
  const cache = parseFail(
    JSON.stringify({ version: "4.2", fetchedAt: 1, models: [] }),
  );
  assert.equal(cache.reason, "not-a-snapshot");
  assert.match(cache.message, /not a comparison snapshot/);
  assert.equal(parseFail(JSON.stringify({ nope: true })).reason, "not-a-snapshot");
  // v1 and v2 predate the `kind` discriminator, so they are refused as
  // predating the current schema rather than misread as a v3 file.
  for (const version of [1, 2]) {
    const older = parseFail(
      JSON.stringify({ version, source: "copilot", rows: [] }),
    );
    assert.equal(older.reason, "unsupported-version");
    assert.match(older.message, /predates snapshot schema version 3/);
  }
  // A v3-shaped file from a future build names the version it found.
  const future = parseFail(
    JSON.stringify({ version: 4, kind: "single", rows: [] }),
  );
  assert.equal(future.reason, "unsupported-version");
  assert.match(future.message, /schema version 4, but this build reads version 3/);
  assert.equal(future.found, 4);
  const kind = parseFail(
    JSON.stringify({ version: snapshotSchemaVersion, kind: "badge" }),
  );
  assert.equal(kind.reason, "unsupported-kind");
});

test("a corrupt file is reported as corrupt, never partially rendered", () => {
  const base = JSON.parse(
    exportSnapshot([row()], defaults, new Set(["m1"]), meta()),
  );
  const cases: [string, unknown][] = [
    ["missing cost basis", { ...base, costBasis: undefined }],
    ["unknown basis", { ...base, costBasis: { ...base.costBasis, basis: "x" } }],
    [
      "missing unit",
      { ...base, costBasis: { ...base.costBasis, unit: "" } },
    ],
    [
      "unit disagrees with billing",
      { ...base, costBasis: { ...base.costBasis, unit: "USD" } },
    ],
    [
      "legacy basis with a token mix",
      { ...base, costBasis: { ...base.costBasis, basis: "legacy" } },
    ],
    ["rows not an array", { ...base, rows: {} }],
    [
      "row without an id",
      { ...base, rows: [{ ...base.rows[0], id: "" }] },
    ],
    [
      "row with a negative cost",
      { ...base, rows: [{ ...base.rows[0], cost: -1 }] },
    ],
    [
      "row with an unknown mapping status",
      { ...base, rows: [{ ...base.rows[0], mappingStatus: "guessed" }] },
    ],
    [
      "row with an unknown pricing status",
      { ...base, rows: [{ ...base.rows[0], pricingStatus: "cheap" }] },
    ],
    [
      "row with an unreadable benchmark",
      { ...base, rows: [{ ...base.rows[0], benchmark: { id: "b" } }] },
    ],
    [
      "row with a non-boolean recommendation flag",
      { ...base, rows: [{ ...base.rows[0], recommended: "yes" }] },
    ],
    ["unknown source", { ...base, source: "gpt-cli" }],
    ["unknown billing", { ...base, billing: "gold" }],
    ["unknown preset", { ...base, preset: "vibes" }],
    ["missing disclaimer", { ...base, disclaimer: undefined }],
    [
      "duplicate row ids",
      { ...base, rows: [base.rows[0], { ...base.rows[0] }] },
    ],
  ];
  for (const [label, value] of cases) {
    const failure = parseFail(JSON.stringify(value));
    assert.equal(failure.reason, "corrupt", label);
    assert.ok(failure.message.length > 0, label);
  }
});

test("unreadable descriptions degrade to unknown instead of today's values", () => {
  const base = JSON.parse(
    exportSnapshot([row()], defaults, new Set(["m1"]), meta()),
  );
  const snapshot = parseOk(
    JSON.stringify({
      ...base,
      exportedAt: "not a date",
      catalogDate: "",
      staticRegistryDate: null,
      planRegistryDate: undefined,
      benchmarkVersion: 42,
      benchmarkFetchedAt: "soon",
      disclaimer: "",
    }),
  ) as ImportedSingle;
  assert.equal(snapshot.exportedAt, "unknown");
  assert.equal(snapshot.catalogDate, "unknown");
  assert.equal(snapshot.staticRegistryDate, "unknown");
  assert.equal(snapshot.planRegistryDate, "unknown");
  assert.equal(snapshot.benchmarkVersion, "unknown");
  assert.equal(snapshot.benchmarkFetchedAt, undefined);
  assert.equal(snapshot.disclaimer, "");
  const state = importedViewState(view(snapshot), context());
  // Unparseable dates are reported, never treated as fresh or as today.
  assert.equal(state.catalogDate, "unknown");
  assert.equal(state.version, "unknown");
  assert.equal(state.fetchedAt, undefined);
});

test("a corrupt two-option snapshot names the failure without partial sides", () => {
  const side = (over: Partial<PairSideInput>): PairSideInput => ({
    side: "A",
    name: "Side",
    options: defaults,
    rows: [row()],
    recommendation: { modelIds: [], explanation: "none" },
    scenario: { status: "off" },
    costNormalization: { status: "off" },
    availabilityNote: "",
    pricingNote: "",
    discoveryError: "",
    ...over,
  });
  const text = exportPairSnapshot([side({ side: "A" }), side({ side: "B" })], {
    catalogDate: "2026-09-10",
    staticRegistryDate: "2026-09-11",
    planRegistryDate: "2026-09-14",
    normalize: false,
    usdCostDelta: null,
  });
  const base = JSON.parse(text);
  assert.equal(
    parseFail(JSON.stringify({ ...base, options: [base.options[0]] })).reason,
    "corrupt",
  );
  assert.equal(
    parseFail(
      JSON.stringify({
        ...base,
        options: base.options.map((o: Record<string, unknown>) =>
          o.side === "B" ? { ...o, unit: "USD" } : o,
        ),
      }),
    ).reason,
    "corrupt",
  );
  assert.equal(
    parseFail(
      JSON.stringify({
        ...base,
        options: base.options.map((o: Record<string, unknown>) =>
          o.side === "B"
            ? {
                ...o,
                options: { ...(o.options as object), billing: "nope" },
              }
            : o,
        ),
      }),
    ).reason,
    "corrupt",
  );
  // A recorded scenario that cannot be read degrades to "unavailable" with a
  // reason instead of an unreadable shape.
  const snapshot = parseOk(
    JSON.stringify({
      ...base,
      options: base.options.map((o: Record<string, unknown>) => ({
        ...o,
        scenario: { status: "projected" },
      })),
    }),
  ) as ImportedComparison;
  assert.equal(snapshot.sides.A.scenario.status, "unavailable");
  if (snapshot.sides.A.scenario.status === "unavailable")
    assert.match(snapshot.sides.A.scenario.reason, /could not be read/);
});

test("only navigation, display drafts, and leaving are honoured while imported", () => {
  const allowed = (type: string) =>
    allowedWhileImported({ type } as Parameters<typeof allowedWhileImported>[0]);
  for (const type of [
    "ready",
    "importSnapshot",
    "importExit",
    "options",
    "select",
  ])
    assert.equal(allowed(type), true, type);
  for (const type of [
    "refresh",
    "key",
    "source",
    "mapping",
    "pin",
    "unpin",
    "exclude",
    "excludeMany",
    "excludeAll",
    "byok",
    "byokApply",
    "byokReset",
    "scanUsage",
    "clearUsage",
    "setUsageRetention",
    "showUsageData",
    "profile",
    "exportCsv",
    "exportSnapshot",
    "exportBadge",
    "exportPng",
    "watchlistAlerts",
    "comparison",
    "copy",
  ])
    assert.equal(allowed(type), false, type);
  // A targeted row selection is navigation; anything else targeted is an edit.
  assert.equal(
    allowedWhileImported({
      type: "target",
      side: "B",
      action: { type: "select", id: "b1" },
    }),
    true,
  );
  assert.equal(
    allowedWhileImported({
      type: "target",
      side: "B",
      action: { type: "source", source: "codex" },
    }),
    false,
  );
});

test("importedFileName shows the file without its directory", () => {
  assert.equal(importedFileName("/home/u/exports/snap.json"), "snap.json");
  assert.equal(importedFileName("C:\\exports\\snap.json"), "snap.json");
  assert.equal(importedFileName("snap.json"), "snap.json");
});

test("imported units always come from the shared cost-unit helper", () => {
  assert.equal(costUnit("credits"), "AI credits");
  assert.equal(costUnit("legacy"), "premium requests");
  assert.equal(costUnit("usd"), "USD");
});

test("a recorded tier and spending scenario survive the round trip", () => {
  const projected = projectScenario({
    scenario: {
      planId: "copilot-pro",
      requestsLow: 100,
      requestsHigh: 200,
      origin: "user",
      history: null,
      custom: { monthlyFeeUsd: null, allowance: null, overageUsdPerUnit: null },
    },
    options: structuredClone(defaults),
    row: row({ cost: 2 }),
    rowOrigin: "selected",
    catalogDate: "2026-09-10",
  });
  assert.equal(projected.status, "projected");
  const snapshot = parseOk(
    exportSnapshot(
      [row({ tier: "Default context", cost: 2 })],
      defaults,
      new Set(["m1"]),
      meta({ scenario: projected }),
    ),
  ) as ImportedSingle;
  assert.equal(snapshot.rows[0].tier, "Default context");
  assert.equal(snapshot.scenario?.status, "projected");
  const state = importedViewState(view(snapshot), context());
  assert.equal(state.scenario.status, "projected");
  if (state.scenario.status === "projected") {
    assert.equal(state.scenario.plan.label, "Copilot Pro");
    assert.equal(state.scenario.requests.low, 100);
  }
});

test("per-side scenario and USD-equivalent states are read as recorded", () => {
  const side = (over: Partial<PairSideInput>): PairSideInput => ({
    side: "A",
    name: "Side",
    options: defaults,
    rows: [row()],
    recommendation: { modelIds: [], explanation: "none" },
    scenario: { status: "off" },
    costNormalization: { status: "off" },
    availabilityNote: "",
    pricingNote: "",
    discoveryError: "",
    ...over,
  });
  const text = exportPairSnapshot(
    [
      side({
        side: "A",
        costNormalization: {
          status: "converted",
          original: { value: 1.5, unit: "AI credits" },
          usd: 0.015,
          rate: { usdPerUnit: 0.01, unit: "AI credits" },
          provenance: {
            kind: "provider",
            date: "2026-09-14",
            sources: ["https://example.test"],
          },
          allowanceTreatment: "none",
          basis: "task",
        },
        scenario: {
          status: "unavailable",
          planId: "opencode-go",
          label: "OpenCode Go",
          reason: "No documented billing rules.",
          notes: [],
          disclaimer: "",
        },
      }),
      side({ side: "B", name: "Legacy" }),
    ],
    {
      catalogDate: "2026-09-10",
      staticRegistryDate: "2026-09-11",
      planRegistryDate: "2026-09-14",
      normalize: true,
      usdCostDelta: null,
    },
  );
  const snapshot = parseOk(text) as ImportedComparison;
  assert.equal(snapshot.sides.A.costNormalization.status, "converted");
  assert.equal(snapshot.normalize, true);
  assert.equal(snapshot.sides.A.scenario.status, "unavailable");
  if (snapshot.sides.A.scenario.status === "unavailable")
    assert.equal(
      snapshot.sides.A.scenario.reason,
      "No documented billing rules.",
    );
  // An unreadable USD state falls back to "off" rather than being invented.
  const broken = JSON.parse(text);
  broken.options[0].costNormalization = { status: "converted", usd: 0.015 };
  const degraded = parseOk(JSON.stringify(broken)) as ImportedComparison;
  assert.equal(degraded.sides.A.costNormalization.status, "off");
  assert.equal(degraded.normalize, false);
  assert.equal(degraded.delta.usd, null);
});

test("more unreadable snapshot fields are refused than accepted", () => {
  const base = JSON.parse(
    exportSnapshot([row()], defaults, new Set(["m1"]), meta()),
  );
  const cases: [string, unknown][] = [
    [
      "unreadable configured tokens",
      {
        ...base,
        costBasis: { ...base.costBasis, configuredTokens: { input: "x" } },
      },
    ],
    [
      "unreadable effective tokens",
      {
        ...base,
        costBasis: {
          ...base.costBasis,
          effectiveTokens: { input: 1, read: 1, write: 1, output: -1 },
        },
      },
    ],
    [
      "unknown legacy plan",
      { ...base, costBasis: { ...base.costBasis, legacyPlan: "enterprise" } },
    ],
    [
      "unreadable BYOK provenance",
      {
        ...base,
        rows: [
          {
            ...base.rows[0],
            pricingProvenance: { kind: "registry", registry: "codex" },
          },
        ],
      },
    ],
    [
      "unknown provenance kind",
      {
        ...base,
        rows: [{ ...base.rows[0], pricingProvenance: { kind: "scraped" } }],
      },
    ],
    [
      "unreadable row tier",
      { ...base, rows: [{ ...base.rows[0], tier: 7 }] },
    ],
    [
      "unreadable pricing issue",
      { ...base, rows: [{ ...base.rows[0], pricingIssue: 7 }] },
    ],
    [
      "too many rows",
      { ...base, rows: Array.from({ length: 5001 }, () => base.rows[0]) },
    ],
  ];
  for (const [label, value] of cases) {
    const failure = parseFail(JSON.stringify(value));
    assert.equal(failure.reason, "corrupt", label);
  }
});

test("a snapshot with no scenario and a recorded discovery error read as such", () => {
  // The exporter writes `scenario: null` when the projection was off.
  const off = parseOk(
    exportSnapshot([row()], defaults, new Set(["m1"]), {
      ...meta(),
      scenario: undefined,
    }),
  ) as ImportedSingle;
  assert.equal(off.scenario, null);
  const state = importedViewState(view(off), context());
  assert.deepEqual(state.scenario, { status: "off" });
  const side = (over: Partial<PairSideInput>): PairSideInput => ({
    side: "A",
    name: "Side",
    options: defaults,
    rows: [row()],
    recommendation: { modelIds: [], explanation: "none" },
    scenario: { status: "off" },
    costNormalization: { status: "off" },
    availabilityNote: "",
    pricingNote: "",
    discoveryError: "",
    ...over,
  });
  const snapshot = parseOk(
    exportPairSnapshot(
      [
        side({ side: "A" }),
        side({
          side: "B",
          name: "Legacy",
          options: { ...defaults, billing: "legacy" },
          discoveryError: "Could not discover models. Retry.",
          costNormalization: {
            status: "unavailable",
            original: { value: 0.33, unit: "premium requests" },
            reason: "Legacy premium requests are never converted.",
          },
        }),
      ],
      {
        catalogDate: "2026-09-10",
        staticRegistryDate: "2026-09-11",
        planRegistryDate: "2026-09-14",
        normalize: true,
        usdCostDelta: null,
      },
    ),
  ) as ImportedComparison;
  assert.equal(snapshot.sides.B.discoveryError, "Could not discover models. Retry.");
  assert.equal(snapshot.sides.B.costNormalization.status, "unavailable");
  const pair = importedViewState(view(snapshot), context());
  assert.equal(
    pair.comparison?.sides.B.discoveryError,
    "Could not discover models. Retry.",
  );
});

test("rows with nothing recorded import without invented fields", () => {
  // A row the export could not price or match: the projection records nulls,
  // and the imported row stays explicit about having no benchmark or price.
  const unresolved: Row = {
    id: "u1",
    modelId: "u1",
    baseModelId: "u1",
    name: "Unmapped model",
    provider: "Unknown",
    score: null,
    cost: null,
    frontier: false,
    dominatedBy: [],
    reasons: ["No catalog entry."],
    mappingStatus: "missing",
    candidateIds: [],
    mapping: { issue: "no-catalog-entry", aliases: [], suggestions: [] },
    pricing: { status: "unresolved", source: "none", issue: "no-catalog-entry" },
  };
  const snapshot = parseOk(
    exportSnapshot([unresolved], defaults, new Set(), meta()),
  ) as ImportedSingle;
  const row = snapshot.rows[0];
  assert.equal(row.benchmark, undefined);
  assert.equal(row.tier, undefined);
  assert.equal(row.breakdown, undefined);
  assert.equal(row.invocable, undefined);
  assert.equal(row.mapping, undefined);
  assert.equal(row.mappingStatus, "missing");
  assert.equal(row.score, null);
  assert.equal(row.cost, null);
  assert.equal(row.pricing?.status, "unresolved");
  assert.deepEqual(row.dominatedBy, []);
  const state = importedViewState(view(snapshot), context());
  // Nothing comparable to plot, and the recommendation says so.
  assert.equal(state.recommendation.modelIds.length, 0);
  assert.match(state.recommendation.explanation, /No model was recommended/);
  assert.equal(state.selected, "u1");
});

test("a pair view keeps a per-side selection inside the read-only view", () => {
  const side = (over: Partial<PairSideInput>): PairSideInput => ({
    side: "A",
    name: "Side",
    options: defaults,
    rows: [
      row({ id: "a1", modelId: "a1", baseModelId: "a1" }),
      row({ id: "a2", modelId: "a2", baseModelId: "a2", frontier: false }),
    ],
    recommendation: { modelIds: ["a1"], explanation: "best" },
    scenario: { status: "off" },
    costNormalization: { status: "off" },
    availabilityNote: "",
    pricingNote: "",
    discoveryError: "",
    ...over,
  });
  const snapshot = parseOk(
    exportPairSnapshot(
      [side({ side: "A", selected: "a1" }), side({ side: "B", name: "Other" })],
      {
        catalogDate: "2026-09-10",
        staticRegistryDate: "2026-09-11",
        planRegistryDate: "2026-09-14",
        normalize: false,
        usdCostDelta: null,
      },
    ),
  ) as ImportedComparison;
  assert.equal(snapshot.sides.A.selected, "a1");
  assert.equal(snapshot.sides.B.selected, undefined);
  // A selection made inside the imported view replaces the exported one, per
  // side, and never reaches the live comparison.
  const state = importedViewState(
    view(snapshot, { selected: { A: "a2", B: "a1" } }),
    context(),
  );
  assert.equal(state.comparison?.sides.A.selected, "a2");
  assert.equal(state.comparison?.sides.B.selected, "a1");
  // A selection that is no longer displayed falls back to the recommendation.
  const stale = importedViewState(
    view(snapshot, { selected: { A: "gone" } }),
    context(),
  );
  assert.equal(stale.comparison?.sides.A.selected, "a1");
});

test("one broken field at a time fails the whole file, never half of it", () => {
  const single = JSON.parse(
    exportSnapshot([row()], defaults, new Set(["m1"]), meta()),
  );
  const side = (over: Partial<PairSideInput>): PairSideInput => ({
    side: "A",
    name: "Side",
    options: defaults,
    rows: [row()],
    recommendation: { modelIds: [], explanation: "none" },
    scenario: { status: "off" },
    costNormalization: { status: "off" },
    availabilityNote: "",
    pricingNote: "",
    discoveryError: "",
    ...over,
  });
  const pair = JSON.parse(
    exportPairSnapshot([side({ side: "A" }), side({ side: "B" })], {
      catalogDate: "2026-09-10",
      staticRegistryDate: "2026-09-11",
      planRegistryDate: "2026-09-14",
      normalize: false,
      usdCostDelta: null,
    }),
  );
  const withSide = (index: number, patch: Record<string, unknown>) => {
    const copy = structuredClone(pair);
    copy.options[index] = { ...copy.options[index], ...patch };
    return copy;
  };
  const singleCases: [string, unknown][] = [
    ["legacy basis with credit billing", {
      ...single,
      costBasis: { ...single.costBasis, basis: "legacy" },
    }],
    ["row is not an object", { ...single, rows: ["nope"] }],
    ["row without a provider", {
      ...single,
      rows: [{ ...single.rows[0], provider: "" }],
    }],
    ["row without reasons", {
      ...single,
      rows: [{ ...single.rows[0], reasons: "priced" }],
    }],
    ["row frontier is not a boolean", {
      ...single,
      rows: [{ ...single.rows[0], frontier: "yes" }],
    }],
    ["row with an unknown pricing source", {
      ...single,
      rows: [{ ...single.rows[0], pricingSource: "barter" }],
    }],
    ["row whose provenance is not an object", {
      ...single,
      rows: [{ ...single.rows[0], pricingProvenance: "manual" }],
    }],
  ];
  for (const [label, value] of singleCases)
    assert.equal(parseFail(JSON.stringify(value)).reason, "corrupt", label);
  const pairCases: [string, unknown][] = [
    ["options is not a list", { ...pair, options: {} }],
    ["only one side present", { ...pair, options: [pair.options[0]] }],
    ["side without a name", withSide(1, { name: "" })],
    ["side without a cost basis", withSide(0, { costBasis: undefined })],
    [
      "side cost basis unit disagrees",
      withSide(1, {
        costBasis: { ...pair.options[1].costBasis, unit: "premium requests" },
      }),
    ],
    ["side rows unreadable", withSide(0, { rows: "none" })],
    ["side options unreadable", withSide(1, { options: "defaults" })],
  ];
  for (const [label, value] of pairCases)
    assert.equal(parseFail(JSON.stringify(value)).reason, "corrupt", label);
  // An unreadable USD-equivalent block is not fatal: the side simply reports
  // the toggle as off instead of inventing a converted value.
  const degraded = parseOk(
    JSON.stringify(withSide(0, { costNormalization: "off" })),
  ) as ImportedComparison;
  assert.equal(degraded.sides.A.costNormalization.status, "off");
  assert.equal(degraded.normalize, false);
  // A row the export could not price at all keeps no pricing block, and the
  // read-only details then say nothing about a price it never had.
  const unpriced = parseOk(
    JSON.stringify({
      ...single,
      rows: [
        {
          ...single.rows[0],
          pricingStatus: null,
          pricingSource: null,
          pricingIssue: null,
          pricingProvenance: null,
        },
      ],
    }),
  ) as ImportedSingle;
  assert.equal(unpriced.rows[0].pricing, undefined);
});
