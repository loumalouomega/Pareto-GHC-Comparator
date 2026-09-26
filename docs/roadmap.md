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

Below, Tier 1 is new delivery candidates that meet the "Requirements across future work" principles.

## Tier 1 — New delivery candidates

Admission criterion: new user value that meets every "Requirements across future work" principle below, with no new default-on data collection and no inferred prices or configurations.

### OpenCode v2 discovery compatibility — S task

- **Gap:** OpenCode v2.0.16 removed `opencode models --verbose` (`Unrecognized flag: --verbose`, exit 1), and the v2 listing carries no cost or variant metadata, so v2 users see no OpenCode models at all — a live user-facing break, verified in `docs/schema-drift-investigation.md`.
- **Deliverables:** establish what a v2 listing can honestly provide (the bare `provider/model` output has no USD rates and no variants), decide between a v2 parse path, a version-gated actionable error, or both, and keep the 1.18.30 contract fixture green.
- **Dependencies:** the v2 output surface, which is **not yet established** — a credential-free `opencode session list --format json` probe is the only documented machine-readable v2 surface found and returned no rows, so the first task is to establish what v2 actually offers.
- **Acceptance:** discovery works against the current OpenCode release or fails with a version-specific actionable message; CI's pinned and latest lanes report distinguishable outcomes, which **Weekly upstream schema-drift lane** owns — that lane is independent of this fix and would have caught this break first, so it can be built in either order (`docs/schema-drift-investigation.md`).

### Claude Code local usage source — M task

- **Gap:** local usage history covers only GitHub Copilot chat sessions, while Claude Code keeps per-project transcripts carrying model, four disjoint token buckets, timestamp, workspace, and a `version` field (`docs/other-client-usage-investigation.md`).
- **Deliverables:** a per-root opt-in source beside Copilot's with its own consent record, unit, and tables; a `type`-keyed parser over the 14 observed record types that uses only `assistant` usage and handles `isSidechain`; workspace labels from `cwd` under the existing path rules; and the existing fingerprint/`unsupported` machinery, since no vendor schema is published.
- **Dependencies:** the transcript schema, observed on one version (2.1.280, Linux only) and not documented by the vendor — so delivery is gated on drift handling, not treated as a stable format.
- **Acceptance:** no read before explicit consent with a stated purpose; Claude figures never merge with Copilot credits or premium requests; client-reported cost fields are never adopted as prices; content is never retained; per-file fingerprints and file-an-issue guidance work as they do for Copilot.

### Weekly upstream schema-drift lane — S task

- **Gap:** a release that changes a client's output shape is discovered by users, and the existing `opencode-smoke` job cannot tell a real break from an opencode.ai outage (`continue-on-error: true`, a pinned npm lane, no `schedule:` trigger).
- **Deliverables:** classify the existing `OpenCodeFailure` kinds and `fingerprintOpenCodeOutput` counters into distinguishable outcomes; add a weekly non-gating lane on latest (Linux only) alongside the pinned three-OS release gate; alert by opening or updating an issue rather than failing a release.
- **Dependencies:** the shipped fingerprinting in `src/usage.ts`/`src/opencode.ts` and the existing smoke matrix — the drift signal is the *combination* of a healthy pinned lane and an unhealthy latest lane. Independent of **OpenCode v2 discovery compatibility**: this lane reports the break, that task fixes it.
- **Acceptance:** a real output-shape change produces an issue naming the failure kind, sanitized counters, and the detected version; an install or network failure does not; no release depends on an external service. Copilot Chat's half stays on the existing user-reported fingerprint path and is recorded as **not automatable without an account**.

## Requirements across future work

These remain the acceptance requirements every task above and any future candidate must satisfy, while former product exclusions continue to be reconsidered as delivery candidates or feasibility investigations rather than permanent exclusions:

- **Consent and local data:** Keep local usage reads opt-in, visibly indicate watching, and retain disable/erase controls. Broader data sources need explicit opt-in and a stated purpose; convenience is not a reason for silent default-on scanning.
- **Evidence and uncertainty:** Do not infer prices or reasoning configurations from display-name similarity. Keep unknowns visible and distinguish observed zero counts from missing fields and legacy estimates.
- **Honest comparisons:** Preserve cost units, workload assumptions, benchmark variants, and pricing provenance. A shared currency label alone does not make different billing models or task workloads comparable. The comparison overlay view is the one place a USD-equivalent axis stands in for mismatched native units, and even there it stays explicitly labelled, drops what it can't convert (legacy premium requests) rather than mixing it in, and withholds the combined frontier when the two options' workloads or bases still don't match.
- **Supported integrations:** Record evidence and validation gaps by client/platform. Treat session schemas and external capabilities as versioned dependencies, and degrade with actionable explanations when they change.
