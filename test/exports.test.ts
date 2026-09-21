import { test } from "vitest";
import assert from "node:assert/strict";
import {
  costBasisOf,
  csvHeaderLine,
  exportBadge,
  exportCsv,
  exportPairCsv,
  exportPairSnapshot,
  exportSnapshot,
  snapshotRow,
  snapshotSchemaVersion,
  type PairMeta,
  type PairSideInput,
} from "../src/export";
import { taskMix } from "../src/compare";
import { recommend } from "../src/recommend";
import { costUnit } from "../src/types";
import { defaults, type Options, type Row } from "../src/types";

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

/** Minimal RFC4180 splitter, mirroring test/extension.test.ts. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "",
    inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const customTokens = { input: 5, read: 6, write: 7, output: 8 };

test("costBasisOf distinguishes task, workload, and legacy assumptions", () => {
  const task = costBasisOf({ ...defaults, tokens: { ...customTokens } });
  assert.equal(task.basis, "task");
  assert.equal(task.unit, "AI credits");
  assert.deepEqual(task.configuredTokens, customTokens);
  assert.deepEqual(task.effectiveTokens, taskMix);
  assert.equal(task.legacyPlan, null);

  const workload = costBasisOf({
    ...defaults,
    tokens: { ...customTokens },
    display: { ...defaults.display, chart: "workload" },
  });
  assert.equal(workload.basis, "workload");
  assert.deepEqual(workload.effectiveTokens, customTokens);

  const legacy = costBasisOf({
    ...defaults,
    billing: "legacy",
    plan: "proPlus",
    display: { ...defaults.display, chart: "workload" },
  });
  assert.equal(legacy.basis, "legacy");
  assert.equal(legacy.unit, "premium requests");
  assert.equal(legacy.effectiveTokens, null);
  assert.equal(legacy.legacyPlan, "proPlus");
});

test("unit labels stay consistent across recommend, CSV, snapshot, and badge", () => {
  for (const billing of ["credits", "legacy", "usd"] as const) {
    const options: Options = { ...defaults, billing };
    const unit = costUnit(billing);
    assert.match(recommend([row()], options).explanation, new RegExp(unit));
    const csv = exportCsv([row()], options, new Set(["m1"]));
    assert.ok(csv.includes(`,${unit},`));
    const snapshot = JSON.parse(
      exportSnapshot([row()], options, new Set(["m1"]), {
        source: "copilot",
        preset: "general",
        billing,
        catalogDate: "2026-09-10",
        staticRegistryDate: "2026-09-11",
      }),
    );
    assert.equal(snapshot.costBasis.unit, unit);
    const badge = JSON.parse(
      exportBadge([row()], options, { source: "copilot", preset: "general" }),
    );
    assert.equal(badge.unit, unit);
    assert.match(badge.message, new RegExp(unit));
  }
});

test("CSV rows carry basis, mixes, dates, and pricing issues", () => {
  const provenance = {
    catalogDate: "2026-09-10",
    staticRegistryDate: "2026-09-11",
    version: "4.3",
    fetchedAt: 77,
  };
  const csv = exportCsv([row()], defaults, new Set(["m1"]), provenance);
  const lines = csv.trim().split("\n");
  assert.deepEqual(splitCsv(lines[0]).slice(0, 16), splitCsv(csvHeaderLine()).slice(0, 16));
  const cells = splitCsv(lines[1]);
  assert.equal(cells.length, splitCsv(lines[0]).length);
  // cost_basis, configured workload, effective task mix, dates, blank issue.
  assert.deepEqual(cells.slice(16, 25), [
    "task",
    "1000",
    "0",
    "0",
    "1000",
    String(taskMix.input),
    "0",
    "0",
    String(taskMix.output),
  ]);
  assert.deepEqual(cells.slice(25, 29), ["2026-09-10", "2026-09-11", "4.3", "77"]);
  assert.equal(cells[29], "");

  // Legacy rows leave the effective mix empty and record the basis instead.
  const legacyRow = row({
    pricing: { status: "priced", source: "legacy-multiplier" },
  });
  const legacy = exportCsv(
    [legacyRow],
    { ...defaults, billing: "legacy" },
    new Set(),
    provenance,
  );
  const legacyCells = splitCsv(legacy.trim().split("\n")[1]);
  assert.deepEqual(legacyCells.slice(16, 25), [
    "legacy",
    "1000",
    "0",
    "0",
    "1000",
    "",
    "",
    "",
    "",
  ]);

  // Without provenance every date/issue cell stays blank rather than guessed.
  const bare = splitCsv(exportCsv([row()], defaults).trim().split("\n")[1]);
  assert.deepEqual(bare.slice(25), ["", "", "", "", ""]);
});

test("single snapshot v3 round-trips unit, basis, variant, and pricing source", () => {
  assert.equal(snapshotSchemaVersion, 3);
  const priced = row({
    benchmark: {
      id: "b1",
      slug: "b1",
      name: "Bench One",
      provider: "Test",
      scores: { general: 80, coding: 80, agentic: 80 },
    },
    pricing: {
      status: "byok",
      source: "byok",
      byok: { provenance: { kind: "manual" } },
    },
  });
  const snapshot = JSON.parse(
    exportSnapshot([priced], defaults, new Set(["m1"]), {
      source: "copilot",
      preset: "general",
      billing: "credits",
      catalogDate: "2026-09-10",
      staticRegistryDate: "2026-09-11",
      planRegistryDate: "2026-09-14",
      version: "4.3",
      fetchedAt: 77,
    }),
  );
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.kind, "single");
  assert.deepEqual(snapshot.costBasis, costBasisOf(defaults));
  assert.deepEqual(snapshot.rows[0].benchmark, { id: "b1", name: "Bench One" });
  assert.equal(snapshot.rows[0].mappingStatus, "exact");
  assert.equal(snapshot.rows[0].pricingStatus, "byok");
  assert.equal(snapshot.rows[0].pricingSource, "byok");
  assert.deepEqual(snapshot.rows[0].pricingProvenance, { kind: "manual" });
  assert.deepEqual(snapshotRow(priced, new Set(["m1"])), snapshot.rows[0]);
});

function pairSide(over: Partial<PairSideInput>): PairSideInput {
  return {
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
  };
}

const pairMeta = (over: Partial<PairMeta> = {}): PairMeta => ({
  catalogDate: "2026-09-10",
  staticRegistryDate: "2026-09-11",
  planRegistryDate: "2026-09-14",
  version: "4.3",
  fetchedAt: 77,
  normalize: true,
  usdCostDelta: null,
  ...over,
});

test("pair CSV labels both units and never blends rows across billings", () => {
  const sides = [
    pairSide({
      side: "A",
      name: "Credits",
      options: defaults,
      rows: [row({ id: "a1", modelId: "a1", baseModelId: "a1" })],
      recommendation: { modelIds: ["a1"], explanation: "a" },
      costNormalization: {
        status: "converted",
        original: { value: 1.5, unit: "AI credits" },
        usd: 0.015,
        rate: { usdPerUnit: 0.01, unit: "AI credits" },
        provenance: { kind: "provider", date: "2026-09-14", sources: [] },
        allowanceTreatment: "none",
        basis: "task",
      },
    }),
    pairSide({
      side: "B",
      name: "Dollars",
      options: { ...defaults, source: "codex", billing: "usd" },
      rows: [
        row({
          id: "b1",
          modelId: "b1",
          baseModelId: "b1",
          pricing: { status: "priced", source: "static-registry" },
        }),
      ],
      recommendation: { modelIds: ["b1"], explanation: "b" },
      costNormalization: {
        status: "native",
        original: { value: 1.5, unit: "USD" },
        usd: 1.5,
        basis: "task",
      },
    }),
  ];
  const csv = exportPairCsv(sides, pairMeta());
  const lines = csv.trim().split("\n");
  assert.ok(lines[0].startsWith("option,assumptions,usd_equivalent,usd_conversion,"));
  assert.ok(lines[0].endsWith(csvHeaderLine().split(",").slice(-3).join(",")));
  // Each row keeps its own native unit; both units are labelled.
  assert.ok(csv.includes(",AI credits,"));
  assert.ok(csv.includes(",USD,"));
  const rowA = splitCsv(lines[1]);
  const rowB = splitCsv(lines[2]);
  assert.equal(rowA[0], "A");
  assert.equal(rowB[0], "B");
  assert.equal(rowA[2], "0.015");
  assert.equal(rowA[3], "converted");
  assert.equal(rowB[3], "native");
  const assumptionsA = JSON.parse(rowA[1]);
  assert.equal(assumptionsA.costBasis.unit, "AI credits");
  assert.equal(assumptionsA.costBasis.basis, "task");
  assert.equal(assumptionsA.catalogDate, "2026-09-10");
  assert.equal(JSON.parse(rowB[1]).costBasis.unit, "USD");
});

test("pair CSV marks unconvertible legacy rows instead of mixing them in", () => {
  const csv = exportPairCsv(
    [
      pairSide({
        side: "A",
        options: { ...defaults, billing: "legacy" },
        rows: [row({ pricing: { status: "priced", source: "legacy-multiplier" } })],
        recommendation: { modelIds: [], explanation: "none" },
      }),
    ],
    pairMeta(),
  );
  const cells = splitCsv(csv.trim().split("\n")[1]);
  assert.equal(cells[2], "");
  assert.equal(cells[3], "unavailable");
  assert.ok(csv.includes(",premium requests,"));

  const off = exportPairCsv(
    [
      pairSide({
        side: "A",
        rows: [row()],
        recommendation: { modelIds: [], explanation: "none" },
      }),
    ],
    pairMeta({ normalize: false }),
  );
  assert.equal(splitCsv(off.trim().split("\n")[1])[3], "off");
});

test("pair CSV pads empty sides to the full header width", () => {
  const csv = exportPairCsv(
    [
      pairSide({ side: "A", rows: [], recommendation: { modelIds: [], explanation: "none" } }),
      pairSide({
        side: "B",
        rows: [row()],
        recommendation: { modelIds: ["m1"], explanation: "b" },
      }),
    ],
    pairMeta(),
  );
  const lines = csv.trim().split("\n");
  assert.equal(splitCsv(lines[0]).length, splitCsv(lines[1]).length);
  assert.equal(splitCsv(lines[1]).length, splitCsv(lines[2]).length);
});

test("pair snapshot v3 carries both options with basis and serialized rows", () => {
  const sides = [
    pairSide({
      side: "A",
      name: "Credits",
      rows: [row({ id: "a1", modelId: "a1", baseModelId: "a1" })],
      recommendation: { modelIds: ["a1"], explanation: "a" },
      selected: "a1",
    }),
    pairSide({
      side: "B",
      name: "Dollars",
      options: { ...defaults, source: "codex", billing: "usd" },
      rows: [],
      recommendation: { modelIds: [], explanation: "none" },
    }),
  ];
  const snapshot = JSON.parse(exportPairSnapshot(sides, pairMeta()));
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.kind, "comparison");
  assert.equal(snapshot.options.length, 2);
  assert.equal(snapshot.options[0].unit, "AI credits");
  assert.equal(snapshot.options[1].unit, "USD");
  assert.deepEqual(snapshot.options[0].costBasis, costBasisOf(defaults));
  assert.equal(snapshot.options[0].rows[0].recommended, true);
  assert.equal(snapshot.options[0].rows[0].pricingSource, "copilot-catalog");
  assert.equal(snapshot.options[0].selected, "a1");
  assert.equal(snapshot.options[1].selected, null);
  assert.equal(snapshot.options[1].rows.length, 0);
  assert.equal(snapshot.usdCostDelta, null);
});

test("badge stays schemaVersion 1 with explicit unit and basis", () => {
  const badge = JSON.parse(
    exportBadge([row()], defaults, { source: "copilot", preset: "general" }),
  );
  assert.equal(badge.schemaVersion, 1);
  assert.equal(badge.unit, "AI credits");
  assert.equal(badge.basis, "task");
  assert.match(badge.message, /AI credits/);
});
