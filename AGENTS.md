# Contributor guidance

This repository builds a desktop VS Code extension that compares coding-assistant models (GitHub Copilot, OpenCode, and static known-model registries) using Artificial Analysis benchmarks and estimated usage costs.

## Repository map

| Location | Responsibility |
| --- | --- |
| `src/extension.ts` | VS Code commands, discovery, secrets, persistence, refresh, and webview lifecycle. |
| `src/api.ts` | Benchmark response validation, pagination, cache policy, and API failures. |
| `src/catalog.ts` | Explicit Copilot IDs, benchmark family aliases, dated pricing catalog. |
| `src/opencode.ts` | OpenCode CLI discovery boundary, verbose-output parsing, live USD pricing, namespaced identity. |
| `src/compare.ts` | Option validation/migration, benchmark resolution, cost estimates with breakdowns, pins, exclusion/free-only filtering, static-source entries, and Pareto frontier. |
| `src/groups.ts` | Family → model → thinking selection grouping built from availability, exclusion, and row counts; presentational leaves map 1:1 to exclusion keys. |
| `src/sources.ts` | Source metadata: labels, allowed billing, live versus static availability, and pricing provenance. |
| `src/staticSources.ts` | Versioned known-model registries (Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Aider, Amazon Q) with namespaced identities, family grouping, and USD rates. |
| `src/export.ts` | CSV serialization with spreadsheet-safe escaping. |
| `src/recommend.ts` | Budget and near-best recommendations. |
| `src/profiles.ts` | Saved workload validation and profile operations. |
| `src/types.ts`, `src/messages.ts` | Shared data contracts and validation of incoming webview messages. |
| `src/html.ts`, `webview/main.ts`, `webview/style.css` | Webview markup/CSP, Chart.js rendering, interaction, and themes. |
| `test/*.test.ts` | Unit tests and mocked extension-host tests (Vitest). |
| `test/opencode.test.ts` | CLI parsing, USD pricing, migration, and message validation for OpenCode. |
| `test/source.test.ts` | Mocked host test for source switching and stale-discovery guard. |
| `test/webview.spec.ts`, `playwright.config.ts` | Chromium UI tests with synthetic data and a mocked host. |
| `scripts/build.mjs` | Bundles host/webview code and copies styles into `dist/`. |
| `scripts/verify-release.mjs` | Checks a supplied tag name against manifest and lockfile versions. |
| `scripts/capture-screenshot.mjs` | Captures a preview from a previously validated snapshot, without accepting an API key. |
| `site/index.html` | Static landing page deployed to GitHub Pages from version tags. |
| `.vscode/`, `.github/workflows/extension.yml`, `.github/workflows/pages.yml` | Local build/debug tasks, CI/Marketplace publication, and Pages deployment. |
| `.vscodeignore` | VSIX allowlist; explicitly include new distributable assets. |

## Toolchain and validation

Use Node.js 22 or newer and npm; install locked dependencies with `npm ci`. Desktop VS Code 1.100 or newer is required by the manifest. Edit TypeScript/CSS sources rather than generated `dist/` files.

| Command | Purpose |
| --- | --- |
| `npm run check` | Type-check without emitting files. |
| `npm test` | Run unit and mocked host tests once with Vitest. |
| `npm run test:watch` | Re-run affected Vitest tests on file changes. |
| `npm run test:coverage` | Run Vitest with v8 coverage and enforce the ratchet thresholds in `vitest.config.mts`. |
| `npm run build` | Build host and webview assets. |
| `npx playwright install chromium` | Install the browser needed by UI tests. |
| `npm run test:ui` | Run Chromium UI tests; build first. Set `PARETO_CHROMIUM_PATH` to use an existing browser. |
| `npm run package` | Run the prepublish type-check/build and produce `pareto-ghc-comparator.vsix`. |
| `npm run install:extension` | Package and install locally through `code --install-extension ... --force`. |
| `npm run release:check -- v0.5.0` | Validate the tag string against the current 0.5.0 manifests; substitute the next version after a bump. This does not check whether a git tag exists or whether publication succeeded. |

