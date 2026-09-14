# Roadmap

Candidate features for future Pareto GHC Comparator releases, prioritized by value versus effort given what the extension already ships.

This page is aspirational, not a commitment. Items may be reordered, rescoped, or dropped. Effort is a rough order of magnitude: **S** (a day or two), **M** (roughly a week), **L** (multiple weeks). Estimates include implementation, documentation, and validation.

## How this file works

- Tiers are ordered by recommended execution order. Each tier states its admission criterion; tasks within a tier follow dependency order.
- Each task defines the current gap, deliverables, dependencies, and acceptance criteria. Reference tasks by name rather than their position in the list.
- Remove completed tasks after recording verified implementation guidance in `AGENTS.md` and user-visible changes in `CHANGELOG.md`. Remove empty tiers. This file tracks only candidate future work — it does not keep a running summary of what already shipped; `AGENTS.md` is the record of current verified behavior and `CHANGELOG.md` of what changed and when.
- Link a corresponding GitHub issue when one exists. The issue holds the request and discussion; this file defines the proposed scope. Verify claims against the code before treating them as implemented behavior.
- Former non-goals are reconsidered below as delivery candidates or feasibility investigations. Keep data integrity and consent requirements as acceptance criteria, rather than treating whole feature areas as permanently excluded.
- Tier 2 investigations must establish feasibility before implementation is scheduled; listing them does not authorize inference, spending, account changes, or additional data collection.

## Tier 1 — Explicit assumptions and cost scenarios

Admission criterion: extend comparison using documented or user-supplied inputs, with visible provenance and uncertainty.

### Pricing and reasoning mapping assistance — M

- **Gap:** Unknown prices and ambiguous benchmark variants require manual intervention; similar names alone are insufficient evidence.
- **Deliverables:** Explain unresolved mappings and suggest candidates from authoritative identifiers and aliases. Provide an explicit review/apply/reset flow for user choices, with separate provenance for pricing and benchmark configuration; build on existing benchmark overrides and BYOK rates.
- **Dependencies:** Existing mapping validation and BYOK store; verified sources for any new catalog mappings.
- **Acceptance:** A benchmark choice never establishes a price. Suggested matches remain unresolved until verified or explicitly selected, overrides survive refresh, and disappearing variants prompt replacement/reset rather than silent substitution.

### Plan-aware spending scenarios — L

- **Gap:** Token estimates and history percentiles do not model subscription fees, included allowances, remaining balances, or negotiated rates.
- **Deliverables:** Optional what-if inputs for expected usage, plan fees, allowances, and overage rates. Report estimated ranges and assumptions separately from observed history and per-task token costs; label user inputs versus provider-verified data.
- **Dependencies:** Implemented option-comparison mode; documented billing rules for each supported plan. Account balance integration is a separate investigation, not a prerequisite for manual scenarios.
- **Acceptance:** Cover zero usage, allowance boundaries, missing plan data, and rate changes. Do not double-count subscriptions or describe projections as actual bills or measured task-completion costs. Unsupported plans remain unavailable rather than approximated from another provider.

### Comparable cost normalization — M

- **Gap:** Credits, premium requests, and USD cannot currently share a meaningful cost frontier.
- **Deliverables:** An optional common-currency estimate only where a documented conversion or explicit plan scenario supplies the needed assumptions. Retain original units and show conversion provenance, date, and allowance treatment.
- **Dependencies:** Implemented option-comparison mode; Plan-aware spending scenarios for allowance-dependent conversions.
- **Acceptance:** No implicit universal credit/request exchange rate. Missing or incompatible assumptions keep options in separate panels/frontiers. Test conversion arithmetic and allowance boundaries, and preserve original and converted values in exports.

## Tier 2 — Feasibility investigations

Admission criterion: establish a supported integration, concrete user workflow, and validation approach before committing to delivery. Effort below covers investigation only.

### User-controlled model switching — S investigation

- **Gap:** Copying a model name does not apply the selection in the assistant client.
- **Deliverables:** Verify supported APIs or commands for each client and prototype an explicit Apply action only where supported. Document account availability checks, variant handling, and failure feedback.
- **Dependencies:** A documented client integration and a way to verify the applied selection.
- **Acceptance:** Produce a supported/unsupported capability matrix and a delivery recommendation. Keep copy-name as fallback; do not silently switch models or edit undocumented configuration.

### Standalone comparison CLI — S investigation

- **Gap:** Shared comparison logic could serve terminal workflows, but discovery, secrets, storage, and exports are currently orchestrated by VS Code.
- **Deliverables:** Define a small CLI workflow using validated snapshots and explicit configuration, evaluate reuse of the pure comparator, and identify packaging and maintenance costs. Consider an interactive terminal UI only after the CLI workflow is justified.
- **Dependencies:** Existing pure comparison/export modules and an explicit host-independent data/credential boundary.
- **Acceptance:** Document a feasible input/output contract, offline behavior, and testing strategy. A prototype must not depend on VS Code global state or silently read editor credentials; conclude with a delivery recommendation.

### Opt-in measured evaluations — M investigation

- **Gap:** Published benchmark quality cannot establish performance or token consumption on a user's actual task.
- **Deliverables:** Design a small reproducible evaluation workflow with user-selected inputs, per-run model/configuration capture, explicit request and spending limits, cancellation, and separate measured results. Assess credential handling and which providers can enforce the proposed limits.
- **Dependencies:** Explicit execution scope, supported inference integrations, and a consent/data-handling design. This investigation itself requires no paid requests.
- **Acceptance:** Produce a feasibility decision and test plan before scheduling execution work. Clearly separate published benchmarks, local-history estimates, and measured results; no automatic project uploads, background inference, or unbounded spending.

## Requirements across future work

These remain acceptance requirements while the former product exclusions above become scoped candidates:

- **Consent and local data:** Keep local usage reads opt-in, visibly indicate watching, and retain disable/erase controls. Broader data sources need explicit opt-in and a stated purpose; convenience is not a reason for silent default-on scanning.
- **Evidence and uncertainty:** Do not infer prices or reasoning configurations from display-name similarity. Keep unknowns visible and distinguish observed zero counts from missing fields and legacy estimates.
- **Honest comparisons:** Preserve cost units, workload assumptions, benchmark variants, and pricing provenance. A shared currency label alone does not make different billing models or task workloads comparable.
- **Supported integrations:** Record evidence and validation gaps by client/platform. Treat session schemas and external capabilities as versioned dependencies, and degrade with actionable explanations when they change.
