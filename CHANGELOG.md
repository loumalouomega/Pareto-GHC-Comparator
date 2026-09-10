# Changelog

User-visible changes to Pareto GHC Comparator are recorded here. Version sections below are reconstructed from repository commits and tags; they do not confirm Marketplace publication. Publication dates are omitted because they have not been verified.

## Unreleased

### Added

- Contributor guidance in `AGENTS.md` covering implementation boundaries, validation, state compatibility, and documentation/release maintenance.
- This changelog, included in the VSIX, with history for repository versions 0.1.0 through 0.5.0.

### Changed

- Updated README documentation links and release instructions to reflect the current repository version and publishing workflow.

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
