import { test } from "vitest";
import assert from "node:assert/strict";
import {
  BenchmarkService,
  cacheTtl,
  parsePage,
  validSnapshot,
} from "../src/api";
import type { Snapshot } from "../src/types";
const now = Date.parse("2026-09-10");
const page = (n = 1, more = false, id = "one") => ({
  intelligence_index_version: 4.3,
  pagination: { page: n, has_more: more },
  data: [
    {
      id,
      slug: id,
      name: "Model",
      model_creator: { name: "Provider" },
      evaluations: {
        artificial_analysis_intelligence_index: 5,
        artificial_analysis_coding_index: null,
      },
    },
  ],
});
const old: Snapshot = {
  version: "4.3",
  fetchedAt: now - cacheTtl - 1,
  models: [],
};
function setup(responses: Response[], cached: unknown = undefined) {
  let stored = cached,
    calls = 0;
  const service = new BenchmarkService(
    {
      read: async () => stored,
      write: async (v) => {
        stored = v;
      },
    },
    (async () => {
      calls++;
      return responses.shift()!;
    }) as typeof fetch,
    () => now,
  );
  return { service, calls: () => calls, stored: () => stored };
}
test("fetches every page and commits a complete validated snapshot", async () => {
  const s = setup([
    Response.json(page(1, true)),
    Response.json(page(2, false, "two")),
  ]);
  const result = await s.service.load("secret");
  assert.equal(s.calls(), 2);
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].scores.coding, null);
  assert.equal(result.version, "4.3");
  await s.service.load("secret");
  assert.equal(s.calls(), 2);
});
test("fresh cache needs no key; stale cache refreshes", async () => {
  const fresh = setup([], { ...old, fetchedAt: now - 10 });
  await fresh.service.load(undefined);
  assert.equal(fresh.calls(), 0);
  const stale = setup([Response.json(page())], old);
  assert.equal((await stale.service.load("key")).fetchedAt, now);
});
test("authentication failure preserves cache and is not retried automatically", async () => {
  for (const code of [401, 403]) {
    const s = setup([new Response("", { status: code })], old);
    await assert.rejects(s.service.load("key"), /API key/);
    assert.deepEqual(await s.service.cached(), old);
    await s.service.load("key");
    assert.equal(s.calls(), 1);
  }
});
test("rate limit respects Retry-After and reset, including manual refresh", async () => {
  const s = setup(
    [
      new Response("", {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Reset": String(now / 1000 + 120),
        },
      }),
    ],
    old,
  );
  await assert.rejects(s.service.load("key"), /rate limit/);
  assert.equal(s.service.retryAt, now + 120000);
  await assert.rejects(s.service.load("key", true), /rate limit/);
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.stored(), old);
});
test("quota exhaustion between pages does not overwrite old cache", async () => {
  const s = setup(
    [
      Response.json(page(1, true), {
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(now / 1000 + 100),
        },
      }),
    ],
    old,
  );
  await assert.rejects(s.service.load("key"), /quota exhausted/);
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.stored(), old);
});
test("invalid pages, duplicate IDs, and changing versions preserve the cache", async () => {
  for (const responses of [
    [Response.json({})],
    [Response.json(page(1, true)), Response.json(page(2))],
    [
      Response.json(page(1, true)),
      Response.json({
        ...page(2, false, "two"),
        intelligence_index_version: 5,
      }),
    ],
  ]) {
    const s = setup(responses, old);
    await assert.rejects(s.service.load("key"));
    assert.deepEqual(s.stored(), old);
  }
  assert.throws(() => parsePage({ ...page(), data: [{ id: "bad" }] }, 1));
  assert.equal(validSnapshot({ ...old, models: [{ id: "broken" }] }), false);
});
test("network exceptions cannot expose request secrets", async () => {
  const service = new BenchmarkService(
    { read: async () => undefined, write: async () => {} },
    (async () => {
      throw new Error("SECRET_KEY");
    }) as typeof fetch,
  );
  await assert.rejects(
    service.load("SECRET_KEY"),
    (error) => error instanceof Error && !error.message.includes("SECRET_KEY"),
  );
});
test("concurrent calls share a download", async () => {
  const s = setup([Response.json(page())]);
  await Promise.all([s.service.load("key"), s.service.load("key")]);
  assert.equal(s.calls(), 1);
});
