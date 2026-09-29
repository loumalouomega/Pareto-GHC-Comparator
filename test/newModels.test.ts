import { test } from "vitest";
import assert from "node:assert/strict";
import {
  diffSeen,
  loadNewModelsReport,
  loadSeenModels,
  mergeReports,
  newModelEntries,
  summarizeNewModels,
} from "../src/newModels";
import { parseMessage } from "../src/messages";
import type { AvailableModel, NewModelsReport, Row } from "../src/types";

const row = (
  modelId: string,
  score: number | null,
  cost: number | null = 1,
  extra: Partial<Row> = {},
): Row =>
  ({
    id: modelId,
    modelId,
    baseModelId: modelId.split("#")[0],
    name: modelId,
    provider: "p",
    score,
    cost,
    frontier: false,
    reasons: [],
    dominatedBy: [],
    mappingStatus: "resolved",
    candidateIds: [],
    ...extra,
  }) as Row;
const avail = (id: string, freeTier = false): AvailableModel => ({
  id,
  name: id,
  family: id,
  maxInputTokens: 1,
  freeTier,
});

test("first sighting seeds silently; later discoveries diff", () => {
  const seeded = diffSeen(undefined, ["a", "b"]);
  assert.deepEqual(seeded, { seeded: true, newIds: [], next: ["a", "b"] });
  const next = diffSeen(seeded.next, ["a", "b", "c"]);
  assert.deepEqual(next.newIds, ["c"]);
  assert.deepEqual(next.next, ["a", "b", "c"]);
});

test("empty discovery never announces or rewrites the seen set", () => {
  assert.deepEqual(diffSeen(["a"], []), { seeded: false, newIds: [], next: ["a"] });
  assert.deepEqual(diffSeen(undefined, []).newIds, []);
});

test("a model that vanishes and returns is not announced twice", () => {
  const afterGone = diffSeen(["a", "b"], ["a"]);
  assert.deepEqual(afterGone.next, ["a", "b"]);
  assert.deepEqual(diffSeen(afterGone.next, ["a", "b"]).newIds, []);
});

test("entries compare against existing scores, free flag is OpenCode-only", () => {
  const rows = [row("old1", 40), row("old2", 50), row("new1", 60), row("new2", null)];
  const list = [...["old1", "old2", "new1", "new2"].map((i) => avail(i, i === "new1"))];
  const oc = newModelEntries("opencode", rows, list, ["new1", "new2"], "USD");
  assert.equal(oc[0].id, "new1");
  assert.equal(oc[0].free, true);
  assert.equal(oc[0].deltaBest, 10);
  assert.equal(oc[0].deltaMedian, 15);
  assert.equal(oc[0].rank, 1);
  assert.equal(oc[1].score, null);
  assert.equal(oc[1].deltaBest, null);
  const cp = newModelEntries("copilot", rows, list, ["new1"], "AI credits");
  assert.equal(cp[0].free, false);
});

test("variants collapse to the best-scoring row; no preexisting scores means no delta", () => {
  const rows = [row("m#low", 30), row("m#high", 45)];
  const entries = newModelEntries("opencode", rows, [avail("m#low"), avail("m#high")], ["m#low", "m#high"], "USD");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].modelId, "m#high");
  assert.equal(entries[0].deltaBest, null);
});

test("summary lists free models first and caps the list", () => {
  const entries = ["a", "b", "c", "d"].map((n, i) => ({
    id: n, modelId: n, name: n, source: "opencode" as const, free: i === 3,
    score: 50 - i, cost: 0, unit: "USD" as const, rank: i + 1, scored: 4,
    deltaBest: -i, deltaMedian: 0, frontier: false,
  }));
  const rows = entries.map((e) => row(e.id, e.score));
  const real = newModelEntries("opencode", rows, entries.map((e) => avail(e.id, e.free)), ["a", "b", "c", "d"], "USD");
  assert.equal(real[0].id, "d");
  const text = summarizeNewModels({ detectedAt: 1, benchmarkVersion: "v1", entries: real });
  assert.match(text, /OpenCode: 4 new models \(1 free\)/);
  assert.match(text, /d \(FREE/);
  assert.match(text, /\+1 more/);
});

test("reports merge, and tolerant loaders drop bad data", () => {
  const e = (id: string) => ({
    id, modelId: id, name: id, source: "copilot" as const, free: false, score: 1,
    cost: 1, unit: "AI credits" as const, rank: 1, scored: 1, deltaBest: null,
    deltaMedian: null, frontier: false,
  });
  const merged = mergeReports(
    { detectedAt: 1, benchmarkVersion: null, entries: [e("a")] },
    { detectedAt: 2, benchmarkVersion: "v", entries: [e("b")] },
  );
  assert.deepEqual(merged.entries.map((x) => x.id), ["b", "a"]);
  assert.equal(loadNewModelsReport("junk"), undefined);
  assert.equal(loadNewModelsReport({ detectedAt: 1, entries: [{ id: 1 }] }), undefined);
  const loaded = loadNewModelsReport(merged as NewModelsReport);
  assert.equal(loaded?.entries.length, 2);
  assert.deepEqual(loadSeenModels({ copilot: ["a", 3], codex: ["x"], bogus: ["y"] }), {
    copilot: ["a"],
    codex: ["x"],
  });
});

test("dismissNewModels validates without a payload", () => {
  assert.deepEqual(parseMessage({ type: "dismissNewModels" }), { type: "dismissNewModels" });
});

test("static registry additions are labelled as known models, not availability", () => {
  const rows = [row("codex:old", 40), row("codex:new", 48)];
  const entries = newModelEntries("codex", rows, [avail("codex:old"), avail("codex:new")], ["codex:new"], "USD");
  assert.equal(entries[0].free, false);
  assert.equal(entries[0].deltaBest, 8);
  const text = summarizeNewModels({ detectedAt: 1, benchmarkVersion: "v", entries });
  assert.match(text, /Codex.*\(known-model registry\): 1 new model/);
});
