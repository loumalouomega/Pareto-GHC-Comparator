# Pareto GHC Comparator

A desktop VS Code extension for comparing the GitHub Copilot models exposed to your extension host. Pick a task and compare benchmark quality against estimated Copilot usage on a Pareto chart.

## Install and use

1. Install VS Code 1.100 or newer and enable GitHub Copilot Chat. Sign in to an account with model access.
2. Run **Extensions: Install from VSIX…** and select `pareto-ghc-comparator.vsix`.
3. Run **Pareto GHC: Open Model Comparison** from the Command Palette.
4. Click **Set API key** and enter your own [Artificial Analysis Free API key](https://artificialanalysis.ai/data-api). The key is stored in VS Code SecretStorage, not settings or the webview.
5. Choose **Coding**, **General**, or **Agentic**, select a billing mode, and edit the illustrative token workload if needed.
6. Select a chart point or a model button in the table to inspect the tested variant and cost tradeoff. **Copy model name** lets you select that model in Copilot yourself.

An unmatched or ambiguous model stays in the table with an explanation. Select its benchmark variant explicitly in model details if you know the correct match. Explicit mappings persist locally; selecting **Automatic exact matching** removes the override. Model identifiers with no verified pricing remain unpriced. The extension does not assume every Copilot model is exposed through VS Code's language model API.

## Reading the chart

Higher scores and lower costs are preferred. The dotted line connects the Pareto frontier: models for which no displayed model has both an equal or lower cost and an equal or higher score, with at least one strict improvement. Tied models remain on the frontier. Filtering recomputes the comparison for the visible models. Points with missing data are excluded from the chart, with reasons shown in the table.

Positive costs use a logarithmic axis. If any comparable model has zero cost, the chart switches to a linear axis. The table supports keyboard selection and provides the same values as the chart. Light, dark, and high-contrast themes follow VS Code.

Each preset uses its published Artificial Analysis index directly; scores are not invented or blended into a custom ranking. The tested reasoning variant appears in the details. Benchmark scores are a proxy for task suitability, not a guarantee of performance with Copilot's configuration. Comparing a fixed token workload does not estimate how many tokens different models need to complete the same task.

## Billing estimates

**AI credits** estimates usage from GitHub's per-million-token USD rates, with 1 credit equal to $0.01. The default example has 1,000 uncached input and 1,000 output tokens, with no caching. Input buckets are disjoint: count each input token once as uncached, cache-read, or cache-write. Output includes reasoning tokens.

```
credits = (uncached × input_rate + cache_read × cached_rate
           + cache_write × write_rate + output × output_rate) / 10,000
```

Where no separate cache-write rate is listed, cache-write tokens use the normal input rate. Long-context thresholds apply to the sum of all three input buckets. Exactly reaching a threshold keeps the default tier; exceeding it uses the long-context rates for the complete workload. Workloads exceeding a model's reported input capacity are excluded. Expired promotional prices are excluded until the catalog is updated.

**Legacy premium requests** uses the published multiplier per manually selected model interaction for eligible annual Copilot Pro or Pro+ plans. The catalog currently has the same documented multipliers for both. Models without documented legacy multipliers remain unavailable in that mode. Auto-selection discounts, subscription charges, remaining allowances, code-review charges, and GitHub Actions costs are not included.

These figures describe estimated usage, not your account bill or measured task cost. No inference request is sent by this extension.

## Data, refresh, and privacy

- Benchmark source: [Artificial Analysis Free API documentation](https://artificialanalysis.ai/data-api/docs), `GET /api/v2/language/models/free`. All pages are fetched in the extension host, with a 20-second timeout per request.
- Pricing sources: [GitHub models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) and [legacy annual-plan multipliers](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans). Catalog date: **2026-09-10**.
- Benchmark snapshots are cached in the extension's global storage for 24 hours. **Refresh data** forces a refresh unless an API quota reset is pending. Cache replacement happens only after every page validates successfully.
- Offline, invalid-response, authentication, and rate-limit failures retain the last successful snapshot. The UI shows the retrieval date and identifies stale results. There is at most one automatic download attempt per extension session; manual refresh retries explicitly.
- The Free API documentation currently lists 100 requests per 24-hour window. Limits may change: the client observes `Retry-After`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`, and persists the next permitted request time.
- **Pareto GHC: Remove Artificial Analysis API Key** deletes the saved credential; it leaves the local benchmark cache available.
- No backend, telemetry, project-file reading, task uploads, or automatic model switching. Network access is limited to the benchmark API; model discovery uses the existing Copilot integration. The chart library and styling are bundled locally.

## Development

Use Node.js 22 or newer and npm. No API key is needed for automated tests.

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run package
npm run install:extension
```

Press **F5** to open an Extension Development Host after the build task runs. To use an existing Chromium installation for UI tests, set `PARETO_CHROMIUM_PATH` to its executable. The packaged VSIX contains the compiled extension, webview assets, documentation, and dependency license notices. It does not include test fixtures or credentials.

Tests cover Pareto ties and dominance, filtering, missing data, pricing formulas and thresholds, expired promotions, exact and ambiguous mappings, API pagination and failures, cache retention, host/webview messages, secret isolation, keyboard selection, and themed browser rendering. Browser tests use synthetic model data and a mocked host; a real-account smoke test still requires Copilot sign-in and an Artificial Analysis key.

## VS Code tasks and installation

Run **Tasks: Run Build Task** (`Ctrl+Shift+B`) for the default `build` task. **Tasks: Run Task** also offers:

| Task | Result |
| --- | --- |
| `build` | Compile the extension and webview. |
| `package` | Type-check, build, and generate `pareto-ghc-comparator.vsix`. |
| `install` | Package the current source, then install the VSIX into VS Code using `--force`. |

Run `npm ci` once before using the tasks. The install task requires the `code` command on PATH. On macOS, use **Shell Command: Install 'code' command in PATH**. Reload the VS Code window after updating the extension. For another VS Code profile or Insiders, run the package task and use that editor's **Extensions: Install from VSIX…** command.

The VSIX filename stays constant as versions change; the version inside it comes from `package.json`. `npm run install:extension` is the equivalent terminal command. It is deliberately separate from npm's dependency installation lifecycle.

## CI and Marketplace releases

`.github/workflows/extension.yml` runs on branch pushes, pull requests, version-tag pushes, and manual dispatch. It installs locked dependencies with Node.js 22, type-checks, runs the unit and host tests, builds, runs Chromium UI tests, and packages the VSIX. Successful runs upload a **pareto-ghc-comparator-<commit SHA>** artifact, retained for 30 days. Failed runs upload any browser diagnostics for 7 days.

Only a **push of a stable version tag** publishes to the VS Code Marketplace. The tag must exactly match `v` plus the manifest version, and the lockfile version must match too. Publication waits for all checks to pass, downloads the VSIX from that same run, and publishes those exact packaged bytes. Branch pushes, pull requests, and manual dispatch only build artifacts.

One-time setup:

1. Register or select your publisher in [Marketplace publisher management](https://marketplace.visualstudio.com/manage). Set `publisher` in `package.json` to its exact ID. The current value is `pareto-ghc`; it must belong to an account you control.
2. Create the GitHub Actions environment **marketplace**. Add `VSCE_PAT` as an environment secret (a repository secret also works): an Azure DevOps PAT with **Marketplace → Manage** permission and access to that publisher. Do not put the token in source files. See the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for token creation and publisher membership.
3. Push this workflow to GitHub. No Artificial Analysis API key is needed in CI; automated tests use fixtures.

To release, start with a clean checkout, run `npm version patch` (or `minor` / `major`) to update both manifests and create a version commit and tag, then push the commit and **that specific tag**. For example, if the new version is `0.1.1`:

```sh
git push origin HEAD
git push origin v0.1.1
```

For the initial `0.1.0` release, tag the committed source as `v0.1.0` instead of incrementing it. `npm run release:check -- v0.1.0` checks the initial tag locally. Use a new version for subsequent Marketplace releases; the workflow does not overwrite an existing version. A failed publication can be rerun after fixing authentication, provided that version has not already been published.

Authentication maintenance: Microsoft's publishing guide states that global Azure DevOps PATs retire on December 1, 2026. This workflow uses `VSCE_PAT`; migrate the publish job to Microsoft Entra workload identity and `vsce publish --azure-credential` before that retirement. The build and artifact jobs do not depend on publishing credentials.

## Maintaining the catalog

Update `src/catalog.ts` against the two GitHub sources, change `catalogDate`, and verify rates, thresholds, promotional expiry dates, and legacy plan availability. Rates are USD per million tokens; `null` cache-write rates mean normal input billing. Add only explicit Copilot IDs. Do not infer a pricing mapping from a similar family or display name.

`benchmarkNames` contains exact candidate names. A single candidate may resolve automatically; multiple candidates require an explicit user selection. Preserve reasoning qualifiers and avoid fuzzy matching. API response validation and the three index mappings live in `src/api.ts`; comparison and cost rules live in `src/compare.ts`. Keep new cases covered by tests, then build and package a new release. Benchmark scores are fetched using each user's key and are not redistributed inside the VSIX.

## License

Extension code: MIT. Benchmarks: Artificial Analysis, subject to its API terms. Pricing: GitHub documentation. See `THIRD_PARTY_NOTICES.md` for bundled library licenses.
