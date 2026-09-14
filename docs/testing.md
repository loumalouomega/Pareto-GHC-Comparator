# Testing

Unit and mocked host tests run under Vitest with v8 coverage; the Chromium UI suite stays on Playwright. No API key is needed for any automated test.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run unit and mocked host tests once (`vitest run`). |
| `npm run test:watch` | Re-run affected tests on file changes. |
| `npm run test:coverage` | Run the suite with coverage and enforce the ratchet thresholds. |
| `npm run test:ui` | Run Chromium UI tests (`playwright test`); build first. |
| `npm run check` | Type-check without emitting files. |

## Focused runs

Run a single file or a single test while iterating:

```sh
npx vitest run test/compare.test.ts
npx vitest run test/selection.test.ts -t "budget recommendation"
```

`test/webview.spec.ts` is not a Vitest file; run it only via `npm run test:ui` after `npm run build`. Set `PARETO_CHROMIUM_PATH` to use an existing Chromium installation.

## Coverage

`npm run test:coverage` prints a per-file table to the terminal and writes `coverage/lcov.info` (gitignored; uploaded from CI on every build run). Global thresholds in `vitest.config.mts` are ratcheted at measured coverage (with `src/extension.ts` excluded as unmeasured): any drop fails with an actionable message, e.g. `Coverage for lines (94.1%) does not meet global threshold (95%)`. When a change legitimately raises coverage, bump the corresponding threshold in the same commit to the newly measured value; never lower one to make a failing check pass without investigation. Check the current numbers in `vitest.config.mts` directly rather than here, since they move with every such change.

Known gap: `test/extension.test.ts` bundles `src/extension.ts` through esbuild and imports the bundle via a data URL, so the v8 provider reports 0% for `extension.ts` even though the mocked host test exercises it. That file is excluded from coverage thresholds and treated as unmeasured rather than uncovered.

Existing test files use `node:assert/strict` under the Vitest runner; new tests may use either that or `vitest`'s `expect` — keep the file's existing style.

## Full validation sequence

Match the check to the change type (see also the contributor guidance):

| Change type | Sequence |
| --- | --- |
| Logic, host, or shared contracts | `npm run check`, relevant focused tests, full `npm test`, `npm run build`. |
| UI or host/webview interaction | Above, plus `npm run test:ui`. |
| Release or workflow | Release tests, `npm run release:check -- vX.Y.Z`, full sequence, `npm run package` + VSIX inspection. |
| Package allowlist or assets | `npm run package` + inspect VSIX contents. |
| Docs only | Link/path and diff checks, plus package validation if packaged contents change. |

Add regression coverage for meaningful new behavior and failure cases.

## Feasibility spikes

`scripts/cli-spike.ts` is evidence for `docs/cli-investigation.md`, not a gating check or a shipped feature (`.vscodeignore` excludes it from the VSIX). It has no CI job. To reproduce its evidence:

```sh
npx tsx scripts/cli-spike.ts --snapshot test/fixtures/cli/snapshot.json \
  --options test/fixtures/cli/options.json --source codex --format csv
npx esbuild scripts/cli-spike.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/cli-spike-bundle.mjs   # must succeed with no `vscode` external
grep -c 'from "vscode"' /tmp/cli-spike-bundle.mjs   # must be 0
```

The measured-evaluations investigation (`docs/measured-evaluations-investigation.md`) proposes a test plan (mocked-provider request/spend caps, cancellation, consent, erase, and strict separation from benchmark/history data) for when that feature is scheduled; none of it is implemented, and no test in this repo sends a real inference request — the existing host-test guard's `sendRequest` throws "Inference must never be called" precisely to keep it that way.

## What automation does not prove

Automated tests use fixtures, synthetic model data, and a mocked host. They do not prove real-account model discovery or real API access: a real smoke test requires Copilot sign-in and a user-provided Artificial Analysis key. Record missing prerequisites as unperformed validation, never as passing checks.

## Roadmap completion audit

The completed roadmap is covered by the following implementation and regression suites:

| Feature group | Evidence |
| --- | --- |
| Chart controls, task/workload costs, quadrant, zero-cost scale | `test/roadmap.test.ts`, `test/webview.spec.ts` |
| Static registries, source switching, missing/expired prices | `test/roadmap.test.ts`, `test/source.test.ts`, `test/compare.test.ts` |
| Thinking variants, pins, exclusions, saved profiles | `test/groups.test.ts`, `test/selection.test.ts`, `test/extension.test.ts`, `test/webview.spec.ts` |
| Efficiency sort, freshness, snapshot/badge exports | `test/roadmap.test.ts`, `test/webview.spec.ts`; host exports reuse the displayed comparison inputs and sort |
| Benchmark drift, failed refreshes, stale data | `test/roadmap.test.ts`, `test/api.test.ts`, `test/extension.test.ts` |
| BYOK validation, provenance, billing isolation | `test/roadmap.test.ts`, `test/opencode.test.ts`, `test/extension.test.ts` |
| Usage parsing, incremental scans, workspace labels, consent and erase races | `test/roadmap.test.ts`, `test/extension.test.ts`, `test/webview.spec.ts` |
| Workload prefill, used-model filtering, budget percentiles including free requests | `test/roadmap.test.ts`, `test/extension.test.ts`, `test/webview.spec.ts` |