For logic, host, or shared-contract changes, run type checks, relevant tests, and a build. For UI or host/webview interaction changes, also run browser tests. Add regression coverage for meaningful new behavior and failure cases. See `docs/testing.md` for focused runs, the coverage ratchet policy, and per-change-type validation sequences. For release/workflow changes, run release tests and version verification where applicable. For package allowlist or asset changes, package and inspect the VSIX contents. Documentation-only changes need link/path and diff checks, plus package validation if packaged contents change.

Before a release, run the complete CI sequence: type checks, unit/host tests, build, browser tests, and packaging. Automated tests need no API key. They do not prove real-account model discovery or API access: a real smoke test requires Copilot sign-in and a user-provided Artificial Analysis key. Record missing prerequisites as unperformed validation, never as passing checks. F5 starts the Extension Development Host using the configured build task.

## Verified feature behavior and maintenance rules

### Discovery and host/webview boundary

`src/extension.ts` uses `vscode.lm.selectChatModels({ vendor: "copilot" })`, refreshes discovery when models change, and reports discovery failures or empty availability. OpenCode discovery spawns `opencode models --verbose` (see `src/opencode.ts`) and maps binary-missing, command, parse, and empty failures to actionable states while retaining the previous listing. Static sources (`src/staticSources.ts`) need no discovery and are labeled as known models, not account availability. A generation counter invalidates in-flight discovery on source switches; handler-driven discoveries are otherwise serialized by the message queue. Catalog membership alone does not imply account access. Copying a model writes its display name to the clipboard; the extension does not switch models or send inference requests.

Incoming messages pass through `parseMessage` in `src/messages.ts` and are processed in a promise queue. Keep validation in the host and verify requested model/benchmark IDs against current data. Group bulk updates arrive as a single `excludeMany` message with host-verified ids; per-model `exclude`/`excludeAll` storage is preserved. The checklist renders Family → Model → Thinking groups from `src/groups.ts` with partial-selection states, collapsible sections, a local selection search (bulk actions apply to matching models), and focus preservation. Preserve the nonce-based CSP in `src/html.ts` and locally bundled webview assets. Coverage: `test/extension.test.ts`, `test/selection.test.ts`, `test/groups.test.ts`, and `test/webview.spec.ts`.

### Benchmark matching and overrides

`resolveBenchmark` in `src/compare.ts` uses explicit `benchmarkFamilies` aliases from `src/catalog.ts`, allowing recognized reasoning qualifiers. One candidate resolves automatically. Multiple candidates expand automatically in `compare` into one row per variant (`modelId::benchmarkId` ids, `expandedBenchmarkId` set, `exact` status) with independent cost, frontier membership, and thinking-level checklist leaves, instead of blocking on manual choice; a model reporting its own thinking level (`#variant` or name) resolves to that same level when exactly one candidate shares it. Variant-level exclusions hide one expanded row; whole-model exclusions hide all of them. An override (benchmark dropdown) collapses the model to that single manual choice, and resetting it restores the automatic rows. If an override disappears, the mapping stays unresolved until the user replaces or resets it; never silently substitute another variant. Pins (`pins` in global state) expand one model into one row per pinned variant with independent mapping, cost, and frontier membership; unknown pins are ignored and unpinning restores the automatic rows. Coverage: `test/compare.test.ts`, `test/roadmap.test.ts`, `test/groups.test.ts`, and `test/webview.spec.ts`.

Pricing lookup requires exactly one catalog entry containing the discovered Copilot ID. OpenCode pricing rides on the discovered model (live CLI rates); only the benchmark-family aliases in `opencodeBenchmarkFamilies` are static. Static sources use versioned USD registries with per-registry dates and provenance; missing or expired rates stay unresolved. Do not infer IDs, prices, or reasoning configuration from similar display names. User benchmark selection does not establish a pricing mapping. Coverage: `test/compare.test.ts` and `test/webview.spec.ts`.

### Pricing and Pareto comparison

