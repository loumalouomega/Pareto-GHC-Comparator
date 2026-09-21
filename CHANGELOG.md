# Changelog

User-visible changes to Pareto GHC Comparator are recorded here. Version sections below are reconstructed from repository commits and tags; they do not confirm Marketplace publication. Publication dates are omitted because they have not been verified.

## Unreleased

## 1.2.0

### Changed

- Provenance-complete exports (snapshot schema version 3): single and two-option CSV/snapshot exports now record the cost basis (native unit, task/workload/legacy basis, configured vs. actually-used token mix, legacy plan), with per-row catalog/benchmark-snapshot dates and pricing issues in CSV and snapshot rows. Snapshots carry an explicit `kind: "single" | "comparison"` discriminator; older files are never backfilled. Badge JSON stays shields-compatible (schema version 1) with explicit unit and basis. PNG exports annotate task, unit, basis, and catalog/benchmark dates.
- Cost-unit labels are now produced by one shared helper, so the table heading, recommendations, and every export always agree; pair exports keep each row's own native unit even when the two options bill differently.

### Fixed

- Display-name benchmark matches and automatic thinking-variant matches now show **Inferred match (unverified)** instead of an exact match, with explanations retained in CSV/JSON exports.
- Usage completeness separates observed zero-token pairs from missing fields and estimates in totals and model/day/workspace breakdowns. Default premium multipliers are labelled on affected estimates, including missing model IDs, and noted in legacy budget suggestions.

### Added

- Emoji icon placeholders across the panel and command palette: tabs, section headings, and action buttons now carry an emoji glyph (e.g. 📊 tabs, ⚙️ Settings, 📤 Export) until ad-hoc icons replace them. Glyphs in tabs and headings are hidden from assistive technology so accessible names are unchanged.
- Free-tier intelligence bar: under the OpenCode source, a **Best free options** bar below the Pareto chart ranks every scored free-tier model by the current task's benchmark index, highest first. Cost is zero so no cost unit applies and the bar never mixes with the cost chart; clicking a bar selects that row, a screen-reader list carries the same values, and unscored free models are simply absent rather than invented.
- Custom comparison tray: the results table's **Pick** checkboxes (or **Pick for custom comparison** in model details) pin up to 6 models into a **Custom comparison** card with its own score bar and head-to-head table on the current task and native cost basis. Picks persist on the panel across reloads but are never sent anywhere, exported, or saved to profiles; a pick that leaves the view stays listed as no-longer-in-view until removed, never silently swapped.
- Extension settings (`paretoGhc.usage.watchOnScan`, `paretoGhc.usage.retentionDays`, `paretoGhc.chart.defaultView`) in VS Code Settings: an explicitly configured value wins, otherwise the existing stored preference applies unchanged, and invalid values are ignored. Retention takes effect on the next consented scan with the Usage tab input kept in sync, the watch default starts/stops the file watcher without touching consent, data, or the pause flag, and the chart default applies to fresh views and to the open chart immediately — all without reload. Changing settings never grants consent or scans.
- Integration evidence matrix and schema version detection: `docs/integrations.md` records the verified client × platform × version cells for Copilot chat sessions and OpenCode CLI discovery, with dated fixtures pinning each shape. Session files that match no known Copilot chat schema — including a known session framing whose request records changed shape — now show an actionable content-free fingerprint (known-field presence and shape counters only, safe to paste into an issue) instead of a bare unsupported count, while previously stored requests are retained as stale contributions. OpenCode discovery probes `opencode --version` best-effort and reports it in every discovery failure, and unparseable listings fail closed with a content-free output fingerprint plus file-an-issue guidance, so a CLI schema change reads as drift rather than an unexplained error or a silent zero.
- Usage-watching pause control: a status bar item (`$(eye) Copilot usage watching`) is now shown whenever the local usage file watcher is active, so watching is visible while another tab is open or the panel is closed. **Pause watching** / **Resume watching** — via the status bar, the `Pareto GHC: Pause/Resume Copilot Usage Watching` commands, or the new button in the Usage tab — stops the watcher without revoking consent or deleting stored data; manual scans still work while paused, and erasing still removes everything including the paused state.
- Local usage retention and inspection: the Usage tab has a **Keep history (days)** setting (empty means unlimited, which is the default — nothing is ever deleted unless you opt in) that purges per-request records older than the window on every scan, with the purge reported in the scan message. Requests with unknown or future timestamps are never purged, and files left with no requests are removed along with their diagnostics. **Show stored usage data** — via the Usage tab button or the `Pareto GHC: Show Stored Copilot Usage Data` command — opens the stored usage summary read-only in an editor tab, so you can inspect exactly what is kept without erasing it.

