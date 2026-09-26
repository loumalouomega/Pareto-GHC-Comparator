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

**Sources.** GitHub Copilot (live discovery), OpenCode (live CLI discovery with Zen USD pricing, on both the 1.x and 2.x command surfaces), plus known-model registries that need no connection — Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Aider references, and Amazon Q Developer references. Static registries show a priori known company models with illustrative API-equivalent USD estimates, never account availability.

## Preview

![Pareto GHC Comparator showing a live coding-quality versus AI-credit comparison](docs/extension-preview.png)

Webview preview captured with live Artificial Analysis data. The ten catalog models and reasoning variants were selected explicitly for illustration; this preview does not represent a signed-in account's discovered Copilot availability. Benchmark scores and the data retrieval date appear in the extension.

## Quick start

Requires VS Code 1.100 or newer with GitHub Copilot Chat. See [Getting started](docs/getting-started.md) for the full setup walkthrough.

1. Install `pareto-ghc-comparator.vsix` via **Extensions: Install from VSIX…**.
2. Run **Pareto GHC: Open Model Comparison** and set your [Artificial Analysis Free API key](https://artificialanalysis.ai/data-api).
3. Pick a source, task, billing mode, and token workload, then select a chart point or table row to inspect the tradeoff.

The default chart mirrors Artificial Analysis: Intelligence versus cost per task, with the most attractive quadrant highlighted, keyboard-traversable, and drawn with a colour-blind-safe palette plus non-colour frontier markers — the same facts repeated in the results table. Switch to **Quality vs. workload cost** for your own token mix.

Work is grouped into tabs. **Tool analysis** holds the everyday workflow, is first in the tab order, and stays open by default; **Compare tools**, **Plan & budget**, **Usage**, and **Settings** hold the rest (see [Layout](docs/user-guide.md#layout)).

**Also included:** a grouped model checklist (family → model → thinking level, with search and bulk selection) · chart display settings · cost breakdowns · CSV, snapshot, badge, and PNG exports, plus read-only [snapshot import](docs/user-guide.md#reopening-an-exported-snapshot) · cost-per-quality table sort · custom model picks for head-to-head comparison · pricing-freshness alerts · benchmark score drift · optional [on-machine usage history](#local-usage-history-consent-and-retention) · and, for OpenCode, a free-tier spotlight, an intelligence bar, and explicit BYOK rates for provider-billed models.

## Compare two options

On the **Compare tools** tab, enable **Compare options** to keep two named alternatives (A/B) visible. **Tool A** and **Tool B** pick each option's source directly, right there on the tab; **Editing A / B** picks which option the rest of the controls apply to, or loads a saved workload into it. Select one row in each panel (or a point on the overlay chart) to see **B minus A** quality and cost differences. The last pair is remembered separately, and leaving this mode restores your single view.

**View** picks how results are shown: **Side by side** (default) draws two independent charts, or **Overlay** superimposes both options on one chart with each option's own Pareto frontier plus a combined frontier across both. When A and B bill in different units, **Show USD equivalents** optionally converts AI credits to USD at the documented pay-as-you-go rate — never legacy premium requests — so a delta is still shown, labelled and separate from the native cost. Cost differences require matching units and effective workloads; incompatible options retain separate frontiers with an explanation. CSV and snapshot exports include both options and their assumptions, PNG exports whichever view is active, and badge export names the active option. See [Billing](docs/billing.md) and [User guide](docs/user-guide.md#compare-options).

<a id="local-usage-history-consent-and-retention"></a>

<details>
<summary><b>Local usage history, consent, and retention</b></summary>

**Scan local usage** optionally reports your own on-machine totals. It is opt-in, local-only, and erasable, and reading anything requires consent in a modal prompt that states exactly what is read.

**Two separate ledgers, never added together.** Copilot usage is counted in premium requests or AI credits; Claude Code is counted in tokens under a different billing model. They are reported in their own tables, no price is derived for either, and the client's own cost figure is never treated as a rate. Claude Code is opt-in on its own, listed with what it reads, and removable on its own. Model names are shown exactly as the client reports them rather than matched to a priced entry by guesswork.

**Sources.** Copilot chat sessions are covered for VS Code and VS Code Insiders by default. Any other editor with a Copilot chat-session store — a VS Code fork, or a Remote-SSH, WSL, or dev container host — is added only through its own consent prompt and reported as a separate per-editor total. Claude Code transcripts are a separate source, and the memory files in the same folder are never opened.

**What is measured.** Usage totals and model/day/workspace breakdowns show fully observed token pairs, observed zero pairs, missing-token requests, and estimated requests *separately*. Observed zero means both token fields were observed and both were zero; token sums include available fields only. Affected premium estimates show **Unknown model — default multiplier applied**, including requests without a model ID, and legacy budget suggestions note fallback usage. Stored usage JSON retains each request's token provenance. Budget suggestions include free requests in the percentile and can suggest a zero budget.

**Diagnostics.** Completeness diagnostics distinguish malformed records, unsupported or unreadable files, stale retained contributions, missing tokens, and legacy text estimates. Session files matching no known schema — including a known framing whose request records changed shape — show an actionable content-free fingerprint to file with an issue instead of a bare count, while previously stored requests are retained. Subagent (sidechain) turns are counted and held out of Claude Code's totals rather than double-counting inherited work; a turn whose token counts cannot be read is reported as such rather than shown as zero. Prefill and sampled credit budgets use fully observed prompt/output pairs, including explicit zeros.

**Erase and retention.** **Erase local usage** stops queued and active scans before completing deletion, and clears every source at once; removing one source with **Stop and remove** deletes only that source's data. Session deletions also refresh watched totals. An optional retention window purges per-request records older than N days on every scan; it is off by default, so no history is deleted without opt-in. Older usage caches are rescanned only with existing consent. **Only my models** filters comparison results while preserving all thinking-level checklist selections.

**Watching** stays visible outside the Usage tab in the status bar and can be paused and resumed; manual scans still work while paused. See [Editors and consent](docs/user-guide.md#editors-and-consent).

</details>

<details>
<summary><b>Snapshot import, unresolved models, and inferred matches</b></summary>

**Import snapshot JSON** reopens a snapshot JSON you exported earlier as historical, read-only data: a banner names the file, its export date, and the cost basis, unit, and registry dates as of that export. The exported cost basis stays locked so those numbers are never relabelled, and recommendations and provenance are shown as exported rather than recomputed. Nothing in that view changes your saved settings, and a file that is not a readable snapshot of this schema is refused with the reason. See [Reopening an exported snapshot](docs/user-guide.md#reopening-an-exported-snapshot).

**Unresolved models explain themselves** — no catalog entry, ambiguous entry, no alias match, or a selection that disappeared — and, when the Artificial Analysis slug exactly matches the model's own identifier, offer an unverified suggestion you explicitly apply or reset. A benchmark choice never sets a price. Unpriced provider-billed OpenCode models get the same treatment for pricing: a same-identifier static-registry rate, applied with visible provenance and flagged (not silently updated) if the registry rate later changes. See [Resolving an unmapped model](docs/user-guide.md#resolving-an-unmapped-model-or-an-unpriced-model).

**Display-name benchmark matches and automatic thinking-variant matches are labelled Inferred match (unverified)** in the table and details, with the same provenance in CSV/JSON exports. A match does not verify the client's reasoning configuration.

</details>

<details>
<summary><b>Monthly spending scenarios</b></summary>

The optional **Monthly spending scenario** card projects plan fee plus expected usage against a documented Copilot plan's allowance and overage rate — or your own Custom plan figures — with every field labelled provider-verified, your input, observed history, or a displayed estimate. It is always a projection, never a bill. See [Billing](docs/billing.md#monthly-spending-scenarios) and [User guide](docs/user-guide.md#monthly-spending-scenario).

</details>

<details>
<summary><b>Extension settings</b></summary>

Three `paretoGhc.*` settings mirror stored preferences without reload:

| Setting | Default | Effect |
| --- | --- | --- |
| `usage.retentionDays` | unlimited (0) | Overrides the Usage tab retention window |
| `usage.watchOnScan` | on | Whether consented scans start the file watcher |
| `chart.defaultView` | `task` | Chart basis for views without a saved choice |

An explicitly configured value wins, the stored value otherwise applies unchanged, and explicit Pause/Resume commands always work. See [Extension settings](docs/user-guide.md#extension-settings).

</details>

<details>
<summary><b>Discovery, drift handling, and verification</b></summary>

Native OpenCode discovery supports platform-specific PATH resolution, a global npm install's `node_modules\opencode-ai\bin\opencode.exe` layout on Windows, and the home-directory fallback; script-only `.cmd`/`.ps1`/`.bat` shims are not supported. Both the 1.x verbose listing and the 2.x OpenAPI listing surface are supported, and a missing binary or a timeout never causes a second attempt.

Discovery failures report the probed OpenCode CLI version, and unparseable listings fail closed with a content-free output fingerprint, so a CLI schema change reads as drift rather than an unexplained error. A weekly non-gating check runs real credential-free discovery against both the pinned and the latest OpenCode release and files a single tracked issue when — and only when — the pinned one lists models and the latest one does not; failures an outage explains file nothing.

Verified in CI on Linux, macOS, and Windows. See [Testing](docs/testing.md#tier-1-validation) and the client × platform × version matrix in [docs/integrations.md](docs/integrations.md).

</details>

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
