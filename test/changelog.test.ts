import { test } from "vitest";
import assert from "node:assert/strict";
import {
  affectedIds,
  appendChangelog,
  changelogCap,
  changelogListCap,
  diffSnapshots,
  isEmptyEntry,
  loadChangelog,
} from "../src/changelog";
import { noiseThreshold } from "../src/drift";
import type { Benchmark, Snapshot } from "../src/types";

const bench = (
  id: string,
  general: number | null,
  extra: Partial<Benchmark> = {},
): Benchmark => ({
  id,
  slug: id,
  name: `Model ${id}`,
  provider: "Maker",
  scores: { general, coding: null, agentic: null },
  ...extra,
});
const snap = (
  models: Benchmark[],
  fetchedAt: number,
  version = "4.0",
): Snapshot => ({ version, fetchedAt, models });

test("diff lists added, removed, and re-scored models on stable ids", () => {
  const prev = snap([bench("a", 40), bench("b", 50), bench("c", 60)], 1);
  const curr = snap([bench("a", 45), bench("b", 50), bench("d", 70)], 2);
  const entry = diffSnapshots(prev, curr);
  assert.deepEqual(entry.added.map((m) => m.id), ["d"]);
  assert.deepEqual(entry.removed.map((m) => m.id), ["c"]);
  assert.deepEqual(entry.changed, [
    {
      id: "a",
      name: "Model a",
      provider: "Maker",
      fields: [{ field: "general", from: 40, to: 45 }],
    },
  ]);
  assert.equal(entry.at, 2);
  assert.equal(entry.rebased, false);
});

test("sub-noise score moves and null transitions stay silent; the boundary counts", () => {
  const prev = snap([bench("a", 40), bench("b", 40), bench("c", null), bench("d", 40)], 1);
  const curr = snap(
    [
      bench("a", 40 + noiseThreshold - 0.01),
      bench("b", 40 + noiseThreshold),
      bench("c", 50),
      bench("d", null),
    ],
    2,
  );
  assert.deepEqual(diffSnapshots(prev, curr).changed.map((c) => c.id), ["b"]);
});

test("AA cost per task is compared only when both sides have it", () => {
  const prev = snap([bench("a", 40, { costPerTask: 1 }), bench("b", 40), bench("c", 40, { costPerTask: 2 })], 1);
  const curr = snap([bench("a", 40, { costPerTask: 1.5 }), bench("b", 40, { costPerTask: 3 }), bench("c", 40, { costPerTask: 2 })], 2);
  const { changed } = diffSnapshots(prev, curr);
  assert.deepEqual(changed.map((c) => [c.id, c.fields[0].field]), [["a", "costPerTask"]]);
});

test("an index version change records membership only, flagged as rebased", () => {
  const entry = diffSnapshots(
    snap([bench("a", 40)], 1, "4.0"),
    snap([bench("a", 20), bench("b", 30)], 2, "5.0"),
  );
  assert.equal(entry.rebased, true);
  assert.deepEqual(entry.changed, []);
  assert.deepEqual(entry.added.map((m) => m.id), ["b"]);
  assert.equal(entry.prevVersion, "4.0");
});

test("per-list caps keep true counts in omitted", () => {
  const many = Array.from({ length: changelogListCap + 5 }, (_, i) => bench(`n${i}`, 10));
  const entry = diffSnapshots(snap([], 1), snap(many, 2));
  assert.equal(entry.added.length, changelogListCap);
  assert.equal(entry.omitted.added, 5);
});

test("append is newest-first, capped, deduped by time, and ignores empty diffs", () => {
  const entryAt = (at: number) =>
    diffSnapshots(snap([], at - 1), snap([bench(`m${at}`, 1)], at));
  let log = [] as ReturnType<typeof loadChangelog>;
  for (let at = 1; at <= changelogCap + 3; at++) log = appendChangelog(log, entryAt(at));
  assert.equal(log.length, changelogCap);
  assert.equal(log[0].at, changelogCap + 3);
  const again = appendChangelog(log, entryAt(changelogCap + 3));
  assert.equal(again.length, changelogCap);
  const empty = diffSnapshots(snap([bench("a", 1)], 1), snap([bench("a", 1)], 2));
  assert.ok(isEmptyEntry(empty));
  assert.equal(appendChangelog(log, empty), log);
  // A re-base with no membership change is still recorded.
  const rebase = diffSnapshots(snap([bench("a", 1)], 1, "4.0"), snap([bench("a", 1)], 2, "5.0"));
  assert.ok(!isEmptyEntry(rebase));
  assert.equal(appendChangelog(log, rebase).length, changelogCap);
});

test("loader drops bad entries individually and never throws", () => {
  const good = diffSnapshots(snap([], 1), snap([bench("a", 1)], 2));
  const stored = JSON.parse(
    JSON.stringify([
      good,
      { at: "x" },
      null,
      { ...good, at: 3, added: [{ id: "x" }, ...good.added] },
      { ...good, at: 2 },
    ]),
  );
  const log = loadChangelog(stored);
  assert.deepEqual(log.map((e) => e.at), [3, 2]);
  assert.equal(log[0].added.length, 1);
  // Changed records are validated field by field too.
  const change = { id: "a", name: "A", provider: "P", fields: [{ field: "general", from: 1, to: 3 }] };
  const withChanges = loadChangelog([
    {
      ...good,
      changed: [change, { ...change, fields: [{ field: "bogus", from: 1, to: 2 }] }, { ...change, fields: [{ field: "general", from: "1", to: 2 }] }, { ...change, id: "" }],
    },
  ]);
  assert.deepEqual(withChanges[0].changed, [change]);
  assert.deepEqual(loadChangelog("nope"), []);
  assert.deepEqual(loadChangelog(undefined), []);
});

test("affectedIds reports only ids currently on screen", () => {
  const entry = diffSnapshots(
    snap([bench("a", 40), bench("gone", 10)], 1),
    snap([bench("a", 50), bench("new", 30)], 2),
  );
  assert.deepEqual(affectedIds(entry, new Set(["a", "zzz"])), ["a"]);
  assert.deepEqual(affectedIds(entry, new Set()), []);
});