## 1.1.0

### Added

- Comparison overlay view: Compare options now has a **View** toggle next to **Show USD equivalents**. **Overlay** superimposes both A/B options' models on one chart instead of two separate ones, drawing each option's own Pareto frontier plus a combined frontier across both, so the better-value tool is visible at a glance. When the two options bill differently, the shared axis converts to a labelled USD equivalent (the one exception to cost units never mixing in a chart); legacy premium requests, which never convert, are dropped from the overlay with a notice instead of being plotted on a unit they don't belong to, and the combined frontier is withheld — with a notice — when the two options' workload or cost basis don't otherwise match. PNG export saves the overlay chart when that view is active. See `docs/billing.md`'s "Overlay view" section.

### Changed

- **Compare tools** is now its own tab: Compare options (the A/B toggle, Tool A/Tool B source pickers, Editing, name, USD equivalents, and the View control) and its results — the per-option panels or the overlay chart, plus the B-minus-A delta — moved off Plan & budget and off Tool analysis onto this dedicated tab, so switching between two tools is easy to find. Comparison stays off by default, and Tool analysis (renamed from "Compare") stays first in the tab order and open by default, now always showing the single active option's chart regardless of whether Compare options is on. **Tool A** and **Tool B** pick each option's source directly from the Compare tools tab, without first switching Editing to it.
- Simpler default layout: the panel is now split into **Tool analysis** (originally named "Compare"), **Plan & budget**, **Usage**, and **Settings** tabs. Tool analysis keeps the everyday workflow — source, task, billing, chart view, and filter in one row, a compact **Find a model** strip, then the chart, table, and model details. Side-by-side options, saved workloads, and the monthly spending scenario move to Plan & budget; local usage, BYOK rates, and the free-tier spotlight to Usage; chart display, included models, and exports to Settings. Model details show the essentials and put cost breakdowns, pricing sources, pinning, and benchmark mapping behind **More details**, which opens automatically for a model with a missing benchmark or an unresolved price. The last open tab is restored when the panel reloads. Features, saved data, and exports are unchanged.

History: [v1.0.0...v1.1.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v1.0.0...v1.1.0).

## 1.0.0

### Added