`estimate` in `src/compare.ts` computes AI credits from USD-per-million-token catalog rates using the weighted token sum divided by 10,000. OpenCode USD estimates use live CLI rates divided by 1,000,000; Zen free-tier models cost 0, provider-billed models stay unresolved. Cost units never mix: OpenCode rows are unpriced unless billing is USD, Copilot rows unless billing is credits or legacy. Input, cache-read, and cache-write buckets are disjoint; a null write rate falls back to the input rate. Long-context rates apply to the entire workload only when total input exceeds the threshold. Expired promotional credit rates remain unresolved. Legacy billing uses documented plan multipliers. Workloads beyond reported input capacity are excluded from credit comparisons.

Keep unknown prices/scores null with visible reasons. Filtering occurs before frontier calculation. Dominance requires equal-or-better cost and score with at least one strict improvement, so exact ties remain on the frontier. Checklist exclusions plus the text filter apply before expansion/frontier/recommendations/exports; static USD registries never mix with credit/legacy frontiers. OpenCode `#variant` rows group under one model with one thinking leaf each; other sources show a single Standard leaf per model unless variants are discovered. The webview uses a logarithmic cost axis for positive costs and switches to linear when a comparable cost is zero; an explicit scale override is labeled, and a requested log scale with zero-cost rows falls back to linear with notice. `display.chart` selects the cost basis: `task` (default) uses `taskCost` with the fixed `taskMix` proxy (1,000 input + 1,000 output tokens, legacy billing unchanged), `workload` uses the editable token estimate with context-limit exclusion. `display.quadrant` (default true) shades the above-median-score, at-or-below-median-cost region with median guides; profile apply preserves display settings. Base-model colors use stable hashed hues so two models never share an exact color; cost breakdowns reuse estimate arithmetic. CSV/PNG exports reflect the displayed rows/chart via the save dialog with validated payloads. Coverage: `test/compare.test.ts`, `test/roadmap.test.ts`, and `test/webview.spec.ts`.

When updating `src/catalog.ts`, verify the sources linked in the README/catalog, update `catalogDate`, and check rates, units, context thresholds, expiries, legacy availability, IDs, and aliases. Preserve missing data rather than inventing values.

When updating `src/staticSources.ts`, verify the provider pricing pages linked in `staticPricingSources`, keep `staticRegistryDate` current, and check rates, units, context limits, IDs, benchmark aliases, and family grouping. Preserve existing identities where valid so saved exclusions survive; never conflate distinct models in one alias (e.g. Gemini 3 Flash versus 3.5 Flash). Remove models the official docs mark retired, deprecated, or end-of-support (e.g. Codex GPT-5.4/5.4-mini after 2026-08-31, Claude Opus 4.5 after 2026-08-05) instead of keeping stale rows; orphaned saved exclusions are ignored. Current Codex lineup: GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, GPT-5.5, unpriced GPT-5.3-Codex-Spark preview.

### Table sort, freshness, and shareable exports

`src/efficiency.ts` (pure, webview-safe: no Node imports) defines `efficiencyOf` (cost per index point, null for missing/non-positive scores or negative costs) and `sortRowsByEfficiency` (nulls last, deterministic name/id tiebreaks). `src/compare.ts` re-exports both; `DisplaySettings.sort` (`default`|`efficiency`, default `default`) is parsed in `parseOptions` and auto-migrated via `defaults.display` spread in `migrateOptions`. `src/extension.ts` sorts displayed rows and CSV/snapshot/badge payloads when enabled; structure rows for grouping stay in discovery order. The webview adds a `display-sort` select and a Cost / quality column reusing `efficiencyOf`.

`src/freshness.ts` defines `freshnessAlert(catalogDate, staticRegistryDate, now)` with a 90-day threshold and a `docs/catalog.md` pointer. `ViewState` carries `staticRegistryDate`; the footer renders both dates plus the nudge without blocking comparison.

`src/export.ts` builds snapshot JSON (version 1, illustrative-figures disclaimer, catalog/registry dates, benchmark version) and shields-compatible badge JSON (schemaVersion 1, best-by-score with lower-cost tiebreak, empty-state message) from already-filtered, already-sorted rows. `exportSnapshot`/`exportBadge` messages validate in `parseMessage` and are handled like `exportCsv` via the save dialog with `exportNote` feedback. Coverage: `test/roadmap.test.ts` and `test/webview.spec.ts`.

### Benchmark drift and BYOK rates

