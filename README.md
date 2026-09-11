# Pareto GHC Comparator

[![Build](https://github.com/loumalouomega/Pareto-GHC-Comparator/actions/workflows/extension.yml/badge.svg)](https://github.com/loumalouomega/Pareto-GHC-Comparator/actions/workflows/extension.yml)
[![Version](https://img.shields.io/github/v/tag/loumalouomega/Pareto-GHC-Comparator?style=flat&label=version)](https://github.com/loumalouomega/Pareto-GHC-Comparator/releases)
[![License: MIT](https://img.shields.io/github/license/loumalouomega/Pareto-GHC-Comparator?style=flat)](LICENSE)
<!-- [![Marketplace version](https://img.shields.io/visual-studio-marketplace/v/kratos-multiphysics.pareto-ghc-comparator?style=flat)](https://marketplace.visualstudio.com/items?itemName=kratos-multiphysics.pareto-ghc-comparator)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/kratos-multiphysics.pareto-ghc-comparator?style=flat)](https://marketplace.visualstudio.com/items?itemName=kratos-multiphysics.pareto-ghc-comparator)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/kratos-multiphysics.pareto-ghc-comparator?style=flat)](https://marketplace.visualstudio.com/items?itemName=kratos-multiphysics.pareto-ghc-comparator)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/kratos-multiphysics.pareto-ghc-comparator?style=flat)](https://marketplace.visualstudio.com/items?itemName=kratos-multiphysics.pareto-ghc-comparator#review-details) -->

<img src="media/icon.png" alt="Pareto GHC Comparator logo" width="128" />

A desktop VS Code extension for comparing coding-assistant models. Pick a task and compare benchmark quality against estimated usage cost on a Pareto chart.

Sources: GitHub Copilot (live discovery), OpenCode (live CLI discovery with Zen USD pricing), plus known-model registries that need no connection — Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Aider references, and Amazon Q Developer references. Static registries show a priori known company models with illustrative API-equivalent USD estimates, never account availability.

## Preview

![Pareto GHC Comparator showing a live coding-quality versus AI-credit comparison](docs/extension-preview.png)

Webview preview captured with live Artificial Analysis data. The ten catalog models and reasoning variants were selected explicitly for illustration; this preview does not represent a signed-in account's discovered Copilot availability. Benchmark scores and the data retrieval date appear in the extension.

## Quick start

Requires VS Code 1.100 or newer with GitHub Copilot Chat. See [Getting started](docs/getting-started.md) for the full setup walkthrough.

1. Install `pareto-ghc-comparator.vsix` via **Extensions: Install from VSIX…**.
2. Run **Pareto GHC: Open Model Comparison** and set your [Artificial Analysis Free API key](https://artificialanalysis.ai/data-api).
3. Pick a source (Copilot, OpenCode, Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Aider, or Amazon Q), task, billing mode, and token workload, then select a chart point or table row to inspect the tradeoff. Use the grouped model checklist (family → model → thinking level, with search and bulk selection), chart display settings, cost breakdown, CSV/PNG exports, and (for OpenCode) the free-tier spotlight.

## Guides

- [Website](https://loumalouomega.github.io/Pareto-GHC-Comparator/) — project landing page.
- [Getting started](docs/getting-started.md) — install, API key, model mapping.
- [User guide](docs/user-guide.md) — recommendations, saved workload profiles, reading the chart.
- [Billing estimates](docs/billing.md) — AI-credit, legacy, and OpenCode USD formulas.
- [Data, refresh, and privacy](docs/data-privacy.md) — benchmark source, caching, failure handling.
- [Development](docs/development.md) — local build, tests, and VS Code tasks.
- [Testing](docs/testing.md) — focused runs, coverage, and validation sequences.
- [CI and Marketplace releases](docs/releases.md) — workflow and publishing.
- [Maintaining the catalog](docs/catalog.md) — pricing and benchmark-alias updates.
- [Roadmap](docs/roadmap.md) — planned work.

## Development

Use Node.js 22 or newer and npm. No API key is needed for automated tests. See [Development](docs/development.md) and [contributor guidance](AGENTS.md).

```sh
npm ci
npm run check
npm test
npm run build
```

## License

Extension code: MIT. Benchmarks: Artificial Analysis, subject to its API terms. Pricing: GitHub documentation. See `THIRD_PARTY_NOTICES.md` for bundled library licenses.
