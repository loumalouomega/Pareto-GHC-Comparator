import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const script = new URL("../scripts/verify-release.mjs", import.meta.url);
import { fileURLToPath } from "node:url";

test("release gate accepts the manifest version and rejects other tags", () => {
  const run = (tag: string) =>
    spawnSync(process.execPath, [fileURLToPath(script), tag], {
      encoding: "utf8",
    });
  assert.equal(run(`v${manifest.version}`).status, 0);
  for (const tag of [
    manifest.version,
    "v999.0.0",
    `v${manifest.version}-beta.1`,
    "main",
  ]) {
    const result = run(tag);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release tag must equal/);
  }
});
