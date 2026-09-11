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

### Tier 1 — Per-model chart control and customization

**Admission criterion:** Give each comparable model its own identity, color, and visibility without changing benchmark data, pricing math, or cost-unit separation.

**Outcome:** Users compare thinking-level variants as separate items, recognize one model across its variants by color, tune the chart display, and curate which models are compared.

**Current gap:** OpenCode reasoning variants are already separate rows, but each Copilot model resolves to a single tested benchmark variant; chart color is by provider, so variants of one model share only the provider hue; the chart has no display settings; the text filter is the only way to exclude a model.

#### Show one row per thinking level

**Effort:** M. **Dependencies:** None; single-variant mappings keep working unchanged.

**Deliverables:**

- Allow pinning multiple benchmark variants of the same model as separate comparable rows (e.g. GPT-5.4 high beside xhigh). OpenCode `#variant` rows already behave this way and stay as-is.
- Each row keeps its own mapping status, tested-variant label, cost tier, and frontier membership. Scores always come from the published variant; never invented or blended.
- Variant-scoped pins extend the override mechanism without breaking existing single-variant mappings; migration preserves current selections.

**Acceptance criteria:**

- A model with N pinned variants renders N rows with distinct tested variants and independent costs.
- Unpinning restores single-row behavior; stale pins fail closed like current overrides.
- Fixture tests cover pinning, cost separation, migration of existing mappings, and ambiguous-variant handling.

#### Color by base model across thinking levels

**Effort:** S. **Dependencies:** None; composes with row-per-thinking-level pins once those land.

**Deliverables:**

- Assign chart and table colors by base model (variant suffix stripped), so thinking levels of one model share a hue family (shaded per level) while different models are visually distinct.
- Keep provider information in labels and legend. Use a deterministic palette (stable across discovery order) that stays legible in light, dark, and high-contrast themes.

**Acceptance criteria:**

- The same base model at different thinking levels renders in one hue family; two different models never share an exact color in the same view.
- Browser tests cover all three themes; colors are stable across refreshes.

#### Chart display settings

**Effort:** S. **Dependencies:** Base-model color palette.

**Deliverables:**

- Persisted graphic settings: model labels on/off, Pareto frontier line on/off, and cost axis scale (auto/logarithmic/linear). Defaults reproduce current behavior.
- Settings live in options with migration defaults and apply without refetching data.

**Acceptance criteria:**

- Each toggle visibly changes the chart and persists across panel reopen; axis override is labeled on the chart.
- Unit and browser tests cover defaults, persistence, and migration.

#### Model checklist for included models

**Effort:** M. **Dependencies:** None.

**Deliverables:**

- A checkbox per discovered model, with select-all/none, controlling inclusion in the chart, table, frontier, and recommendations. Composes with the text filter: an excluded model stays hidden even when it matches.
- Inclusion state persists locally and survives refresh and rediscovery; newly discovered models default to included.
- Keyboard-accessible controls exposing the same values as the chart.

**Acceptance criteria:**

- Excluding the only comparable model yields the explicit empty state; frontier and recommendations recompute for the visible set.
- Browser tests cover toggling, persistence across reopen, and filter interplay.

#### Export comparison snapshot to CSV

**Effort:** S. **Dependencies:** None.

**Deliverables:**

- One-click export of the currently displayed rows (model, provider, tested variant, score, cost with unit, tier, frontier membership, recommendation, reasons) to a CSV file via the save dialog.

**Acceptance criteria:**

- Exported values match the table exactly, including missing-data reasons; the export reflects the active filter and checklist.

#### Export chart graphic as PNG

**Effort:** S. **Dependencies:** None; composes with chart display settings once those land (export reflects the visible chart).

**Deliverables:**

- One-click export of the currently rendered chart (points, frontier line, labels, legend, and axis titles as displayed) to a PNG file via the save dialog, at a fixed export resolution independent of panel size.
- Exported file contains no API keys or credentials; only the already-displayed values.

**Acceptance criteria:**

- The PNG matches the on-screen chart (same rows, scale, labels, and theme); hidden or filtered-out models do not appear.
- Browser tests cover the export trigger and file payload for light and dark themes.

#### Per-bucket cost breakdown in model details

**Effort:** S. **Dependencies:** None.

**Deliverables:**

- The details pane shows the arithmetic behind each estimate: per-bucket token counts × rates, tier applied, and divisor, labeled with the billing unit. Free-tier and unpriced states explain themselves instead of showing math.

**Acceptance criteria:**

- Breakdown numbers multiply out to the displayed cost for credits, legacy, and USD rows; unit tests cover each billing mode plus free and unpriced states.