`src/drift.ts` (pure, webview-safe) defines `selectPrevSnapshot` (valid snapshot strictly older than current, else undefined) and `driftOf` (per-preset join on stable benchmark IDs; delta only when both scores are finite, otherwise unknown, never zero). `src/extension.ts` retains the previous validated snapshot in `globalStorageUri/benchmarks.prev.json` with the same tmp+rename pattern, rotating only inside the download-success writer; failures never rotate. `ViewState` carries `prevVersion`, `prevFetchedAt`, and a `drift` map keyed by benchmark ID. The webview annotates score cells with known deltas and cites both snapshots with retrieval dates in model details.

`src/byok.ts` (pure, webview-safe) defines `parseByokStore` (full `opencode:provider/model[#variant]` IDs up to 1000 entries, nonnegative rates with null-or-nonnegative write, positive long-context thresholds; throws fail-closed) and `loadByokStore` (tolerant `{}` fallback for stored state). `src/compare.ts` accepts `extra.byok` and applies it only to provider-billed OpenCode models without CLI rates; free-tier models and CLI-priced models are untouched, non-USD billing stays cross-unit null, and applied rows carry a `· BYOK` tier suffix plus a provenance reason. `src/extension.ts` persists `byokRates` in global state and passes the store to `compare`/`freeSpotlight`/exports; `ViewState.byok` drives the webview table. The `byok` message validates in `parseMessage`. Coverage: `test/roadmap.test.ts` and `test/extension.test.ts`.

### Local usage history

`src/usageMultipliers.ts` (pure, webview-safe) holds dual-era premium tables around the 2026-06-01 rebase cutoff with per-event timestamp selection, unknown-model 1.0 labeled fallback, and a 10% auto-mode discount; the pricing catalog stays single-era. `src/usage.ts` (host-only: Node fs/path/os) discovers `chatSessions/*.jsonl` plus legacy `*.json` across stable and Insiders roots, resolves workspaces via `workspace.json` (`file:///` and `vscode-userdata:///` decoding, multi-root join), parses session anchors plus kind-2 appends plus kind-1 results with token/model/timestamp precedence and `resolvedModel` dash-to-dot normalisation, and aggregates per-model/day/workspace totals with per-request premium estimates. Missing token fields stay 0 with no invention on the JSONL path; legacy sessions estimate from text length with a `tokensEstimated` flag. `selectChangedFiles` (size/mtime/parser-version index) and `validUsageFile` gate incremental scans. `src/extension.ts` adds `paretoGhc.scanUsage`/`clearUsage` commands, a first-run consent modal (`usageConsent` in global state, default off), a debounced `FileSystemWatcher` pair per root created only after consent, `usage.json` in global storage (tmp+rename), and `ViewState.usage`/`usageWatching`; `scanUsage`/`clearUsage` validate in `parseMessage`. The webview history card shows KPIs plus capped model/day/workspace tables, unknown-model notes, and an estimates-are-not-bills disclaimer. Coverage: `test/roadmap.test.ts`, `test/extension.test.ts`, and `test/webview.spec.ts`.

### Usage-calibrated comparison

`src/usage.ts` also exports `medianUsage` inputs via `aggregateUsage` (`medianPrompt`/`medianOutput` over requests with token data, safe-integer clamped; `medianSample`; per-request `premiumP90` and catalog-priced `creditP90` with `creditSample`), `normalizeUsageModelId` (`copilot/` prefix strip), and `suggestBudget(summary, billing)` (legacy→premium p90, credits→credit p90, USD→null with a Copilot-only note; null summary/empty sample→null). `Options.onlyMine` (default false, parsed/migrated like `freeOnly`, part of saved workloads) filters whole models pre-expansion in `compare()` via `extra.usedCounts` (bare discovered IDs; variant/pin rows aggregate through `baseModelIdOf`); structure rows omit it so the checklist stays complete, and `freeSpotlight` baselines ignore it. `Row.requests` (optional, default 0 from the join) drives webview badges (chart radius bump with star priority, tooltip suffix, `· N used` table badge, details line) with no badge for zero-history rows. `ViewState.budgetSuggestion` renders beside the budget input with an explicit apply button. Prefill is a client-side token edit through the existing `options` flow, so profile modified/apply/update semantics are unchanged. Coverage: `test/roadmap.test.ts` and `test/webview.spec.ts` (mock mirrors the host join and suggestion).

