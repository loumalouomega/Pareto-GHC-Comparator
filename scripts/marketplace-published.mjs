#!/usr/bin/env node
/**
 * Confirm a published extension version is actually live on the VS Code
 * Marketplace.
 *
 * `vsce publish` exiting 0 is not proof the upload landed: a 401/403 is
 * reported as a non-zero exit, but a silent failure (or a `--skip-duplicate`
 * run that never actually published) can still leave the extension absent
 * from the public listing. This script asks the public Gallery API whether
 * the version is listed and exits non-zero when it is not, so a green
 * publish job means "the extension is on the Marketplace at this version"
 * rather than "a command returned zero".
 *
 * Marketplace propagation is asynchronous, so the query is retried for a
 * bounded window before giving up.
 *
 * Usage: node scripts/marketplace-published.mjs <extensionId> <version>
 *   extensionId  publisher.name, e.g. kratos-multiphysics.pareto-ghc-comparator
 *
 * Env overrides (mainly for tests):
 *   MARKETPLACE_VERIFY_ATTEMPTS  attempts, default 6
 *   MARKETPLACE_VERIFY_INTERVAL_MS  delay between attempts, default 30000
 */
import { setTimeout as sleep } from "node:timers/promises";

const ENDPOINT =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";

/** Build the public Gallery query body for an extension id. */
export function queryBody(extensionId) {
  return {
    filters: [{ criteria: [{ filterType: 7, value: extensionId }] }],
    flags: 914,
  };
}

/**
 * Pull version strings out of a Gallery response, defensively. A changed or
 * error response must read as "no versions", never as a crash.
 */
export function versionsIn(payload) {
  const versions = payload?.results?.[0]?.extensions?.[0]?.versions;
  if (!Array.isArray(versions)) return [];
  return versions
    .map((entry) => entry?.version)
    .filter((version) => typeof version === "string");
}

/** True when the listing contains exactly this version. */
export function isPublished(payload, version) {
  return versionsIn(payload).includes(version);
}

/**
 * Poll the public listing until `version` shows up or the attempts run out.
 * Returns { ok, attempts, versions }; never throws on a network/parse error,
 * because a transient API problem is a reason to retry, not to crash.
 */
export async function confirmPublished({
  extensionId,
  version,
  attempts = 6,
  intervalMs = 30000,
  fetchImpl = fetch,
  sleepImpl = sleep,
  log = () => {},
}) {
  const body = JSON.stringify(queryBody(extensionId));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let payload = null;
    let error = null;
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json;api-version=3.0-preview.1",
        },
        body,
      });
      if (response.ok) payload = await response.json();
      else error = `HTTP ${response.status}`;
    } catch (cause) {
      error = cause?.message ?? String(cause);
    }
    if (isPublished(payload, version)) {
      log(`Marketplace lists ${extensionId} ${version}.`);
      return { ok: true, attempts: attempt, versions: versionsIn(payload) };
    }
    log(
      `attempt ${attempt}/${attempts}: ${version} not listed${
        error ? ` (${error})` : ""
      }`,
    );
    if (attempt < attempts) await sleepImpl(intervalMs);
  }
  return { ok: false, attempts, versions: [] };
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  const [extensionId, version] = process.argv.slice(2);
  if (!extensionId || !version) {
    console.error(
      "usage: node scripts/marketplace-published.mjs <publisher.name> <version>",
    );
    process.exit(2);
  }
  const attempts = Number(process.env.MARKETPLACE_VERIFY_ATTEMPTS ?? 6);
  const intervalMs = Number(
    process.env.MARKETPLACE_VERIFY_INTERVAL_MS ?? 30000,
  );
  const result = await confirmPublished({
    extensionId,
    version,
    attempts: Number.isInteger(attempts) && attempts > 0 ? attempts : 6,
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : 30000,
    log: (line) => console.log(line),
  });
  if (result.ok) {
    console.log(
      `Verified on the Marketplace: ${extensionId} ${version} (listed: ${result.versions.join(", ")}).`,
    );
    process.exit(0);
  }
  console.error(
    `::error::${extensionId} ${version} is not listed on the Marketplace after ${result.attempts} attempts.`,
  );
  console.error(
    "A green publish job now requires the version to be publicly listed. If the upload reported success, the listing can take a few minutes to propagate; otherwise the token likely lacks write access (verify-pat only checks read).",
  );
  process.exit(1);
}
