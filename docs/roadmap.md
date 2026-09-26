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

### 1.1 Claude Code local usage source — M task

- **Gap:** local usage history covers only GitHub Copilot chat sessions, while Claude Code keeps per-project transcripts carrying model, four disjoint token buckets, timestamp, workspace, and a `version` field (`docs/other-client-usage-investigation.md`).
- **Deliverables:** a per-root opt-in source beside Copilot's with its own consent record, unit, and tables; a `type`-keyed parser over the 14 observed record types that uses only `assistant` usage and handles `isSidechain`; workspace labels from `cwd` under the existing path rules; and the existing fingerprint/`unsupported` machinery, since no vendor schema is published.
- **Dependencies:** the transcript schema, observed on one version (2.1.280, Linux only) and not documented by the vendor — so delivery is gated on drift handling, not treated as a stable format.
- **Acceptance:** no read before explicit consent with a stated purpose; Claude figures never merge with Copilot credits or premium requests; client-reported cost fields are never adopted as prices; content is never retained; per-file fingerprints and file-an-issue guidance work as they do for Copilot.

## Requirements across future work

These remain the acceptance requirements every task above and any future candidate must satisfy, while former product exclusions continue to be reconsidered as delivery candidates or feasibility investigations rather than permanent exclusions:

- **Consent and local data:** Keep local usage reads opt-in, visibly indicate watching, and retain disable/erase controls. Broader data sources need explicit opt-in and a stated purpose; convenience is not a reason for silent default-on scanning.
- **Evidence and uncertainty:** Do not infer prices or reasoning configurations from display-name similarity. Keep unknowns visible and distinguish observed zero counts from missing fields and legacy estimates.
- **Honest comparisons:** Preserve cost units, workload assumptions, benchmark variants, and pricing provenance. A shared currency label alone does not make different billing models or task workloads comparable. The comparison overlay view is the one place a USD-equivalent axis stands in for mismatched native units, and even there it stays explicitly labelled, drops what it can't convert (legacy premium requests) rather than mixing it in, and withholds the combined frontier when the two options' workloads or bases still don't match.
- **Supported integrations:** Record evidence and validation gaps by client/platform. Treat session schemas and external capabilities as versioned dependencies, and degrade with actionable explanations when they change.