#### Free-tier Zen comparison spotlight

**Effort:** S. **Dependencies:** None.

**Deliverables:**

- A one-click "Free tier only" view ranking the currently free OpenCode Zen models by benchmark score for the selected task preset, answering "is free good enough for this task?".
- A gap indicator reusing the near-best machinery: best-free score versus best-overall score, plus the cheapest paid model closing the gap.
- Free status always reflects the latest CLI discovery (a model can leave the free tier at any time), never a static list. Documentation notes free-tier availability is time-limited by the provider.

**Acceptance criteria:**

- The view lists only currently-free models with scores; paid and provider-billed models are excluded with the reason stated.
- The gap indicator names the best free model, its score, and how many index points it trails the best overall model.
- Fixture tests cover free-only filtering, gap math, and a model transitioning from free to paid between discoveries (latest discovery wins).

### Tier 2 — Additional assistant sources via static known-model registries

**Admission criterion:** Add comparison coverage for agentic coding assistants beyond Copilot and OpenCode (Claude Code, Codex, Gemini CLI, and similar) without live account discovery, CLI spawning, inference requests, or model switching.

**Outcome:** Users compare a priori known company models for Claude Code (Anthropic), Codex (OpenAI), Gemini CLI/Code Assist (Google), and similar assistants against the same Artificial Analysis benchmark snapshot and illustrative workloads. No sign-in, binary, or provider connection is required to view these registries.

**Current gap:** Only Copilot (live `vscode.lm` discovery plus dated pricing catalog) and OpenCode (live `opencode models --verbose` discovery plus live USD rates) are comparable. Other assistants have no source, even though their model names and public pricing are a priori known.

#### Static registries for Claude Code, Codex, and Gemini CLI

**Effort:** M. **Dependencies:** None; reuses existing benchmark snapshot, `benchmarkFamilies` alias mechanism, filtering, frontier, and recommendation machinery unchanged.

**Deliverables:**

- One static, versioned registry per assistant (initial scope: Claude Code, Codex, Gemini CLI or its Code Assist backing models), each entry holding an explicit stable ID, display name, vendor, backing company model, and source namespace (e.g. `claude-code:<model>`, `codex:<model>`, `gemini-cli:<model>`) so identical base names cannot collide across sources.
- No live discovery for these sources: the registry is the available set, clearly labeled as "known models, not your account availability" (catalog membership alone does not imply access). Copilot and OpenCode live discovery stay as-is.
- Benchmark matching reuses `resolveBenchmark` and the alias tables (extended with per-source family aliases where needed). One candidate resolves automatically; multiple candidates require user selection; a disappeared override mapping stays unresolved until replaced or reset — never silently substituted.
- Pricing comes from authoritative provider pricing pages linked in the catalog source comments, stored as USD-per-million-token rates in the existing `Rates` shape with a per-registry date stamp. Unverified or missing rates stay null with a visible reason; never inferred from similar display names. Expired promotional rates stay unresolved.
- Cost-unit separation preserved: static-registry rows compare in USD only and never share a frontier, chart axis, budget, or recommendation with Copilot credit/legacy rows (same rule as OpenCode USD today).
- Source-scoped budgets, workload profiles, and mappings: applying a profile can switch to a static source; pre-source saved state migrates without loss. Copying a model name for manual selection stays the only action.

**Acceptance criteria:**

- Selecting a static source lists its known models with distinct namespaced identities, benchmark scores from the shared snapshot, and USD costs or explicit unpriced reasons.
- Removing or renaming a registry entry fails closed (unresolved mapping with reason); live Copilot/OpenCode behavior is unchanged.
- Fixture tests cover registry loading, namespaced identity, benchmark alias resolution, USD estimates, missing-price reasons, migration of pre-source state, and stale-source guards on source switches.
- Documentation records each registry's model list, pricing source URLs, and refresh date; updating a registry follows the existing catalog rules (verify sources, update date, preserve missing data).

#### Additional static assistant registries

**Effort:** S per assistant. **Dependencies:** Static-registry machinery above.

**Deliverables:**

- Follow-up registries for similar assistants (e.g. Cursor, Windsurf, Aider-backed provider models, Amazon Q Developer) added one at a time using the same namespaced static-registry shape, verified pricing sources, and benchmark aliases. Each addition is an independent reviewable change.
- Registries never spawn processes, read config/auth files, or send inference requests.

**Acceptance criteria:**

- Each new source appears in the source selector with its known models, USD-only comparison, and documented pricing sources/dates.
- Unit tests cover the new registry entries, alias mappings, and unpriced fallback states.

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