### Recommendations

`src/recommend.ts` considers displayed rows with finite cost and score. Best-under-budget maximizes score, breaking ties by lower cost. Cheapest-near-best minimizes cost within an absolute index-point gap from the highest displayed score, breaking ties by higher score. Exact ties are retained. Defaults in `src/types.ts` are one unit per billing mode and a three-point gap. Recommendation markers are separate from the Pareto frontier. Coverage: `test/selection.test.ts` and `test/webview.spec.ts`.

### Profiles and saved-state migration

`src/profiles.ts` stores version-1 profiles containing workload settings, excluding the text filter and chart display settings. Workloads include the source, so applying a profile can switch sources (rediscovery follows). Names are trimmed, 1–60 characters, and unique without regard to case. Apply preserves the current filter; update explicitly saves edits; Custom detaches; deletion retains the current workload. Invalid saved profile records are ignored individually.

`src/compare.ts` migrates v0.1 options lacking recommendation settings by adding defaults. Pre-source options, profiles, and overrides migrate to Copilot defaults (plus a 1 USD budget) without losing user choices. `src/extension.ts` persists `options`, `profiles`, `mappings`, `pins`, `excluded`, and `retryAt` in extension global state. Preserve existing keys and user choices when changing storage; add explicit migrations and tests when schemas change. `optionsRevision` allows profile application to update webview controls. Coverage: `test/selection.test.ts`, `test/extension.test.ts`, and `test/webview.spec.ts`.

### Credentials, cache, and failures

The Artificial Analysis key lives in VS Code SecretStorage under `artificialAnalysis.apiKey`; the webview receives only `hasKey`. Never put keys in settings, logs, fixtures, screenshots, or webview messages. Removing the key leaves the benchmark cache intact. No telemetry, project-file reading, or task uploads are implemented.

`src/api.ts` fetches all pages from the Free API in the host, with a 20-second timeout per request and redirects rejected. It validates page order, index version, records, and duplicate IDs before saving. `src/extension.ts` writes a temporary cache file and renames it to `benchmarks.json` in global storage. Failed refreshes retain the previous snapshot.

Cache freshness is 24 hours. There is at most one automatic download attempt per service instance; manual refresh can retry but respects persisted rate-limit timing. Concurrent loads share the pending request. Preserve stale-data explanations and credential-safe errors. Coverage: `test/api.test.ts` and `test/extension.test.ts`.

## Documentation and release maintenance

- Update `README.md` for user-visible behavior/setup changes and the relevant feature section here for verified implementation changes. Keep plans in `docs/roadmap.md`.
- Add user-visible changes to `CHANGELOG.md` under `Unreleased`, grouped as Added, Changed, or Fixed as appropriate. Before removing a completed roadmap task, record its implemented behavior here and its relevant changes in the changelog; remove empty tiers and fix dependencies.
- During release preparation, promote unreleased entries to the new version and leave an empty `Unreleased` section. Use `npm version patch`, `minor`, or `major` to update both manifests and create the version commit/tag after changes are committed. Record dates only when backed by release evidence; a tag does not prove Marketplace publication.
- CI builds on branch pushes, PRs, tags, and manual dispatch. Only version-tag pushes reach publication after checks pass. A separate Pages workflow deploys `site/` to GitHub Pages on version tags. `scripts/verify-release.mjs` requires a stable tag matching both manifests. A separate release job uploads the tested VSIX to GitHub Releases. The Marketplace publish job uses the tested VSIX artifact, verifies publisher access, uses `VSCE_PAT` when present, and otherwise attempts Entra credentials. `verify-pat` checks Reader access while publish needs write access, so a passing verification followed by a 401/403 fails with a PAT scope/organization/role checklist and leaves the GitHub Release usable. Credential provisioning is external to this repository.
- `npm run package` is local packaging; installing, pushing release tags, and publishing have additional side effects. Follow the user's authorized scope and do not treat documentation work as a request to release.
- Ship `CHANGELOG.md` in the VSIX for user-facing history. Keep `AGENTS.md` and the planning roadmap as repository documentation.
