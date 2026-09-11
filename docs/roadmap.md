# Roadmap

Candidate features for future Pareto GHC Comparator releases, prioritized by value versus effort given what the extension already ships.

This page is aspirational, not a commitment. Items may be reordered, rescoped, or dropped. Effort is a rough order of magnitude: **S** (a day or two), **M** (roughly a week), **L** (multiple weeks). Estimates include implementation, documentation, and validation.

## How this file works

- Tiers are ordered by recommended execution order. Each tier states its admission criterion; tasks within a tier follow dependency order.
- Each task defines the current gap, deliverables, dependencies, and acceptance criteria. Reference tasks by name rather than their position in the list.
- Remove completed tasks after recording verified implementation guidance in `AGENTS.md` and user-visible changes in `CHANGELOG.md`. Remove empty tiers.
- Link a corresponding GitHub issue when one exists. The issue holds the request and discussion; this file defines the proposed scope. Verify claims against the code before treating them as implemented behavior.
- Constraints below state what would justify reconsideration. Revisit them when their underlying assumptions change.

## Open items

Earlier per-model chart control and static known-model registry work is implemented; verified behavior is recorded in AGENTS.md and user-visible changes in CHANGELOG.md.

### Tier 1 — comparator depth without new filesystem access

Admission criterion: deepens analysis, freshness, or sharing without requiring additional local reads.

- **Catalog freshness alert (S):** Gap: stale rates fail silently. Deliverables: age check against `catalogDate` and `staticRegistryDate` with an update nudge. Dependencies: none. Acceptance: alert links to the maintaining guide and never blocks comparison.
- **Cost-per-quality sort (S):** Gap: frontier membership alone does not rank efficiency. Deliverables: optional cost-per-index-point sort with ties retained, reflected in table, recommendations, and CSV. Dependencies: none. Acceptance: null cost or score rows sort last with reasons.
- **Shareable snapshot and badge export (S):** Gap: comparisons cannot be pasted into reviews. Deliverables: JSON snapshot export plus shields-compatible badge payload for the active workload, via the save dialog with validated payloads. Dependencies: none. Acceptance: exports reflect displayed rows and state their illustrative basis.
- **Benchmark drift and history (M):** Gap: single snapshot hides score movement. Deliverables: versioned snapshot retention, per-model score deltas with retrieval dates, stale-data notice. Dependencies: none. Acceptance: deltas cite both snapshots; missing history shows unknown, not zero.
- **OpenCode BYOK rate import (M):** Gap: provider-billed OpenCode models stay unpriced. Deliverables: explicit user-supplied rate table for named BYOK providers with provenance labels, validated like static registries. Dependencies: none. Acceptance: supplied rates never mix with Zen USD frontier without a labeled conversion; invalid entries stay unresolved.

### Tier 2 — personal usage calibration (local-first)

Admission criterion: personalizes the comparison with the user's own history without changing the illustrative benchmark core. All reads stay local and consented; nothing leaves the machine.

- **Measured-history panel, read-only (M):** Gap: estimates use a fixed 1,000/1,000 mix with no ground truth about the user's requests. Deliverables: opt-in `Pareto GHC: Scan local Copilot usage` command plus background refresh with visible notice and disable; discovery of `chatSessions/*.jsonl` plus legacy `*.json` across stable and Insiders `workspaceStorage` roots; incremental size/mtime index in global state (no native database dependency in the VSIX); session-anchor plus per-request token parser with null — never invented — token counts; daily, per-session, and per-model aggregates with premium-request estimates reusing the catalog multipliers including the legacy rebase cutoff. Dependencies: none. Acceptance: unknown models fall back to a labeled estimate; missing token fields stay null with reasons; panel states the figures are local estimates, not bills; no auto-scan before first consent.
- **Usage-aware workload prefill (S):** Gap: users must hand-tune token inputs. Deliverables: `Use my average` action prefilling `tokens.input/output` from median observed prompt/output tokens, plus request-count context; never auto-overwrites; composes with profiles. Dependencies: Measured-history panel. Acceptance: prefill is explicit, reversible, and labeled with sample size and date range.
- **Used-models overlay (S):** Gap: chart does not show which models the user actually uses. Deliverables: request-count badges or dot sizing on Pareto rows, `Only my models` filter applied before frontier, preserved exclusion keys. Dependencies: Measured-history panel. Acceptance: counts reflect the filtered date range; zero-history models show no badge rather than zero.
- **Budget from reality (S):** Gap: budgets are guesses. Deliverables: suggested per-billing-unit budget from p90 observed task cost or last-30-day spend, shown as a suggestion alongside the manual input. Dependencies: Measured-history panel and Usage-aware workload prefill. Acceptance: suggestion cites its window and sample; manual budget always wins.
- **Per-workspace breakdown (M):** Gap: no per-repo view of usage. Deliverables: workspace resolution via `workspace.json` folder/workspace URIs (`file://` and `vscode-userdata:///` decoding, multi-root join), basename-only display option, per-workspace tokens and premium estimates. Dependencies: Measured-history panel. Acceptance: missing or unreadable mappings show the storage id with an explanation; paths are never transmitted.

## Non-goals / known constraints

### Product boundaries

- **Running benchmarks or sending inference requests:** Comparison uses published benchmark data and illustrative workloads. Reconsider only with an explicit execution feature proposal defining consent, spending limits, credential handling, and reproducibility.
- **Automatically selecting a model in Copilot or OpenCode:** The initial integration compares models and lets users copy their names. Reconsider when a supported client API and an explicit user-controlled switching workflow are verified.
- **Standalone OpenCode or terminal UI:** This extension stays a VS Code product. Reconsider a separate interface after discovery, pricing, and shared comparison logic are validated and there is a concrete request for that interface.
- **Local usage reads without consent:** Tier 2 proposes reading `workspaceStorage/chatSessions` only after an explicit opt-in command, with background refresh gated behind visible notice and disable, local-only processing, and no telemetry or uploads. Reconsider broader or default-on reads only with the same guarantees plus a privacy review.

### Data and billing constraints

- **Inferring unknown prices or reasoning configurations:** Similar names do not establish identical rates or benchmark variants. Reconsider individual mappings only when authoritative identifiers, configuration data, or explicit user selections resolve the ambiguity.
- **Predicting actual bills or task completion cost:** Fixed token workloads do not account for model-specific token consumption, subscriptions, remaining allowances, or negotiated rates. Tier 2 narrows this to consented local history used for workload prefill and read-only past estimates with an estimates-are-not-bills disclaimer (missing fields stay null; hidden system/context tokens and tokenizer mismatch disclosed). Reconsider forward bill prediction only with trustworthy account data and a clearly defined estimation model.
- **Comparing incompatible cost units on one frontier:** Credits, premium requests, and provider currency costs are not interchangeable. Reconsider a combined view only after a documented conversion makes the values comparable without hiding plan assumptions.

### Integration constraints to verify

- **OpenCode provider coverage and platforms:** discovery via `opencode models --verbose` and Zen-gateway USD pricing are implemented. Direct (BYOK) providers remain visibly unpriced until their rates are verified; macOS/Windows binary resolution is untested.
- **Local session-schema stability:** VS Code exposes no public token API; `chatSessions` JSONL fields, `resolvedModel` naming, and Insiders paths may change, and local files omit hidden system/context tokens. Tier 2 must therefore tolerate missing fields, version its parser, and disclose estimation limits rather than inventing counts.
