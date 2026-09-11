# Changelog

User-visible changes to Pareto GHC Comparator are recorded here. Version sections below are reconstructed from repository commits and tags; they do not confirm Marketplace publication. Publication dates are omitted because they have not been verified.

## Unreleased

### Added

- Grouped model selection (family → model → thinking level) with collapsible checkboxes, partial-selection states, counts, selection search, and single-message bulk updates; per-model exclusion storage is preserved.
- Automatic benchmark-variant rows: when several benchmark variants match one model, each variant becomes its own comparable row with its own thinking-level checkbox instead of blocking on manual choice; models reporting their own thinking level resolve to that same level. The benchmark dropdown still collapses to one manual choice, with automatic matching restored on reset.
- Claude Fable 5 and 5.1 in the Claude Code, Cursor, Windsurf, and Aider known-model registries (assuming access), grouped under a Claude Fable family with verified USD rates.
- Refreshed static known-model registries: current Claude Code (Sonnet 4.6, Opus 4.6/4.7, Sonnet 5, Opus 5), Codex (GPT-5.4 mini, GPT-5.5), Gemini CLI (separate Gemini 3.5 Flash), and Cursor/Aider Sonnet 4.6 references, with corrected rates, context limits, and family grouping.

### Fixed

- Gemini 3 Flash no longer aliases the distinct Gemini 3.5 Flash model.
- Corrected Claude Opus 4.5 illustrative pricing to the current Opus $5/$25 tier.

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