The earlier completion audit covered the then-completed roadmap. It does not certify current provider prices, real-account discovery, or Marketplace publication; those require separate external verification.

## Tier 1 validation

- `test/tier1.test.ts`: comparison persistence/validation, shared result construction, compatible deltas, targeted messages, usage provenance, version-2 validation, and stable/Insiders/legacy/malformed fixture cases. All fixture content is synthetic.
- `test/extension.test.ts`: isolated A/B options and exclusions, restoring the single view and last pair, profile-load isolation, export parity, and real temporary-session updates through unsupported, truncated, and deleted states.
- `test/opencode-platform.test.ts`: native resolution, PATH/home fallback, the Windows npm-global-install layout (`node_modules\opencode-ai\bin\opencode.exe`), Windows path rules, timeout limits, and literal process arguments at an executable path with spaces. The native process test copies Node as an executable fixture; it does not invoke real OpenCode providers.
- `test/webview.spec.ts`: all three themes cover comparison panels, active editor switching, cross-unit explanations, combined PNG messages, narrow layout, and usage diagnostics, alongside existing regression flows.
- `.github/workflows/extension.yml` `Native discovery` job: the platform-discovery test file above, run remotely on Linux, macOS, and Windows and gating the release jobs. Confirmed green remotely: run [34816368954](https://github.com/loumalouomega/Pareto-GHC-Comparator/actions/runs/34816368954) (2026-09-14, commit `16e1af1`), all three OSes.
- `scripts/opencode-smoke.ts` and the non-gating `opencode-smoke` CI job: real (unmocked) `opencode models --verbose` discovery through `discoverOpenCode`, against an isolated credential-free home, plus a real-executable path-with-spaces rerun. Output is sanitized to counts only (see `AGENTS.md`).

### OpenCode discovery evidence by environment

| OS | Install method | CLI version | Executable resolution | Free-tier discovery (`opencode` provider) | Priced/unpriced (`opencode-go`/`openai`) | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Linux | install script (`~/.opencode/bin`) | 1.18.30 | Verified (home fallback, path with spaces) | Verified: 17 rows, 13 variants | **Verified with a real signed-in account**: 65 `opencode-go` priced, 81 `openai` unpriced | Local run, 2026-09-14 (163 total rows) |
| Linux | npm global (`npm install -g opencode-ai`) | 1.18.30 | Verified (PATH, path with spaces) | Verified: 17 rows, 13 variants | Unverified (credential-free CI) | CI run [34817372006](https://github.com/loumalouomega/Pareto-GHC-Comparator/actions/runs/34817372006), job `OpenCode smoke (ubuntu-latest, npm)` |
| macOS | install script | 1.18.30 | Verified (PATH, path with spaces) | Verified: 17 rows, 13 variants | Unverified (credential-free CI) | Same run, job `OpenCode smoke (macos-latest, script)` (one transient "Failed to fetch version information" from the install script's own version check, unrelated to this repo, seen once and reproduced-passing on rerun) |
| macOS | npm global | 1.18.30 | Verified (PATH, path with spaces) | Verified: 17 rows, 13 variants | Unverified (credential-free CI) | Same run, job `OpenCode smoke (macos-latest, npm)` |
| Windows | npm global | 1.18.30 | **Verified, including the npm-layout gap and fix** (see below) | Verified: 17 rows, 13 variants | Unverified (credential-free CI) | CI run [34817141985](https://github.com/loumalouomega/Pareto-GHC-Comparator/actions/runs/34817141985) (failure) and [34817372006](https://github.com/loumalouomega/Pareto-GHC-Comparator/actions/runs/34817372006) (fixed), job `OpenCode smoke (windows-latest, npm)` |
| Windows | install script | — | Unverified | Unverified | Unverified | The official install script targets a POSIX shell; not exercised in this matrix (`script` is excluded for `windows-latest`) |

**Windows npm-install gap found and fixed by this evidence:** `npm install -g opencode-ai@1.18.30` on `windows-latest` left only `.cmd`/`.ps1` shims on PATH (`npm root -g` resolved to `C:\npm\prefix\node_modules`); `executableCandidates` found no `opencode.exe` there and reported the CLI missing (run 34817141985, exit 1, `"kind":"missing"`). Fixed in `src/opencode.ts` by also probing `<dir>\node_modules\opencode-ai\bin\opencode.exe` for each Windows PATH entry (still plain `execFile`, no shell). Rerun 34817372006 resolved via that exact candidate (`"resolution":"npm-layout"`) and listed the same 17 free-tier rows. See `test/opencode-platform.test.ts` for the regression case.

**What remains unverified:** provider-billed pricing (`opencode-go`, `openai`) and native executable resolution with a real signed-in account, on macOS and Windows — CI runs credential-free by design, so only the Zen free tier is reachable there; verifying priced listings needs a user-owned macOS/Windows machine with OpenCode connected to a provider. Copilot sign-in and Artificial Analysis API smoke tests remain unperformed without user-provided account prerequisites. No inference execution is part of any validation above.
