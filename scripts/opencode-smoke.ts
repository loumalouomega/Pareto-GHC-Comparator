// Real OpenCode discovery smoke test. Prints sanitized counts only: no paths,
// model IDs, stderr, environment, or configuration leave this script.
// Usage: npx tsx scripts/opencode-smoke.ts [--method npm|script] [--expect-free] [--only-dir <dir>]
import { appendFileSync } from "node:fs";
import { arch, homedir } from "node:os";
import { join, sep } from "node:path";
import {
  createOpenCodeRunner,
  discoverOpenCode,
  execOnce,
  OpenCodeError,
  parseOpenCodeVersion,
} from "../src/opencode";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const method = option("--method") ?? "unspecified";
const onlyDir = option("--only-dir");
const expectFree = args.includes("--expect-free");
const env = onlyDir ? { PATH: onlyDir } : process.env;
const home = onlyDir ? join(onlyDir, "no-home-fallback") : homedir();
const idPattern = /^opencode:[^/]+\/[^#]+(#[^#]+)?$/;

interface Counts {
  total: number;
  priced: number;
  free: number;
  unpriced: number;
  variants: number;
}

function resolution(binary: string): string {
  if (binary.startsWith(join(home, ".opencode", "bin"))) return "home";
  if (binary.split(sep).includes("node_modules")) return "npm-layout";
  return "path";
}

function report(result: Record<string, unknown>) {
  const json = JSON.stringify(result);
  console.log(json);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary)
    appendFileSync(summary, `### OpenCode smoke (${result.os}, ${method}${onlyDir ? ", path with spaces" : ""})\n\n\`\`\`json\n${JSON.stringify(result, null, 1)}\n\`\`\`\n\n`);
}

async function main() {
  const base = { os: process.platform, arch: arch(), method, onlyDir: Boolean(onlyDir) };
  let resolved: string | undefined;
  const started = Date.now();
  try {
    const models = await discoverOpenCode(
      createOpenCodeRunner({
        env,
        home,
        execute: async (binary, runArgs) => {
          const result = await execOnce(binary, runArgs);
          resolved = binary;
          return result;
        },
      }),
      // A 2.x background service that is still starting answers with an error
      // envelope; one short retry keeps a cold runner from reading as drift.
      { retryDelayMs: 5000 },
    );
    const durationMs = Date.now() - started;
    const version = resolved ? (await execOnce(resolved, ["--version"])).stdout.trim() : "";
    const total: Counts = { total: 0, priced: 0, free: 0, unpriced: 0, variants: 0 };
    const byProvider: Record<string, Counts> = {};
    for (const m of models) {
      const provider = m.id.replace(/^opencode:/, "").split("/")[0];
      const counts = (byProvider[provider] ??= { total: 0, priced: 0, free: 0, unpriced: 0, variants: 0 });
      const category = m.freeTier ? "free" : m.rates ? "priced" : "unpriced";
      for (const c of [counts, total]) {
        c.total++;
        c[category]++;
        if (m.id.includes("#")) c.variants++;
      }
    }
    const failures: string[] = [];
    if (!models.length) failures.push("no rows");
    if (expectFree && !total.free) failures.push("no free-tier rows");
    if (models.some((m) => !idPattern.test(m.id))) failures.push("malformed identity");
    if (new Set(models.map((m) => m.id)).size !== models.length) failures.push("duplicate identity");
    report({
      ...base,
      ok: !failures.length,
      failures,
      // 1.x prints a bare version, 2.x prefixes it; the shared parser handles both.
      cliVersion: parseOpenCodeVersion(version) ?? "unknown",
      resolution: resolved ? resolution(resolved) : "unknown",
      pathHasSpace: resolved ? resolved.includes(" ") : false,
      durationMs,
      total,
      byProvider,
    });
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    report({
      ...base,
      ok: false,
      failures: ["discovery"],
      kind: error instanceof OpenCodeError ? error.kind : "unexpected",
    });
    process.exitCode = 1;
  }
}

void main();
