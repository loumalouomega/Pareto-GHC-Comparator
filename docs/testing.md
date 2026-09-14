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

`npm run test:coverage` prints a per-file table to the terminal and writes `coverage/lcov.info` (gitignored; uploaded from CI on every build run). Global thresholds in `vitest.config.mts` are ratcheted at measured coverage (lines 95, functions 98, branches 89, statements 93, with `src/extension.ts` excluded as unmeasured): any drop fails with an actionable message, e.g. `Coverage for lines (94.1%) does not meet global threshold (95%)`. When a change legitimately raises coverage, bump the corresponding threshold in the same commit; never lower one to make a failing check pass without investigation.

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

The audit preserves the roadmap's completed status. It does not certify current provider prices, real-account discovery, or Marketplace publication; those require separate external verification.