- Two-option comparison mode with independent A/B settings, shared editor, separate charts/frontiers, selected-row deltas, saved-pair restoration, and two-option CSV/snapshot/PNG exports. Badge export targets the active option.
- Usage completeness diagnostics and version-2 storage distinguish observed, estimated, and missing tokens. Partially malformed files retain valid records; unsupported or unreadable updates retain visibly stale contributions until recovery or deletion.
- Native OpenCode executable resolution for Linux/macOS/Windows, including a global npm install's `node_modules\opencode-ai\bin\opencode.exe` layout on Windows, explicit timeout guidance, platform process tests, and a three-platform CI discovery job. A credential-free CI smoke job now verifies real free-tier discovery, variant expansion, and executable resolution (npm and install-script, plus a path containing spaces) on Linux, macOS, and Windows; real-account provider pricing stays verified on Linux only. See `docs/testing.md`.
- Pricing and reasoning mapping assistance: an unresolved model now explains why (no catalog entry, ambiguous entry, no alias match, or a disappeared selection) and, when a benchmark's Artificial Analysis identifier exactly matches the model's own id, offers it as an unverified suggestion to explicitly apply or reset. An unpriced, provider-billed OpenCode model gets a matching pricing suggestion from the same-identifier static registry (currently OpenAI models against the Codex registry), applied with visible registry provenance via **Apply rate to this model** / **Apply to all N variants**; a rate whose registry entry later changes or disappears keeps working but shows a staleness warning instead of updating silently. A pin whose benchmark disappears is now shown as its own unresolved row instead of being dropped. The benchmark dropdown now stages a choice for explicit **Apply mapping** or **Reset to automatic**, instead of applying on change.
- Monthly spending scenario: an optional what-if card projecting a documented Copilot plan's monthly fee plus expected usage against its included allowance and overage rate (Pro, Pro+, Max, Business, Enterprise, the legacy annual plan, or your own Custom plan), with every figure labelled provider-verified (with source and date), your input, observed local history, or the displayed per-request estimate — always a projection, never a bill. **Use my request history** fills the expected-requests range from a local scan. Each option in Compare options keeps its own scenario, with a separate delta line; scenarios save with workload profiles. Plans without verified billing rules (Copilot Free/Student, OpenCode Go, every other source) stay explicitly unavailable rather than approximated. Exports include the scenario and the plan-registry date.
- Comparison-mode USD cost equivalents: an optional **Show USD equivalents** toggle (off by default) converts AI-credit costs to USD at the documented $0.01/credit pay-as-you-go rate — never counting plan allowance or fee — shown per panel alongside the native cost, plus a USD-equivalent delta where the native cost delta today reads "Different billing units." Legacy premium requests are never converted, since a per-interaction multiplier isn't a token-workload cost; the delta still requires the same cost basis and workload as the native comparison. Cost units still never mix within a chart or frontier. Pair CSV exports gain per-row `usd_equivalent`/`usd_conversion` columns and the pair snapshot gains a `costNormalization` entry per option plus a top-level `usdCostDelta`, preserving the original values alongside the converted ones.

### Changed

- **Copy model ID / Copy model name**: for OpenCode models and a doc-verified subset of static-registry models (Claude Code and Codex's full lineups; Gemini CLI's `gemini-2.5-pro`/`gemini-3-flash` only), the button now copies the exact id that client's own `--model`/config key accepts, with a hint showing where to paste it, instead of a display name no client understands. Every other model still copies the display name, now with an explicit "no verified invocable id" note. No client config is read or written, and no model is switched or applied automatically. See `docs/model-switching-investigation.md`.
- The benchmark-variant dropdown in model details no longer applies a selection immediately on change; it stages the choice ("Will map to …") until **Apply mapping** is clicked, with a separate, always-available **Reset to automatic** button.


