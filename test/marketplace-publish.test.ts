import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  queryBody,
  versionsIn,
  isPublished,
  confirmPublished,
} from "../scripts/marketplace-published.mjs";
import type { MinimalResponse } from "../scripts/marketplace-published.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/extension.yml", import.meta.url),
  "utf8",
);

const listing = (...versions: string[]) => ({
  results: [{ extensions: [{ versions: versions.map((v) => ({ version: v })) }] }],
});

/** A successful Gallery response carrying `payload`. */
const okResponse = (payload: unknown): MinimalResponse => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

/** A non-2xx response; the script must not read its body. */
const errorResponse = (status: number): MinimalResponse => ({
  ok: false,
  status,
  json: async () => {
    throw new Error("body must not be read for a failed request");
  },
});

test("gallery query body targets the extension id", () => {
  const body = queryBody("pub.name");
  assert.deepEqual(body.filters, [
    { criteria: [{ filterType: 7, value: "pub.name" }] },
  ]);
  assert.equal(typeof body.flags, "number");
});

test("query asks for every version, not only the newest", () => {
  // IncludeVersions is required: with IncludeLatestVersionOnly (0x200) the
  // response carries a single version, so an older release would read as
  // missing once a newer one shipped.
  const { flags } = queryBody("pub.name");
  assert.equal(flags & 1, 1, "IncludeVersions must be set");
  assert.equal(flags & 0x200, 0, "IncludeLatestVersionOnly must not be set");
});

test("versions are read defensively from a listing response", () => {
  assert.deepEqual(versionsIn(listing("1.5.0", "1.6.0")), ["1.5.0", "1.6.0"]);
  for (const bad of [
    null,
    undefined,
    {},
    { results: [] },
    { results: [{}] },
    { results: [{ extensions: [] }] },
    { results: [{ extensions: [{}] }] },
    { results: [{ extensions: [{ versions: "1.0.0" }] }] },
    { results: [{ extensions: [{ versions: [null, 3] }] }] },
  ]) {
    assert.deepEqual(versionsIn(bad), [], `for ${JSON.stringify(bad)}`);
  }
});

test("a version counts as published only when listed exactly", () => {
  assert.equal(isPublished(listing("1.5.0", "1.6.0"), "1.6.0"), true);
  assert.equal(isPublished(listing("1.5.0", "1.6.0"), "1.6.1"), false);
  assert.equal(isPublished(listing("1.6.0"), "1.6.0-beta.1"), false);
  assert.equal(isPublished(listing(), "1.6.0"), false);
});

test("confirmation succeeds on the first attempt when the version is listed", async () => {
  let calls = 0;
  const result = await confirmPublished({
    extensionId: "pub.name",
    version: "1.6.0",
    attempts: 3,
    intervalMs: 0,
    fetchImpl: async () => {
      calls++;
      return okResponse(listing("1.6.0"));
    },
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test("confirmation retries while propagation catches up", async () => {
  const responses = [listing("1.5.0"), listing("1.5.0"), listing("1.5.0", "1.6.0")];
  let calls = 0;
  const slept: number[] = [];
  const result = await confirmPublished({
    extensionId: "pub.name",
    version: "1.6.0",
    attempts: 5,
    intervalMs: 1000,
    fetchImpl: async () => okResponse(responses[calls++]),
    sleepImpl: async (ms) => {
      slept.push(ms);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
  // No trailing sleep after the successful attempt.
  assert.deepEqual(slept, [1000, 1000]);
});

test("confirmation gives up after the attempt budget and reports failure", async () => {
  let calls = 0;
  const result = await confirmPublished({
    extensionId: "pub.name",
    version: "1.6.0",
    attempts: 3,
    intervalMs: 0,
    fetchImpl: async () => {
      calls++;
      return okResponse(listing("1.5.0"));
    },
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 3);
});

test("a network error or bad status retries instead of throwing", async () => {
  const failures: Array<MinimalResponse | Error> = [
    new Error("ECONNRESET"),
    errorResponse(503),
    new Error("boom"),
  ];
  let calls = 0;
  const result = await confirmPublished({
    extensionId: "pub.name",
    version: "1.6.0",
    attempts: 3,
    intervalMs: 0,
    fetchImpl: async () => {
      const next = failures[calls++];
      if (next instanceof Error) throw next;
      return next;
    },
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 3);
});

test("an older version is still found once a newer one is listed", async () => {
  // IncludeVersions-only: the response carries every version, so re-checking
  // a superseded release still reports it as live.
  const result = await confirmPublished({
    extensionId: "pub.name",
    version: "1.5.0",
    attempts: 1,
    intervalMs: 0,
    fetchImpl: async () => okResponse(listing("1.6.0", "1.5.0")),
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.versions, ["1.6.0", "1.5.0"]);
});

test("unparseable JSON is treated as not published, never a crash", async () => {
  const result = await confirmPublished({
    extensionId: "pub.name",
    version: "1.6.0",
    attempts: 2,
    intervalMs: 0,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    }),
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, false);
});

// The publish step must fail loudly. Reading $? inside `if ! cmd; then` yields
// the status of the negation (always 0), which turns a 401 into a green job
// and a release that is never uploaded.
test("workflow does not read a command status inside a negated if", () => {
  const negated = /if\s*!\s*[^;]*;\s*then\s*\n\s*[^\n]*\$\?/;
  assert.equal(
    negated.test(workflow),
    false,
    "publish step regressed to `if ! cmd; then STATUS=$?`",
  );
});

test("workflow gates the publish job on a version tag", () => {
  assert.match(
    workflow,
    /name: Publish to VS Code Marketplace\n\s+if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/,
  );
});

test("workflow verifies the upload landed instead of trusting exit zero", () => {
  assert.match(workflow, /name: Confirm the version is live on the Marketplace/);
  assert.match(workflow, /node scripts\/marketplace-published\.mjs/);
  // The upload must still be allowed to fail the job on its own.
  assert.match(workflow, /exit "\$STATUS"/);
});
