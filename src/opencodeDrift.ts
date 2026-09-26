/**
 * Classification for the weekly OpenCode schema-drift lane.
 *
 * The signal is never a single run: a real upstream break is *the pinned lane
 * healthy while the latest lane is not*. Anything that could be explained by
 * opencode.ai being unreachable, by a download failing, or by there being no
 * provider connected is deliberately not a drift signal, because a lane that
 * pages on an outage is a lane people learn to ignore.
 *
 * Pure and vscode-free: it takes the two sanitized smoke reports and returns
 * what (if anything) to file, plus the annotations to leave either way. Nothing
 * here performs I/O; `scripts/opencode-drift-report.ts` does that.
 */

/** The sanitized shape `scripts/opencode-smoke.ts` prints. */
export interface SmokeReport {
  ok?: boolean;
  method?: string;
  failures?: string[];
  /** `OpenCodeFailure`, or "unexpected" for a crash outside the boundary. */
  kind?: string;
  /** The 2.x surface's outcome when the 1.x one failed first. */
  fallbackKind?: string;
  /** Content-free shape counters; never ids, names, rates, or keys. */
  fingerprint?: string;
  cliVersion?: string;
  total?: { total?: number; free?: number; variants?: number };
}

/** What a lane outcome means, independent of any GitHub concept. */
export type DriftVerdict =
  /** A pinned install cannot list either: our own regression, not upstream's. */
  | "pinned-broken"
  /** Pinned lists, latest does not, and the reason is shape-level. */
  | "drift"
  /** Latest failed for a reason an outage or a cold machine explains. */
  | "latest-external"
  /** Latest simply found no models; not a shape change. */
  | "latest-empty"
  /** The lane could not obtain a listing to judge (install/download failure). */
  | "no-evidence"
  /** Everything listed as expected. */
  | "healthy";

export interface DriftAssessment {
  verdict: DriftVerdict;
  /** Whether this verdict should file or update an issue. */
  report: boolean;
  /** One line naming the class, for a run annotation. */
  summary: string;
  /** The lanes this verdict was drawn from, for the issue body. */
  lanes: { pinned?: SmokeReport; latest?: SmokeReport };
}

/** Failure kinds that mean the command or its output shape changed. */
const shapeKinds = new Set(["parse", "command"]);

/** A lane failed only for a reason outside the client's control. */
const externalKinds = new Set(["timeout", "missing"]);

/** A report we could not read at all: the install or download step failed. */
const unreadable = (report: SmokeReport | undefined): boolean =>
  !report || typeof report.ok !== "boolean";

/** A healthy lane lists models, so an empty listing is a distinct outcome. */
const listsModels = (report: SmokeReport): boolean =>
  report.ok === true && (report.total?.total ?? 0) > 0;

export function assessDrift(
  pinned: SmokeReport | undefined,
  latest: SmokeReport | undefined,
): DriftAssessment {
  const lanes = { pinned, latest };
  // An unreadable lane is an install or network problem. Say so and file
  // nothing: the whole point of the lane is to be trustworthy when it speaks.
  if (unreadable(pinned) || unreadable(latest))
    return {
      verdict: "no-evidence",
      report: false,
      summary: unreadable(pinned)
        ? "Pinned lane produced no report (install or download failure); nothing to compare."
        : "Latest lane produced no report (install or download failure); nothing to compare.",
      lanes,
    };

  // Our own regression outranks an upstream one: if the pinned contract
  // fixture cannot list, the parser is the first thing to check.
  if (!listsModels(pinned!))
    return {
      verdict: "pinned-broken",
      report: true,
      summary: `Pinned 1.x lane cannot list (kind ${pinned!.kind ?? "unknown"}); check our own boundary first${
        listsModels(latest!)
          ? " — the latest lane is fine, so this is our regression, not an upstream break"
          : " — note that neither lane lists models, so a shared cause such as the free-tier catalog being empty is at least as likely"
      }.`,
      lanes,
    };

  if (listsModels(latest!)) {
    const free = latest!.total?.free ?? 0;
    return {
      verdict: "healthy",
      report: false,
      summary: `Pinned and latest both list models (${latest!.total?.total} rows, ${free} free-tier).`,
      lanes,
    };
  }

  const kind = latest!.kind ?? "unknown";
  // A timeout or an unresolvable binary is what a stalled or unreachable
  // opencode.ai looks like from here, so it is annotated, never filed.
  if (externalKinds.has(kind))
    return {
      verdict: "latest-external",
      report: false,
      summary: `Latest lane failed with "${kind}", which an unreachable or slow opencode.ai explains as readily as a shape change; not filed.`,
      lanes,
    };

  if (kind === "empty")
    return {
      verdict: "latest-empty",
      report: false,
      summary:
        "Latest lane listed no models. That is a normal no-provider state, not a shape change; not filed.",
      lanes,
    };

  if (shapeKinds.has(kind))
    return {
      verdict: "drift",
      report: true,
      summary: `Pinned 1.x lists models but latest does not: ${kind}${
        latest!.fallbackKind ? ` (2.x surface also ${latest!.fallbackKind})` : ""
      } on OpenCode CLI ${latest!.cliVersion ?? "unknown"}.`,
      lanes,
    };

  // A crash outside the boundary is worth filing: it is not an outage.
  return {
    verdict: "drift",
    report: true,
    summary: `Pinned 1.x lists models but latest failed unexpectedly ("${kind}") on OpenCode CLI ${latest!.cliVersion ?? "unknown"}.`,
    lanes,
  };
}

/** Marker embedded in every filed issue body, so repeats update one issue. */
export const driftMarker = "<!-- pareto-ghc-opencode-schema-drift -->";

/** The title of the single tracked drift issue. */
export const driftTitle =
  "[drift] OpenCode model listing output shape changed upstream";

/**
 * The issue body. Carries what a maintainer needs to act without rerunning
 * anything locally: both lane outcomes, the failure kinds, the detected
 * version, and the content-free counters. Deliberately no paths, ids, names,
 * rates, or configuration.
 */
export function driftBody(assessment: DriftAssessment): string {
  const row = (label: string, report: SmokeReport | undefined) => {
    if (!report || typeof report.ok !== "boolean")
      return `| ${label} | _no report (install/download failure)_ | — | — | — | — |`;
    return `| ${label} | ${report.ok ? "ok" : "failed"} | \`${report.kind ?? "—"}\` | \`${
      report.fallbackKind ?? "—"
    }\` | ${report.cliVersion ?? "unknown"} | ${report.total?.total ?? 0} rows / ${
      report.total?.free ?? 0
    } free / ${report.total?.variants ?? 0} variants |`;
  };
  return [
    driftMarker,
    "The weekly non-gating OpenCode schema-drift lane found that the current OpenCode",
    "release no longer lists models the way the pinned release does. This lane is a",
    "signal, not a release gate: nothing is published or blocked on it.",
    "",
    `**Assessment:** ${assessment.summary}`,
    "",
    "| Lane | Result | Failure kind | 2.x surface | CLI version | Listing |",
    "| --- | --- | --- | --- | --- | --- |",
    row("Pinned 1.x (npm)", assessment.lanes.pinned),
    row("Latest (install script)", assessment.lanes.latest),
    "",
    "**Content-free shape counters** (field presence and counts only — no model",
    "ids, names, rates, or configuration):",
    "",
    "```",
    assessment.lanes.latest?.fingerprint ?? "_none reported_",
    "```",
    "",
    "Filed automatically by the weekly schema-drift lane. Add what you observe",
    "here; do not close until a pinned lane lists models again.",
  ].join("\n");
}