- Cost-per-quality table sort: an optional **Cost per quality** ordering (cost per index point, unpriced or unscored rows last with reasons) in chart display settings, with a matching table column; existing discovery order remains the default and saved settings migrate without losing user choices.
- Shareable exports: snapshot JSON (displayed rows plus source, task, billing, catalog/registry dates, and benchmark version with an illustrative-figures disclaimer) and shields-compatible badge JSON (highest-scoring displayed model), alongside the existing CSV/PNG exports via the save dialog.
- Pricing-freshness alert: the footer shows both the pricing catalog and static registry dates and nudges toward `docs/catalog.md` when either is older than 90 days, without blocking the comparison.
- Benchmark drift: the previous validated snapshot is retained locally on each successful refresh, and the table shows per-model score changes with the model-details panel citing both snapshot versions and retrieval dates; models without a comparable previous score show unknown, never zero.
- OpenCode BYOK rates: an explicit per-model rate table (USD per million tokens, webview form under the OpenCode source) prices provider-billed models the CLI leaves unpriced, saved locally with a visible BYOK provenance label; free-tier zero costs are never overridden and invalid entries keep the model unpriced.
- Local Copilot usage history (opt-in): **Scan Local Copilot Usage** reads `workspaceStorage` chat sessions on this machine only — after an explicit consent prompt, never before — and shows request, token, and premium-request totals by model, day, and workspace with an estimates-are-not-bills disclaimer. Incremental rescans reuse a size/mtime index, an opt-in file watcher refreshes totals with a visible indicator, and **Erase Local Copilot Usage** disables watching and deletes the data. Historical premium estimates use dual-era multipliers around the 2026-06-01 rebase; unknown models fall back to a labeled 1.0 estimate.
- Usage-aware workload prefill: **Use my average** fills the token inputs from median observed prompt/output tokens with the sample size and date range shown; it composes with saved profiles like any manual edit.
- Used-models overlay: chart points, tooltips, table rows, and model details mark models seen in local history with request counts, and an **Only my models** filter restricts the comparison (frontier, recommendations, and exports included) to them.
- Budget from reality: a suggested budget from p90 observed costs (premium requests for legacy billing, AI credits for credit billing) with its sample and window cited; applying it is explicit and manual budgets always win. No suggestion for USD, since local history covers Copilot requests only.
- Per-workspace breakdown: the usage card shows up to 20 workspaces with basename-only labels by default (full paths on toggle, kept in tooltips), and storage ids with an inline unmapped-workspace explanation when `workspace.json` is missing or unreadable; the model table grows to 12 rows.

### Fixed

- Preserve explicit zero token observations and exclude missing or text-estimated pairs from workload prefill and credit-budget samples. Old usage caches require a consent-gated rescan.
- Isolate source discovery errors and retain previous listings on failures; concurrent panels using one source share discovery.


- Include zero-cost requests in usage budget percentiles and priced sample counts, avoiding inflated suggestions for mixed free/paid history.

- Erasing local usage cancels queued scans and waits for active writes before deleting data; stale scans cannot restore history or watchers. Session deletions now trigger an incremental refresh, and deletion failures report that stored data could not be erased.
- Keep thinking-level checklist selections available while **Only my models** or free-only filtering hides comparison rows.
- Isolate temporary cache files so concurrent usage and benchmark writes cannot overwrite each other.
- Resolve OpenCode's real executable on Windows when installed via `npm install -g opencode-ai`, whose PATH shims are `.cmd`/`.ps1` wrappers rather than `opencode.exe`; found and fixed via real CI discovery evidence.
- Keep a BYOK-priced OpenCode model listed in the Provider-billed rates form after saving a rate for it, instead of it disappearing (it previously could not be edited or removed from the UI once priced).
- Stop silently dropping a pin whose benchmark disappeared from the catalog; it now stays visible as an unresolved row you explicitly replace or unpin, matching the existing rule for a stale manual override.
- Pad an empty comparison option's row in the two-option CSV export to the actual number of data columns instead of a stale hardcoded count, which had fallen out of sync with the header.

History: [v0.11.0...v1.0.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.11.0...v1.0.0).

## 0.11.0

### Added

- Chart views: **Intelligence vs. cost per task** (default, mirroring the Artificial Analysis homepage) and **Quality vs. workload cost** (the previous editable-workload plot). Per-task costs use a fixed illustrative token mix (1,000 input + 1,000 output) with the same catalog rates, so they stay comparable without depending on workload inputs; legacy billing keeps its per-interaction multiplier in both views.
- Most-attractive-quadrant highlight (toggleable): shades the above-median-score, at-or-below-median-cost region with median guides, like Artificial Analysis.
- New chart defaults: the General (Intelligence Index) task and per-task view for new installations; existing settings migrate without losing user choices.

### Fixed

- README build badge now uses shields.io flat style like the other badges.

History: [v0.10.0...v0.11.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.10.0...v0.11.0).

## 0.10.0

### Added

