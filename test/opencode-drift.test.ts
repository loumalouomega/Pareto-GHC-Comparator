import { test } from "vitest";
import assert from "node:assert/strict";
import {
  assessDrift,
  driftBody,
  driftMarker,
  driftTitle,
  type SmokeReport,
} from "../src/opencodeDrift";

/** A lane that listed models the way the pinned contract expects. */
const healthy = (over: SmokeReport = {}): SmokeReport => ({
  ok: true,
  method: "npm",
  total: { total: 143, free: 22, variants: 124 },
  cliVersion: "1.18.30",
  ...over,
});
/** A lane that failed with a shape-level kind, as a real break would. */
const broken = (over: SmokeReport = {}): SmokeReport => ({
  ok: false,
  method: "script",
  failures: ["discovery"],
  kind: "parse",
  fingerprint: "list schema v1 envelope=true records=0",
  cliVersion: "2.0.16",
  ...over,
});

test("a real break is pinned-healthy plus latest-shape-failed", () => {
  const drift = assessDrift(healthy(), broken());
  assert.equal(drift.verdict, "drift");
  assert.equal(drift.report, true);
  // The issue has to name the kind, the version, and that both surfaces failed.
  assert.match(drift.summary, /parse/);
  assert.match(drift.summary, /2\.0\.16/);
  assert.match(
    assessDrift(healthy(), broken({ kind: "command", fallbackKind: "parse" })).summary,
    /command \(2\.x surface also parse\)/,
  );
});

test("only the combination counts: a healthy latest is never a drift", () => {
  const ok = assessDrift(healthy(), healthy({ method: "script", cliVersion: "2.0.16" }));
  assert.equal(ok.verdict, "healthy");
  assert.equal(ok.report, false);
  // A lane that lists no models at all is not evidence of anything.
  assert.equal(assessDrift(undefined, undefined).verdict, "no-evidence");
  assert.equal(assessDrift(undefined, broken()).report, false);
  assert.equal(assessDrift(healthy(), undefined).report, false);
  assert.equal(assessDrift({}, broken()).verdict, "no-evidence");
});

test("an unreadable or empty lane is never filed as drift", () => {
  // A download or install failure produces a report with no `ok` at all.
  const noEvidence = assessDrift(healthy(), { method: "script" });
  assert.equal(noEvidence.verdict, "no-evidence");
  assert.equal(noEvidence.report, false);
  assert.match(noEvidence.summary, /install or download failure/);
  // A timeout or an unresolvable binary is what an outage looks like from here.
  for (const kind of ["timeout", "missing"]) {
    const external = assessDrift(healthy(), broken({ kind }));
    assert.equal(external.verdict, "latest-external");
    assert.equal(external.report, false);
    assert.match(external.summary, /not filed/);
  }
  // No models connected is a normal state, not a shape change.
  const empty = assessDrift(healthy(), broken({ kind: "empty", fingerprint: undefined }));
  assert.equal(empty.verdict, "latest-empty");
  assert.equal(empty.report, false);
});

test("a broken pinned lane is checked as our own regression, and outranks upstream", () => {
  const pinnedBroken = assessDrift(broken({ method: "npm", cliVersion: "1.18.30" }), broken());
  assert.equal(pinnedBroken.verdict, "pinned-broken");
  assert.equal(pinnedBroken.report, true);
  assert.match(pinnedBroken.summary, /our own boundary/);
  // When only the pinned lane fails, that conclusion is safe to state outright.
  const onlyPinned = assessDrift(
    broken({ method: "npm", cliVersion: "1.18.30" }),
    healthy({ method: "script", cliVersion: "2.0.16" }),
  );
  assert.match(onlyPinned.summary, /this is our regression, not an upstream break/);
  // When neither lane lists models the cause is genuinely ambiguous, and the
  // summary must not pretend otherwise: an emptied free-tier catalog looks the
  // same as a broken parser from here.
  const neither = assessDrift(
    broken({ method: "npm", cliVersion: "1.18.30" }),
    broken({ method: "script" }),
  );
  assert.equal(neither.verdict, "pinned-broken");
  assert.match(neither.summary, /at least as likely/);
  assert.ok(!/this is our regression/.test(neither.summary));
});

test("a crash outside the boundary is filed, not treated as an outage", () => {
  const crashed = assessDrift(healthy(), broken({ kind: "unexpected", fingerprint: undefined }));
  assert.equal(crashed.verdict, "drift");
  assert.equal(crashed.report, true);
  assert.match(crashed.summary, /unexpectedly/);
});

test("a degraded report with absent fields still classifies and reads cleanly", () => {
  // A report can be thin: an older script version, a truncated file, or a lane
  // that failed before it recorded anything. Every absent field has to degrade
  // to a stated value rather than printing "undefined".
  const thin = { ok: false } as SmokeReport;
  const pinnedThin = assessDrift(thin, broken());
  assert.equal(pinnedThin.verdict, "pinned-broken");
  assert.match(pinnedThin.summary, /kind unknown/);
  // A latest lane that failed without recording a kind cannot be attributed to
  // an outage, so it is filed rather than dismissed.
  const unkinded = assessDrift(healthy(), thin);
  assert.equal(unkinded.verdict, "drift");
  assert.match(unkinded.summary, /"unknown"/);
  // A clean success that reports no row counts is not evidence of a listing:
  // the counts are the only thing that distinguishes "listed" from "unknown".
  assert.equal(assessDrift({ ok: true }, broken()).verdict, "pinned-broken");
  // Absent sub-counts read as zero rather than as "undefined".
  const noFree = assessDrift(healthy(), healthy({ method: "script", total: { total: 5 } }));
  assert.equal(noFree.verdict, "healthy");
  assert.match(noFree.summary, /5 rows, 0 free-tier/);
  // A drift summary with no version says so instead of inventing one.
  assert.match(
    assessDrift(healthy(), broken({ cliVersion: undefined })).summary,
    /OpenCode CLI unknown/,
  );
  const body = driftBody(assessDrift(healthy(), thin));
  assert.match(body, /`—`/);
  assert.match(body, /unknown/);
  assert.ok(!body.includes("undefined"));
});

test("the issue body carries the evidence and leaks nothing else", () => {
  const body = driftBody(assessDrift(healthy(), broken()));
  assert.ok(body.includes(driftMarker));
  assert.equal(driftTitle.startsWith("[drift]"), true);
  assert.match(body, /Pinned 1\.x \(npm\)/);
  assert.match(body, /Latest \(install script\)/);
  assert.match(body, /`parse`/);
  assert.match(body, /2\.0\.16/);
  assert.match(body, /list schema v1 envelope=true records=0/);
  // A lane with no report is shown as such rather than as a silent pass.
  assert.match(
    driftBody(assessDrift(healthy(), { method: "script" })),
    /_no report \(install\/download failure\)_/,
  );
  // The body quotes counters and counts, never a model id, name, rate, or path.
  assert.ok(!/\/home\/|\/Users\/|sk-/.test(body));
});
