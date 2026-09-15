# Pareto GHC Comparator

[![Build](https://img.shields.io/github/actions/workflow/status/loumalouomega/Pareto-GHC-Comparator/extension.yml?style=flat&label=build)](https://github.com/loumalouomega/Pareto-GHC-Comparator/actions/workflows/extension.yml)
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
3. Pick a source (Copilot, OpenCode, Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Aider, or Amazon Q), task, billing mode, and token workload, then select a chart point or table row to inspect the tradeoff. The default chart mirrors Artificial Analysis (Intelligence vs. cost per task with the most attractive quadrant highlighted); switch to Quality vs. workload cost for your own token mix. The **Tool analysis** tab holds this everyday workflow, is first in the tab order, and stays open by default; **Compare tools**, **Plan & budget**, **Usage**, and **Settings** hold the rest (see [Layout](docs/user-guide.md#layout)). Use the grouped model checklist (family → model → thinking level, with search and bulk selection), chart display settings, cost breakdown, CSV/snapshot/badge/PNG exports, cost-per-quality table sort, pricing-freshness alerts, benchmark score drift, and (for OpenCode) the free-tier spotlight plus explicit BYOK rates for provider-billed models. **Scan Local Copilot Usage** optionally reports your own on-machine request and token totals (opt-in, local-only, erasable).

An unresolved model explains why (no catalog entry, ambiguous entry, no alias match, or a selection that disappeared) and, when the Artificial Analysis slug exactly matches the model's own identifier, offers an unverified suggestion you explicitly apply or reset — a benchmark choice never sets a price. Unpriced provider-billed OpenCode models get the same treatment for pricing: a same-identifier static-registry rate, applied with visible provenance and flagged (not silently updated) if the registry rate later changes. See [User guide](docs/user-guide.md#resolving-an-unmapped-model-or-an-unpriced-model).

Display-name benchmark matches and automatic thinking-variant matches are labelled **Inferred match (unverified)** in the table and details, with the same provenance in CSV/JSON exports. A match does not verify the client's reasoning configuration. Usage totals and model/day/workspace breakdowns show fully observed token pairs, observed zero pairs, missing-token requests, and estimated requests separately. Observed zero means both token fields were observed and both were zero; token sums include available fields only. Affected premium estimates show **Unknown model — default multiplier applied**, including requests without a model ID; legacy budget suggestions also note fallback usage. Stored usage JSON retains each request's token provenance.

The optional **Monthly spending scenario** card projects plan fee plus expected usage against a documented Copilot plan's allowance and overage rate (or your own Custom plan figures), with every field labelled provider-verified, your input, observed history, or a displayed estimate — always a projection, never a bill. See [Billing](docs/billing.md#monthly-spending-scenarios) and [User guide](docs/user-guide.md#monthly-spending-scenario).

Local usage scanning requires consent in a modal prompt. **Erase Local Copilot Usage** stops queued and active scans before completing deletion; session deletions also refresh watched totals. **Only my models** filters comparison results while preserving all thinking-level checklist selections.

Three `paretoGhc.*` extension settings mirror stored preferences without reload: `usage.retentionDays` (default unlimited) overrides the Usage tab retention window, `usage.watchOnScan` (default on) decides whether consented scans start the file watcher, and `chart.defaultView` (default task) is the chart basis for views without a saved choice. An explicitly configured value wins, the stored value otherwise applies unchanged, and explicit Pause/Resume commands always work. See [User guide](docs/user-guide.md#extension-settings).

Usage-based budget suggestions include free requests in the percentile and can suggest a zero budget.

## Compare options

On the **Compare tools** tab, enable **Compare options** to keep two named alternatives (A/B) visible. **Tool A** and **Tool B** pick each option's source directly, right there on the tab; **Editing A / B** picks which option the rest of the controls (task, billing, filters, workload, and every other tab) apply to, or load a saved workload into it. Sources, selections, filters, billing, and workloads are independent; the score preset and task/workload chart basis are shared. The last pair is remembered separately, and leaving this mode restores your single view. The **View** control picks how results are shown: **Side by side** (default) draws two independent charts, or **Overlay** superimposes both options on one chart with each option's own Pareto frontier plus a combined frontier across both, for seeing at a glance which tool wins at a given cost. When A and B bill in different units, **Show USD equivalents** optionally converts AI credits to USD at the documented pay-as-you-go rate (never legacy premium requests) so a comparison delta is still shown, labelled and separate from the native cost — the overlay's axis converts the same way when the two options' units differ — see [docs/billing.md](docs/billing.md) for the rate, allowance treatment, and what still stays separate.

Select one row in each panel (or click a point on the overlay chart) to see **B minus A** quality and cost differences. Cost differences require matching units and effective workloads; incompatible options retain separate frontiers with an explanation. CSV and snapshot exports include both options and their assumptions, PNG exports whichever view is active (two charts, or the overlay), and badge export names the active option.

Usage completeness diagnostics distinguish malformed records, unsupported or unreadable files, stale retained contributions, missing tokens, and legacy text estimates. Session files that match no known Copilot chat schema — including a known session framing whose request records changed shape — show an actionable content-free fingerprint to file with an issue instead of a bare count, while previously stored requests are retained. Prefill and sampled credit budgets use fully observed prompt/output pairs, including explicit zeros. Older usage caches are rescanned only with existing consent. Native OpenCode discovery supports platform-specific PATH resolution, a global npm install's `node_modules\opencode-ai\bin\opencode.exe` layout on Windows, and the home-directory fallback; script-only `.cmd`/`.ps1`/`.bat` shims are not supported. Discovery failures report the probed OpenCode CLI version, and unparseable listings fail closed with a content-free output fingerprint, so a CLI schema change reads as drift rather than an unexplained error. Verified in CI on Linux, macOS, and Windows; see [Testing](docs/testing.md#tier-1-validation) and the client × platform × version matrix in [docs/integrations.md](docs/integrations.md).

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
