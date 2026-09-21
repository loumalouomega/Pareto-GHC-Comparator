# Roadmap

Candidate features for future Pareto GHC Comparator releases, prioritized by value versus effort given what the extension already ships.

This page is aspirational, not a commitment. Items may be reordered, rescoped, or dropped. Effort is a rough order of magnitude: **S** (a day or two), **M** (roughly a week), **L** (multiple weeks). Estimates include implementation, documentation, and validation.

## How this file works

- Tiers are ordered by recommended execution order. Each tier states its admission criterion; tasks within a tier follow dependency order.
- Each task defines the current gap, deliverables, dependencies, and acceptance criteria. Reference tasks by name rather than their position in the list.
- Remove completed tasks after recording verified implementation guidance in `AGENTS.md` and user-visible changes in `CHANGELOG.md`. Remove empty tiers. This file tracks only candidate future work — it does not keep a running summary of what already shipped; `AGENTS.md` is the record of current verified behavior and `CHANGELOG.md` of what changed and when.
- Link a corresponding GitHub issue when one exists. The issue holds the request and discussion; this file defines the proposed scope. Verify claims against the code before treating them as implemented behavior.
- Former non-goals are reconsidered below as delivery candidates or feasibility investigations. Keep data integrity and consent requirements as acceptance criteria, rather than treating whole feature areas as permanently excluded.
- Feasibility investigations must establish feasibility before implementation is scheduled; listing one does not authorize inference, spending, account changes, or additional data collection.

Below, Tier 1 is new delivery candidates that meet the "Requirements across future work" principles. Tier 2 is feasibility investigations that must establish feasibility before delivery is scheduled.

## Tier 1 — New delivery candidates

Admission criterion: new user value that meets every "Requirements across future work" principle below, with no new default-on data collection and no inferred prices or configurations.

### Benchmark uncertainty and drift noise threshold — M

- **Gap:** scores are shown as single numbers with no confidence interval, and `src/drift.ts` reports every delta between snapshots verbatim, however small.
- **Deliverables:** show a published confidence interval only where the upstream source (Artificial Analysis) actually reports one — otherwise label "no interval published," never fabricate one; add a documented noise threshold below which a drift delta is labelled "within measurement noise" instead of implying a real change.
- **Dependencies:** `src/drift.ts`; whatever interval data Artificial Analysis's API actually exposes (verify before committing to delivery — may need a short feasibility check first).
- **Acceptance:** no interval is invented for a source that doesn't publish one. The noise threshold is documented and covered by a drift test at and around the boundary.

### Workload sensitivity view — M

- **Gap:** the Pareto frontier is computed for one fixed workload/token-mix at a time; there's no way to see how sensitive the ranking is to that assumption.
- **Deliverables:** an optional view that sweeps the input:output token ratio (and/or request volume) across a range and shows where frontier membership or the top recommendation changes, clearly labelled as a what-if sweep, never a measured cost.
- **Dependencies:** existing Pareto frontier computation (`src/compare.ts`/`src/comparison.ts`); existing per-task fixed-mix chart view.
- **Acceptance:** the sweep never claims to be observed data; it's clearly distinguished from the Usage tab's actual measured history.

### Watchlist change alerts — M

- **Gap:** users must manually reopen the panel to notice a pinned model's price, score, mapping or availability changed between refreshes.
- **Deliverables:** an opt-in notification (VS Code information message) on refresh when a pinned/watched model's price, benchmark score, mapping status, or availability changes since the last snapshot, citing both the old and new snapshot per `src/drift.ts`.
- **Dependencies:** `src/drift.ts`'s existing snapshot retention; existing pin storage.
- **Acceptance:** off by default (opt-in); no alert fires from noise-threshold-sized drift once Benchmark uncertainty and drift noise threshold is delivered; alert text cites both snapshot dates.

### Snapshot import (read-only reopen) — M

- **Gap:** exported snapshot JSON can be shared but never reloaded into the extension to inspect what was compared at export time.
- **Deliverables:** an **Import snapshot** command/webview action that loads a previously exported snapshot JSON and renders it read-only, clearly labelled as historical (not live data), validated against the snapshot schema version with a clear error for an incompatible or corrupted file.
- **Dependencies:** the snapshot export format defined in `src/export.ts` (snapshot schema version 3 with the `kind` discriminator).
- **Acceptance:** an imported snapshot can never be mistaken for live data in the UI; a version mismatch fails with an explanatory message rather than misrendering.

### Additional editor storage roots — M