- Grouped model selection (family → model → thinking level) with collapsible checkboxes, partial-selection states, counts, selection search, and single-message bulk updates; per-model exclusion storage is preserved.
- Automatic benchmark-variant rows: when several benchmark variants match one model, each variant becomes its own comparable row with its own thinking-level checkbox instead of blocking on manual choice; models reporting their own thinking level resolve to that same level. The benchmark dropdown still collapses to one manual choice, with automatic matching restored on reset.
- Claude Fable 5 and 5.1 in the Claude Code, Cursor, Windsurf, and Aider known-model registries (assuming access), grouped under a Claude Fable family with verified USD rates.
- Refreshed static known-model registries: current Claude Code (Sonnet 4.6, Opus 4.6/4.7, Sonnet 5, Opus 5), Codex (GPT-5.4 mini, GPT-5.5), Gemini CLI (separate Gemini 3.5 Flash), and Cursor/Aider Sonnet 4.6 references, with corrected rates, context limits, and family grouping.
- Codex registry now tracks GPT-6 Astra and GPT-5.6 Sol/Terra/Luna plus the unpriced GPT-5.3-Codex-Spark preview; Gemini CLI adds Gemini 3.8 Flash; Cursor/Aider/Windsurf track GPT-5.6 Terra; Cursor/Aider add Claude Sonnet 5 at permanent $2/$10 pricing.

### Fixed

- Gemini 3 Flash no longer aliases the distinct Gemini 3.5 Flash model.
- Corrected Claude Opus 4.5 illustrative pricing to the current Opus $5/$25 tier.
- Corrected Gemini 3.5 Flash illustrative pricing to $1.50/$9 per million tokens.

### Removed

- Retired Codex models (GPT-5.4, GPT-5.4 mini, GPT-5.3-Codex, GPT-5.1-Codex-Mini) and end-of-support Claude Opus 4.5. Saved exclusions referencing them are harmless orphans.

History: [v0.9.0...v0.10.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.9.0...v0.10.0).

## 0.9.0

### Added

- Multiple benchmark variants per model as separate comparable rows via pins, with independent costs and fail-closed stale pins.
- Model inclusion checklist with select-all/none, persisted per source and combined with the text filter before frontier and recommendations.
- Chart display settings (model labels, Pareto frontier line, auto/logarithmic/linear cost scale with linear fallback for zero-cost rows) and deterministic base-model colors across light, dark, and high-contrast themes.
- Per-bucket cost breakdown in model details for credit and USD estimates, with explicit free-tier and unpriced states.
- Free-tier Zen comparison spotlight for OpenCode with best-free versus best-overall gap and cheapest paid model reaching the top score.
- One-click comparison CSV export and chart PNG export via the save dialog; exports reflect the displayed rows and chart.
- Static known-model registries needing no connection for Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Aider references, and Amazon Q Developer references, with namespaced identities, shared benchmark matching, illustrative USD estimates, and source-scoped budgets, profiles, and mappings.

History: [v0.8.0...v0.9.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.8.0...v0.9.0).

## 0.8.0

### Added

- OpenCode model comparison: source selector, `opencode models --verbose` discovery with actionable setup/error states, namespaced `opencode:<provider>/<model>[#variant]` identities with one row per reasoning variant, live USD pricing (Zen free tier at 0, provider-billed models visibly unpriced), USD budgets, source-scoped workload profiles, and Copilot-default migration of existing settings. No behavior change for existing Copilot comparisons.

History: [v0.7.3...v0.8.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.7.3...v0.8.0).

## 0.7.3

### Added

- Project landing page at <https://loumalouomega.github.io/Pareto-GHC-Comparator/>, deployed from version tags. No behavior change.
- Added repo-version, installs, downloads, and rating badges to the README; all badges use the flat style. No behavior change.

History: [v0.7.2...v0.7.3](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.7.2...v0.7.3).

## 0.7.2

### Added

- Vitest unit/mocked-host suite with enforced v8 coverage thresholds, `test:watch`/`test:coverage` scripts, and a `docs/testing.md` verification guide. No behavior change.

