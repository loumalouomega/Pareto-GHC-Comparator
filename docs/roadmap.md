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

No open items. Tier 1 (per-model chart control and customization) and Tier 2 (additional assistant sources via static known-model registries) are implemented; verified behavior is recorded in AGENTS.md and user-visible changes in CHANGELOG.md.

## Non-goals / known constraints

### Product boundaries

- **Running benchmarks or sending inference requests:** Comparison uses published benchmark data and illustrative workloads. Reconsider only with an explicit execution feature proposal defining consent, spending limits, credential handling, and reproducibility.
- **Automatically selecting a model in Copilot or OpenCode:** The initial integration compares models and lets users copy their names. Reconsider when a supported client API and an explicit user-controlled switching workflow are verified.
- **Standalone OpenCode or terminal UI:** Tier 1 extends the current VS Code product. Reconsider a separate interface after discovery, pricing, and shared comparison logic are validated and there is a concrete request for that interface.

### Data and billing constraints

- **Inferring unknown prices or reasoning configurations:** Similar names do not establish identical rates or benchmark variants. Reconsider individual mappings only when authoritative identifiers, configuration data, or explicit user selections resolve the ambiguity.
- **Predicting actual bills or task completion cost:** Fixed token workloads do not account for model-specific token consumption, subscriptions, remaining allowances, or negotiated rates. Reconsider when trustworthy usage/account data and a clearly defined estimation model are available.
- **Comparing incompatible cost units on one frontier:** Credits, premium requests, and provider currency costs are not interchangeable. Reconsider a combined view only after a documented conversion makes the values comparable without hiding plan assumptions.

### Integration constraints to verify

- **OpenCode provider coverage and platforms:** discovery via `opencode models --verbose` and Zen-gateway USD pricing are implemented. Direct (BYOK) providers remain visibly unpriced until their rates are verified; macOS/Windows binary resolution is untested.
