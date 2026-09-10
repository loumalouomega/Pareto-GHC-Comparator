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

### Tier 1 — Support OpenCode alongside GitHub Copilot

**Admission criterion:** Extend model comparison to another client while retaining trustworthy availability, benchmark matching, and cost estimates.

**Outcome:** Users can compare models configured for OpenCode using the existing benchmark and Pareto workflow. The initial scope is an OpenCode source within the desktop VS Code extension; a standalone terminal UI or OpenCode-native UI requires a separate proposal.

**Current gap:** Discovery calls `vscode.lm.selectChatModels({ vendor: "copilot" })` in `src/extension.ts`. Model identity, catalog pricing, billing modes, saved options, and UI wording currently assume Copilot. OpenCode integration and its pricing sources have not yet been verified.

#### Verify and specify the OpenCode integration

**Effort:** S. **Dependencies:** None; the contributor guidance and changelog baseline are in place.

**Deliverables:**

- Inspect current official OpenCode documentation and validate a supported discovery mechanism with a small local experiment. Record supported versions, prerequisites, and whether a local service, command, or configuration read is required.
- Specify how to distinguish configured/usable models from a public catalog, preserve provider/model identifiers and reasoning variants, and report unavailable discovery without implying that catalog presence proves access.
- Identify authoritative pricing sources and units for the providers supported initially. Record unsupported billing arrangements, missing rates, caching semantics, and context limits.
- Write an integration decision document under `docs/` covering the chosen boundary, minimal data contract, credential handling, failure states, and a bounded initial provider scope. Link it here before implementation.

**Acceptance criteria:**

- A reproducible discovery example identifies models without an inference request or disclosure of credentials.
- The decision document cites the documentation/version checked and states which availability and pricing facts can actually be established.
- Initial supported providers and the cost formula are explicit. Any missing capability is recorded as a blocker or a visible unsupported state, rather than filled in by assumption.

#### Introduce source-aware discovery and comparison

**Effort:** M. **Dependencies:** Accepted integration decision and reproducible discovery example.

**Deliverables:**

- Extract the existing Copilot discovery behind a source interface and implement the verified OpenCode adapter. Add an explicit source selector and actionable setup, empty, and error states.
- Namespace model identities and manual benchmark overrides by source/provider/model so identical model names cannot collide. Preserve explicit benchmark-family matching and user selection for ambiguous variants.
- Add the verified OpenCode pricing representation and clearly labeled cost units. Keep Copilot credits and legacy multipliers specific to Copilot; leave unsupported prices unresolved and excluded from cost-based comparisons.
- Scope charts, recommendations, budgets, and workload profiles to a compatible source and billing unit. Migrate existing options, profiles, and overrides to Copilot defaults without losing user choices.
- Ensure switching sources cannot display late discovery results, mappings, or budgets from the previously selected source.

**Acceptance criteria:**

- Fixture-based tests cover discovery success/failure, provider identity collisions, ambiguous mappings, unknown pricing, supported cost formulas, source switching, and migration of existing saved state.
- Existing Copilot comparisons, recommendations, and saved workloads retain their behavior after migration.
- OpenCode rows use verified provider pricing and explicit units; unavailable models and missing benchmarks/prices have visible explanations.
- Credentials and full provider configurations never enter webview state, logs, fixtures, or exported documentation. The adapter performs no inference or automatic model switching.

#### Validate and document the OpenCode workflow

**Effort:** M. **Dependencies:** Source-aware implementation.

**Deliverables:**

- Add browser coverage for source selection, OpenCode setup/error states, mapping selection, pricing labels, and source-specific saved workloads.
- Document prerequisites, supported versions/providers, discovery limitations, pricing assumptions, refresh behavior, and any new local access or network activity in the README.
- Run the existing type checks, unit/host tests, build, browser tests, and packaging checks. Perform a real OpenCode smoke test using the documented setup and a Copilot regression smoke test; record environment and results without credentials.
- Update contributor guidance and the changelog with the verified integration boundary and support limitations.

**Acceptance criteria:**

- A user following the README can discover configured OpenCode models, resolve a benchmark variant, compare a priced model, and save/reapply a workload.
- Automated checks pass and the packaged extension contains the required assets. Real-environment smoke-test results are recorded; unavailable credentials are reported as outstanding validation, not a passing test.
- Documentation accurately distinguishes configured availability, benchmark quality, estimated workload cost, and actual account billing.

### Tier 2 — Documented verification with Vitest

**Admission criterion:** Strengthen the test and documentation workflow without changing product behavior. Tiers are ordered, so this follows the OpenCode work; it may be pulled forward if test maintenance becomes the bottleneck.

**Outcome:** Unit and mocked host tests run under Vitest with coverage, and a contributor following the docs can run the full verification workflow (focused tests, coverage, type-check, build, browser tests) without tribal knowledge.

**Current gap:** Unit and mocked host tests use `node:test` via `tsx` (`npm test` runs `test/*.test.ts`); Vitest is not a dependency and there is no coverage reporting. The verification workflow is described only briefly in the README development section, and there is no dedicated testing document.

#### Adopt Vitest and document the verification workflow

**Effort:** S. **Dependencies:** None; product behavior and existing test cases are unchanged.

**Deliverables:**

- Add Vitest as a dev dependency, migrate the existing `test/*.test.ts` unit and mocked host tests to it, and wire `npm test` (and any watch/coverage scripts) to Vitest. Keep the Playwright browser tests in `test/webview.spec.ts` as-is.
- Enable coverage for the migrated suite with an explicit threshold policy so new logic without regression coverage fails the check. Keep the meaningful-behavior-and-failure-cases coverage rule from the contributor guidance.
- Create the missing testing documentation: how to run focused tests, read coverage, and run the full validation sequence (type-check, unit/host tests, build, browser tests, packaging) for logic, UI, and release changes. Record it in the README development section and in `AGENTS.md` validation rules.
- Update CI to run the Vitest command and upload coverage results on failure, preserving the no-API-key property of automated tests.

**Acceptance criteria:**

- The migrated suite covers the same behavior as the current `node:test` suite (Pareto ties and dominance, filtering, pricing formulas and thresholds, mappings, API failures, recommendations, profiles, messages) and all tests pass under Vitest in CI.
- Coverage thresholds are enforced; a change that adds logic without tests fails the check with an actionable message.
- A contributor following only the docs can run a single test file, the full suite with coverage, and the complete pre-release validation without asking for help.
- Documentation states what automated tests do not prove (real-account model discovery, real API access), matching the existing smoke-test policy.

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

- **OpenCode discovery and provider coverage:** No supported integration mechanism or provider scope is assumed yet. The Tier 1 investigation must establish these before implementation; unsupported providers remain visibly unsupported until discovery and pricing can be verified.
