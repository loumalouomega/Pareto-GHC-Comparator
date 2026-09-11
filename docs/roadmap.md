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

No open items. Earlier per-model chart control and static known-model registry work is implemented, as are the Tier 1 comparator-depth tasks (freshness alert, cost-per-quality sort, snapshot/badge exports, benchmark drift, OpenCode BYOK rates) and the Tier 2 personal-usage tasks (measured-history panel, workload prefill, used-models overlay, budget suggestion, per-workspace breakdown); verified behavior is recorded in AGENTS.md and user-visible changes in CHANGELOG.md.

## Non-goals / known constraints

### Product boundaries

- **Running benchmarks or sending inference requests:** Comparison uses published benchmark data and illustrative workloads. Reconsider only with an explicit execution feature proposal defining consent, spending limits, credential handling, and reproducibility.
- **Automatically selecting a model in Copilot or OpenCode:** The initial integration compares models and lets users copy their names. Reconsider when a supported client API and an explicit user-controlled switching workflow are verified.
- **Standalone OpenCode or terminal UI:** This extension stays a VS Code product. Reconsider a separate interface after discovery, pricing, and shared comparison logic are validated and there is a concrete request for that interface.
- **Local usage reads without consent:** Implemented local usage reads happen only after an explicit opt-in command, with background refresh gated behind visible notice and disable, local-only processing, and no telemetry or uploads. Reconsider broader or default-on reads only with the same guarantees plus a privacy review.

### Data and billing constraints

- **Inferring unknown prices or reasoning configurations:** Similar names do not establish identical rates or benchmark variants. Reconsider individual mappings only when authoritative identifiers, configuration data, or explicit user selections resolve the ambiguity.
- **Predicting actual bills or task completion cost:** Fixed token workloads do not account for model-specific token consumption, subscriptions, remaining allowances, or negotiated rates. Implemented local history is limited to consented workload prefill and read-only past estimates with an estimates-are-not-bills disclaimer (missing fields stay null; hidden system/context tokens and tokenizer mismatch disclosed). Reconsider forward bill prediction only with trustworthy account data and a clearly defined estimation model.
- **Comparing incompatible cost units on one frontier:** Credits, premium requests, and provider currency costs are not interchangeable. Reconsider a combined view only after a documented conversion makes the values comparable without hiding plan assumptions.

### Integration constraints to verify

- **OpenCode provider coverage and platforms:** discovery via `opencode models --verbose` and Zen-gateway USD pricing are implemented. Direct (BYOK) providers are priced only from explicit user-supplied rates with provenance labels; macOS/Windows binary resolution is untested.
- **Local session-schema stability:** VS Code exposes no public token API; `chatSessions` JSONL fields, `resolvedModel` naming, and Insiders paths may change, and local files omit hidden system/context tokens. The local parser therefore tolerates missing fields, versions its parser, and discloses estimation limits rather than inventing counts.
