# Contributor guidance

This repository builds a desktop VS Code extension that compares discovered GitHub Copilot models using Artificial Analysis benchmarks and estimated Copilot usage. OpenCode support is planned in [the roadmap](docs/roadmap.md), not implemented.

## Repository map

| Location | Responsibility |
| --- | --- |
| `src/extension.ts` | VS Code commands, discovery, secrets, persistence, refresh, and webview lifecycle. |
| `src/api.ts` | Benchmark response validation, pagination, cache policy, and API failures. |
| `src/catalog.ts` | Explicit Copilot IDs, benchmark family aliases, dated pricing catalog. |
| `src/compare.ts` | Option validation/migration, benchmark resolution, cost estimates, filtering, and Pareto frontier. |
| `src/recommend.ts` | Budget and near-best recommendations. |
| `src/profiles.ts` | Saved workload validation and profile operations. |
| `src/types.ts`, `src/messages.ts` | Shared data contracts and validation of incoming webview messages. |
| `src/html.ts`, `webview/main.ts`, `webview/style.css` | Webview markup/CSP, Chart.js rendering, interaction, and themes. |
| `test/*.test.ts` | Unit tests and mocked extension-host tests. |
| `test/webview.spec.ts`, `playwright.config.ts` | Chromium UI tests with synthetic data and a mocked host. |
| `scripts/build.mjs` | Bundles host/webview code and copies styles into `dist/`. |
| `scripts/verify-release.mjs` | Checks a supplied tag name against manifest and lockfile versions. |
| `scripts/capture-screenshot.mjs` | Captures a preview from a previously validated snapshot, without accepting an API key. |
| `.vscode/`, `.github/workflows/extension.yml` | Local build/debug tasks and CI/Marketplace publication. |
| `.vscodeignore` | VSIX allowlist; explicitly include new distributable assets. |

## Toolchain and validation

Use Node.js 22 or newer and npm; install locked dependencies with `npm ci`. Desktop VS Code 1.100 or newer is required by the manifest. Edit TypeScript/CSS sources rather than generated `dist/` files.

| Command | Purpose |
| --- | --- |
| `npm run check` | Type-check without emitting files. |
| `npm test` | Run unit and mocked host tests with Node's test runner and tsx. |
| `npm run build` | Build host and webview assets. |
| `npx playwright install chromium` | Install the browser needed by UI tests. |
| `npm run test:ui` | Run Chromium UI tests; build first. Set `PARETO_CHROMIUM_PATH` to use an existing browser. |
| `npm run package` | Run the prepublish type-check/build and produce `pareto-ghc-comparator.vsix`. |
| `npm run install:extension` | Package and install locally through `code --install-extension ... --force`. |
| `npm run release:check -- v0.5.0` | Validate the tag string against the current 0.5.0 manifests; substitute the next version after a bump. This does not check whether a git tag exists or whether publication succeeded. |

For logic, host, or shared-contract changes, run type checks, relevant tests, and a build. For UI or host/webview interaction changes, also run browser tests. Add regression coverage for meaningful new behavior and failure cases. For release/workflow changes, run release tests and version verification where applicable. For package allowlist or asset changes, package and inspect the VSIX contents. Documentation-only changes need link/path and diff checks, plus package validation if packaged contents change.

Before a release, run the complete CI sequence: type checks, unit/host tests, build, browser tests, and packaging. Automated tests need no API key. They do not prove real-account model discovery or API access: a real smoke test requires Copilot sign-in and a user-provided Artificial Analysis key. Record missing prerequisites as unperformed validation, never as passing checks. F5 starts the Extension Development Host using the configured build task.

## Verified feature behavior and maintenance rules

### Discovery and host/webview boundary

`src/extension.ts` uses `vscode.lm.selectChatModels({ vendor: "copilot" })`, refreshes discovery when models change, and reports discovery failures or empty availability. Catalog membership alone does not imply account access. Copying a model writes its display name to the clipboard; the extension does not switch models or send inference requests.

Incoming messages pass through `parseMessage` in `src/messages.ts` and are processed in a promise queue. Keep validation in the host and verify requested model/benchmark IDs against current data. Preserve the nonce-based CSP in `src/html.ts` and locally bundled webview assets. Coverage: `test/extension.test.ts`, `test/selection.test.ts`, and `test/webview.spec.ts`.

### Benchmark matching and overrides

`resolveBenchmark` in `src/compare.ts` uses explicit `benchmarkFamilies` aliases from `src/catalog.ts`, allowing recognized reasoning qualifiers. One candidate resolves automatically; multiple candidates require user selection. An override identifies a benchmark by ID. If it disappears, the mapping stays unresolved until the user replaces or resets it; never silently substitute another variant.

Pricing lookup requires exactly one catalog entry containing the discovered Copilot ID. Do not infer IDs, prices, or reasoning configuration from similar display names. User benchmark selection does not establish a pricing mapping. Coverage: `test/compare.test.ts` and `test/webview.spec.ts`.