History: [v0.7.1...v0.7.2](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.7.1...v0.7.2).

## 0.7.1

### Changed

- Split the README into a lean overview with links to new topic guides under `docs/` (getting started, user guide, billing, data/privacy, development, releases, catalog). No behavior change.
- Added build-status, Marketplace-version, and license badges to the README. No behavior change.

History: [v0.7.0...v0.7.1](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.7.0...v0.7.1).

## 0.7.0

### Added

- Contributor guidance in `AGENTS.md` covering implementation boundaries, validation, state compatibility, and documentation/release maintenance.
- This changelog, included in the VSIX, with history for repository versions 0.1.0 through 0.5.0.
- OpenCode integration decision document (`docs/opencode-integration.md`, accepted 2026-09-10 against OpenCode 1.18.30) fixing the Tier 1 boundary: CLI `opencode models --verbose` discovery, Zen-gateway USD pricing scope, namespaced identity, and credential-safe failure states.

### Changed

- Updated README documentation links and release instructions to reflect the current repository version and publishing workflow.
- Clarified Marketplace PAT requirements (all accessible organizations, Marketplace Manage scope, future expiry, Owner/Contributor role) and the GitHub Release fallback when publish credentials lack write access.

### Fixed

- Marketplace publish failures after a passing `verify-pat` now report the read-versus-write permission checklist and keep the tested GitHub Release available instead of failing with only `Failed request: (401)`.

History: [v0.6.0...v0.7.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.6.0...v0.7.0).

## 0.5.0

### Added

- A version-tag workflow job that uploads the tested VSIX to GitHub Releases for manual installation, separately from Marketplace publication.

### Changed

- Expanded the roadmap into scoped tasks with dependencies, deliverables, acceptance criteria, and explicit constraints for future OpenCode support.

History: [v0.4.0...v0.5.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.4.0...v0.5.0).

## 0.4.0

### Added

- Initial roadmap for contributor documentation and future OpenCode support.

### Changed

- Marketplace publication verifies publisher access before uploading the tested VSIX. It uses a configured PAT or attempts Microsoft Entra credentials when the PAT is absent.

History: [v0.3.0...v0.4.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.3.0...v0.4.0).

## 0.3.0

### Added

- Extension icon in the package.
- Repository funding link.

### Changed

- Marketplace workflow permissions, publication diagnostics, and duplicate-version handling.

History: [v0.2.0...v0.3.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.2.0...v0.3.0).

## 0.2.0

### Added

- Best-under-budget and cheapest-near-best recommendations with explicit thresholds, tie handling, and chart/table markers.
- Named workload profiles with save, apply, update, rename, delete, and modified-state handling across workspaces.
- Migration of v0.1 settings to recommendation defaults while retaining existing settings and mappings.
- Validation and automated coverage for recommendation controls, profile operations, and host/webview messages.

### Changed

- Updated model catalog aliases, webview controls, and the illustrated README preview.

History: [v0.1.0...v0.2.0](https://github.com/loumalouomega/Pareto-GHC-Comparator/compare/v0.1.0...v0.2.0).

## 0.1.0

### Added

- Initial desktop VS Code comparison extension with Copilot model discovery, task-specific Artificial Analysis benchmarks, and a Pareto chart/table.
- AI-credit workload estimates and legacy premium-request multipliers, including explicit missing-data explanations.
- Benchmark variant selection and persistent manual mappings.
- SecretStorage API-key management, paginated benchmark retrieval, cached snapshots, and refresh failure handling.
- Keyboard-accessible model selection and light, dark, and high-contrast rendering.
- Build, package, local installation, release verification, and CI/Marketplace workflow tooling, with unit, host, and browser tests.
- README preview captured from benchmark data with explicitly illustrative model selections.

History: [v0.1.0 source](https://github.com/loumalouomega/Pareto-GHC-Comparator/tree/v0.1.0), including implementation commits `9f54d87`, `ec1b7ff`, and `355dc57`.
