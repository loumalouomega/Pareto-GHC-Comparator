// Weekly OpenCode schema-drift reporter. Reads the two sanitized smoke reports
// the lane uploaded, classifies the pair, and files or updates a single tracked
// issue. This is the only step with `issues: write`, and it never executes the
// OpenCode CLI itself — it only reads the content-free JSON the smoke jobs
// produced, so the write scope cannot be reached by the downloaded binary.
//
// Usage: npx tsx scripts/opencode-drift-report.mjs --pinned <file> --latest <file>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  assessDrift,
  driftBody,
  driftMarker,
  driftTitle,
  type SmokeReport,
} from "../src/opencodeDrift";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const read = (path: string | undefined): SmokeReport | undefined => {
  if (!path) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8").trim());
    return raw && typeof raw === "object" ? (raw as SmokeReport) : undefined;
  } catch {
    // A truncated or absent report is "no evidence", never a pass.
    return undefined;
  }
};

function gh(command: string, ghArgs: string[]): string {
  return execFileSync("gh", [command, ...ghArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main(): void {
  const assessment = assessDrift(
    read(option("--pinned")),
    read(option("--latest")),
  );
  console.log(`verdict=${assessment.verdict} report=${assessment.report}`);
  console.log(assessment.summary);

  // Annotate either way, so a scheduled run nobody opened is still legible.
  console.log(`::notice title=OpenCode schema drift::${assessment.summary}`);

  if (!assessment.report) {
    // Resolved: close the tracked issue rather than leaving it open, so the
    // lane's silence is a positive signal instead of an ambiguous one.
    const open = gh("issue", ["list", "--label", "drift", "--state", "open", "--json", "number", "--limit", "20"])
      .trim();
    for (const { number } of JSON.parse(open || "[]") as { number: number }[])
      if (issueIsOurs(number)) gh("issue", ["close", String(number), "--comment",
        `Recovered: ${assessment.summary}`]);
    return;
  }

  const body = driftBody(assessment);
  gh("label", ["create", "drift", "--force", "--description",
    "Upstream output shape changed; reported by the weekly non-gating schema-drift lane."]);
  const open = gh("issue", ["list", "--label", "drift", "--state", "open", "--json", "number,title,body", "--limit", "20"])
    .trim();
  const ours = (JSON.parse(open || "[]") as { number: number; title: string; body: string }[])
    .filter((i) => i.body.includes(driftMarker));
  const first = ours[0];
  if (first) {
    // One tracked issue, updated in place: a weekly lane must not produce 52.
    gh("issue", ["edit", String(first.number), "--title", driftTitle, "--body", body]);
    console.log(`updated issue #${first.number}`);
    return;
  }
  const url = gh("issue", ["create", "--title", driftTitle, "--body", body, "--label", "drift"])
    .trim();
  console.log(`created issue ${url}`);
}

/** Confirm an open `drift`-labelled issue is ours before acting on it. */
function issueIsOurs(number: number): boolean {
  const body = gh("issue", ["view", String(number), "--json", "body", "--jq", ".body"])
    .trim();
  return body.includes(driftMarker);
}

try {
  main();
} catch (error) {
  // The lane must never fail a run over its own reporting.
  const message = (error as Error).message.slice(0, 300);
  console.log(`::warning title=Schema-drift reporter failed::${message}`);
  console.log(message);
}