### Pricing and Pareto comparison

`estimate` in `src/compare.ts` computes AI credits from USD-per-million-token catalog rates using the weighted token sum divided by 10,000. Input, cache-read, and cache-write buckets are disjoint; a null write rate falls back to the input rate. Long-context rates apply to the entire workload only when total input exceeds the threshold. Expired promotional credit rates remain unresolved. Legacy billing uses documented plan multipliers. Workloads beyond reported input capacity are excluded from credit comparisons.

Keep unknown prices/scores null with visible reasons. Filtering occurs before frontier calculation. Dominance requires equal-or-better cost and score with at least one strict improvement, so exact ties remain on the frontier. The webview uses a logarithmic cost axis for positive costs and switches to linear when a comparable cost is zero. Coverage: `test/compare.test.ts` and `test/webview.spec.ts`.

When updating `src/catalog.ts`, verify the sources linked in the README/catalog, update `catalogDate`, and check rates, units, context thresholds, expiries, legacy availability, IDs, and aliases. Preserve missing data rather than inventing values.

### Recommendations

`src/recommend.ts` considers displayed rows with finite cost and score. Best-under-budget maximizes score, breaking ties by lower cost. Cheapest-near-best minimizes cost within an absolute index-point gap from the highest displayed score, breaking ties by higher score. Exact ties are retained. Defaults in `src/types.ts` are one unit per billing mode and a three-point gap. Recommendation markers are separate from the Pareto frontier. Coverage: `test/selection.test.ts` and `test/webview.spec.ts`.

### Profiles and saved-state migration

`src/profiles.ts` stores version-1 profiles containing workload settings, excluding the text filter. Names are trimmed, 1–60 characters, and unique without regard to case. Apply preserves the current filter; update explicitly saves edits; Custom detaches; deletion retains the current workload. Invalid saved profile records are ignored individually.

`src/compare.ts` migrates v0.1 options lacking recommendation settings by adding defaults. `src/extension.ts` persists `options`, `profiles`, `mappings`, and `retryAt` in extension global state. Preserve existing keys and user choices when changing storage; add explicit migrations and tests when schemas change. `optionsRevision` allows profile application to update webview controls. Coverage: `test/selection.test.ts`, `test/extension.test.ts`, and `test/webview.spec.ts`.

### Credentials, cache, and failures

The Artificial Analysis key lives in VS Code SecretStorage under `artificialAnalysis.apiKey`; the webview receives only `hasKey`. Never put keys in settings, logs, fixtures, screenshots, or webview messages. Removing the key leaves the benchmark cache intact. No telemetry, project-file reading, or task uploads are implemented.

`src/api.ts` fetches all pages from the Free API in the host, with a 20-second timeout per request and redirects rejected. It validates page order, index version, records, and duplicate IDs before saving. `src/extension.ts` writes a temporary cache file and renames it to `benchmarks.json` in global storage. Failed refreshes retain the previous snapshot.

Cache freshness is 24 hours. There is at most one automatic download attempt per service instance; manual refresh can retry but respects persisted rate-limit timing. Concurrent loads share the pending request. Preserve stale-data explanations and credential-safe errors. Coverage: `test/api.test.ts` and `test/extension.test.ts`.

## Documentation and release maintenance

- Update `README.md` for user-visible behavior/setup changes and the relevant feature section here for verified implementation changes. Keep plans in `docs/roadmap.md`.
- Add user-visible changes to `CHANGELOG.md` under `Unreleased`, grouped as Added, Changed, or Fixed as appropriate. Before removing a completed roadmap task, record its implemented behavior here and its relevant changes in the changelog; remove empty tiers and fix dependencies.
- During release preparation, promote unreleased entries to the new version and leave an empty `Unreleased` section. Use `npm version patch`, `minor`, or `major` to update both manifests and create the version commit/tag after changes are committed. Record dates only when backed by release evidence; a tag does not prove Marketplace publication.
- CI builds on branch pushes, PRs, tags, and manual dispatch. Only version-tag pushes reach publication after checks pass. `scripts/verify-release.mjs` requires a stable tag matching both manifests. A separate release job uploads the tested VSIX to GitHub Releases. The Marketplace publish job uses the tested VSIX artifact, verifies publisher access, uses `VSCE_PAT` when present, and otherwise attempts Entra credentials. `verify-pat` checks Reader access while publish needs write access, so a passing verification followed by a 401/403 fails with a PAT scope/organization/role checklist and leaves the GitHub Release usable. Credential provisioning is external to this repository.
- `npm run package` is local packaging; installing, pushing release tags, and publishing have additional side effects. Follow the user's authorized scope and do not treat documentation work as a request to release.
- Ship `CHANGELOG.md` in the VSIX for user-facing history. Keep `AGENTS.md` and the planning roadmap as repository documentation.