- **Gap:** local usage scanning only looks at `Code` and `Code - Insiders` workspace storage roots (`src/usage.ts`'s storage-root resolution); VSCodium, Cursor, and Remote/WSL/devcontainer hosts running Copilot are invisible to it.
- **Deliverables:** add discovery for additional known editor storage roots, each gated by its own explicit opt-in and a stated purpose (per the consent requirement — no root is scanned just because it was found).
- **Dependencies:** the consent/watch flow in `src/extension.ts`.
- **Acceptance:** no additional root is read before its own explicit consent; each root's data is labelled by its source editor in the Usage tab.

### Accessibility pass — M

- **Gap:** the comparison chart is canvas-rendered with no documented keyboard or screen-reader path, and no colour-blind-safe palette check has been done.
- **Deliverables:** keyboard navigation for chart points and the results table; an accessible data-table alternative that exposes the same information the chart shows; a colour-blind-safe palette with non-colour (shape/pattern) frontier markers.
- **Dependencies:** existing table view and chart rendering in `webview/main.ts`.
- **Acceptance:** every chart-only piece of information (frontier membership, quadrant highlight) is also available through the accessible table.

## Tier 2 — Feasibility investigations

Admission criterion: establish supported data access, an explicit consent model, and a validation approach before delivery is scheduled. Effort below covers investigation only; listing one does not authorize inference, spending, account changes, or additional data collection.

### Local usage from other assistant clients — S investigation

- **Gap:** local usage history currently covers only GitHub Copilot chat sessions; OpenCode and Claude Code both keep local session history of their own, unread today.
- **Deliverables:** determine whether each client's session storage format is documented and stable enough to read, what an explicit opt-in and stated purpose would look like per client, and how its units would stay separate from Copilot's (never merged into one figure).
- **Dependencies:** each client's own storage format, undocumented and therefore unverified today.
- **Acceptance:** produce a supported/unsupported verdict per client and a delivery recommendation; no reads are implemented until a follow-up task explicitly schedules delivery.

### Team usage aggregation — S investigation

- **Gap:** usage history is single-machine only; teams that want an aggregate view have no supported path today.
- **Deliverables:** investigate merging user-exported, explicitly-shared, anonymized usage summaries (no network collection by the extension itself) — covering de-identification, consent per contributor, and unit compatibility across contributors' different plans.
- **Dependencies:** a well-formed export to merge — snapshot JSON (`src/export.ts`) or stored usage summaries (`src/usage.ts`).
- **Acceptance:** a written recommendation covering privacy, consent, and whether merged data can stay honestly comparable across differing plans/units; no aggregation is implemented from this task alone.

### Upstream schema change early warning — S investigation

- **Gap:** a Copilot Chat or OpenCode release that changes its session/tier-info shape is discovered only when a user hits `unsupported`/`unrecognized` output.
- **Deliverables:** evaluate a CI job that runs the existing fixtures against newly released Copilot Chat and OpenCode versions (in an isolated, credential-free environment) to catch schema drift before users do.
- **Dependencies:** the shipped schema fingerprinting (`UsageSchemaFingerprint` in `src/usage.ts`, `fingerprintOpenCodeOutput` in `src/opencode.ts`); existing three-platform CI discovery jobs.
- **Acceptance:** a feasibility verdict on whether such a job can run without real credentials or an account, and a recommendation on cadence and alerting.

## Requirements across future work

These remain the acceptance requirements every task above and any future candidate must satisfy, while former product exclusions continue to be reconsidered as delivery candidates or feasibility investigations rather than permanent exclusions:

- **Consent and local data:** Keep local usage reads opt-in, visibly indicate watching, and retain disable/erase controls. Broader data sources need explicit opt-in and a stated purpose; convenience is not a reason for silent default-on scanning.
- **Evidence and uncertainty:** Do not infer prices or reasoning configurations from display-name similarity. Keep unknowns visible and distinguish observed zero counts from missing fields and legacy estimates.
- **Honest comparisons:** Preserve cost units, workload assumptions, benchmark variants, and pricing provenance. A shared currency label alone does not make different billing models or task workloads comparable. The comparison overlay view is the one place a USD-equivalent axis stands in for mismatched native units, and even there it stays explicitly labelled, drops what it can't convert (legacy premium requests) rather than mixing it in, and withholds the combined frontier when the two options' workloads or bases still don't match.
- **Supported integrations:** Record evidence and validation gaps by client/platform. Treat session schemas and external capabilities as versioned dependencies, and degrade with actionable explanations when they change.
