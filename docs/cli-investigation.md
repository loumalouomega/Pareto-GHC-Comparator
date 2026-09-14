# Standalone comparison CLI — feasibility investigation

Status: **Decided — feasible, deferred delivery.** (roadmap: `docs/roadmap.md`).

Date checked: 2026-09-14. Node 22 (CI) / v26.8.2 (local check). Extension version at time of writing: 0.11.0.

This document records what was verified by tracing the module import graph and running a small reproducible spike. No network request was made beyond the read-only OpenCode CLI discovery already used by the extension; no VS Code global state, SecretStorage, or cache file was touched.

## Documentation checked

- Node.js `util.parseArgs`: `https://nodejs.org/api/util.html#utilparseargsconfig` (candidate argument parser for a real CLI; the spike below uses a two-line manual parser instead, since it only needs three flags).
- `package.json` `bin` field and npm packaging: `https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bin`.
- This repo's own precedent script boundary, `scripts/opencode-smoke.ts`, which already runs `src/opencode.ts` outside the extension host under `tsx` in CI.

## Local experiments (reproducible, no inference, no secrets)

```sh
# Import graph: does anything outside extension.ts import "vscode"?
grep -rn '"vscode"' src/*.ts | grep -v '^src/extension.ts'
# -> no matches

# Reuse spike: run a comparison from explicit files, no vscode, no network
# fetch, no editor state.
npx tsx scripts/cli-spike.ts \
  --snapshot test/fixtures/cli/snapshot.json \
  --options test/fixtures/cli/options.json \
  --source codex --format csv
npx tsx scripts/cli-spike.ts \
  --snapshot test/fixtures/cli/snapshot.json \
  --options test/fixtures/cli/options.json \
  --source codex --format snapshot
npx tsx scripts/cli-spike.ts \
  --snapshot test/fixtures/cli/snapshot.json \
  --options test/fixtures/cli/options.json \
  --source opencode          # real, local `opencode models --verbose` spawn — discovery only

# Boundary proof: bundle the spike for Node with no `vscode` external and
# confirm the bundle never references it.
npx esbuild scripts/cli-spike.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/cli-spike-bundle.mjs
grep -c 'from "vscode"' /tmp/cli-spike-bundle.mjs   # -> 0

# Type-check the spike in isolation, same compiler options as tsconfig.json.
npx tsc --noEmit scripts/cli-spike.ts --target ES2022 --module ESNext \
  --moduleResolution Bundler --strict --esModuleInterop --resolveJsonModule \
  --lib ES2022,DOM --types node --skipLibCheck
```

Observed:

- `grep -rn '"vscode"' src/*.ts | grep -v extension.ts` returns nothing: every module except `src/extension.ts` — `compare.ts`, `comparison.ts`, `export.ts`, `api.ts`, `opencode.ts`, `usage.ts`, `staticSources.ts`, `catalog.ts`, `sources.ts`, `plans.ts`, `normalize.ts`, `recommend.ts`, `efficiency.ts`, `groups.ts`, `profiles.ts`, `messages.ts`, `byok.ts`, `assist.ts`, `drift.ts`, `freshness.ts`, `workspaceLabel.ts`, `types.ts` — is already `vscode`-free. `compare.ts` imports `opencodeBenchmarkFamilies` from `opencode.ts`, which uses `node:child_process`, so the graph needs Node, not a browser; that's fine for a CLI.
- `scripts/cli-spike.ts` (committed alongside this doc, same non-shipped status as `scripts/opencode-smoke.ts`) reuses `validSnapshot` (`src/api.ts`), `savedOptions`/`compare` (`src/compare.ts`), `staticModels`/`isStaticSource` (`src/staticSources.ts`), `discoverOpenCode`/`createOpenCodeRunner` (`src/opencode.ts`), `recommend` (`src/recommend.ts`), and `exportCsv`/`exportSnapshot` (`src/export.ts`) without modification.
- Running it against `test/fixtures/cli/{snapshot,options}.json` with `--source codex` prints a 6-row CSV (one row per known Codex model) with correct pricing/mapping status, and with `--format snapshot` prints a version-3 JSON snapshot — both byte-identical in shape to what `src/extension.ts` writes today.
- Running it with `--source opencode` spawns the real local `opencode models --verbose` (read-only discovery, the same call `src/opencode.ts` already makes) and prints free-tier rows from this machine's Zen connection.
- Running it with `--source copilot` fails cleanly (`Source "copilot" needs a live editor session (vscode.lm) and has no offline/CLI equivalent`) instead of crashing — Copilot discovery has no CLI/offline equivalent, since `vscode.lm.selectChatModels` only exists inside a running editor extension host.
- The esbuild bundle (`--platform=node`, no `--external:vscode`) succeeds and contains zero references to `"vscode"`; `tsc --noEmit` with the project's own compiler options passes.
- A finding during the spike: composing `--source` with a saved options file must go through `migrateOptions` (via `savedOptions`), not `parseOptions` alone — `parseOptions` validates a billing mode against a source but does not reconcile an incompatible pairing the way `migrateOptions` does on a source switch. The spike passes the override through `savedOptions` for this reason; a real CLI must do the same.

## Input/output contract

- **Input:** a validated benchmark snapshot file (`Snapshot` shape, checked with `validSnapshot`) and an options file (`Options` shape, tolerantly migrated with `savedOptions`), plus a `--source` selecting which model list to compare. No implicit file discovery, no environment-variable credentials.
- **Output:** CSV (`exportCsv`) or JSON snapshot (`exportSnapshot`) on stdout; non-zero exit with a one-line message to stderr on any invalid input.
- **Sources:** the 7 static registries and OpenCode (live CLI discovery) work standalone. Copilot cannot: its only discovery mechanism, `vscode.lm.selectChatModels`, requires a running VS Code extension host and Copilot sign-in — there is no documented CLI or HTTP equivalent (see `docs/model-switching-investigation.md`'s survey of `vscode.lm`). A standalone CLI is therefore Copilot-incomplete by construction, not by a missing adapter.

## Offline behavior

No benchmark data ships in the repo; a snapshot file must be supplied (e.g. one the extension has already cached and validated, or one produced by a separate authenticated fetch step outside this tool's scope). Pricing (catalog/static registries) is bundled and needs no network access. OpenCode discovery is a local process spawn, not a network call. The CLI itself never needs the Artificial Analysis API key — fetching a fresh snapshot, if ever added, would be a separate explicit step, never an implicit read of the editor's SecretStorage (which a CLI process cannot reach regardless).

## Candidates considered

- **Plain CLI (accepted as feasible):** explicit file-in/stdout-out, as spiked. Small, composable, testable without a browser or editor.
- **Interactive TUI:** deferred per the roadmap's own ordering ("consider an interactive terminal UI only after the CLI workflow is justified"); no work done here.
- **Bundling a `bin` inside the VSIX (rejected):** the extension's `.vscodeignore` allowlist ships only `dist/**` and a few docs; adding a Node-executable entry point to the same package conflates two different distribution and versioning concerns (a VS Code extension vs. an npm CLI package) for a feature with no confirmed demand yet.

## Packaging and maintenance cost

- No `bin` field or `engines.node` exists in `package.json` today; either would need adding for a real CLI, plus a decision on distribution (separate npm package under the same repo, or a second `dist/cli.cjs` entry point built by `scripts/build.mjs`).
- The pair (A/B comparison) exporters are not in `src/export.ts` — they're built inline in `src/extension.ts:1102-1217` and would need extracting into a reusable, `vscode`-free function before a CLI could offer two-option comparison.
- BYOK rates and local usage counts (`extra.byok`, `extra.usedCounts` in `compare()`) currently come from `globalState`; a CLI would need them as explicit input files, with the same validation (`loadByokStore`) already used host-side.
- Maintaining a second entry point means every `Options`/`Snapshot`/`ByokStore` schema change needs a CLI-side fixture update in addition to the existing webview/host ones — a real, ongoing cost, not a one-time one.

## Testing strategy

Vitest already exercises every reused module (`compare.test.ts`, `export.ts` via `roadmap.test.ts`, `api.test.ts`, `opencode.test.ts`) without a `vscode` mock, so a CLI wrapper would only need to test its own argument parsing and file I/O against small fixtures like `test/fixtures/cli/*.json`, plus one golden-output test per format. `scripts/opencode-smoke.ts`'s CI pattern (non-gating job, `tsx`, sanitized output) is the template for any future real-account smoke test. The verified OpenCode client × platform × version cells the adapter reuses are recorded in `docs/integrations.md`.

## Decision

**Feasible; delivery deferred.** The reuse boundary already exists and needs no restructuring for static-source and OpenCode comparisons — proven by `scripts/cli-spike.ts` running unmodified core logic outside VS Code. Delivery is not scheduled now because: Copilot (the default, most-used source) has no CLI equivalent, so a v1 CLI would need to clearly scope out Copilot up front; the pair-export extraction and `bin`/packaging decisions are unstarted; and there is no confirmed terminal-workflow user yet. Revisit as a roadmap delivery task once at least one of those gaps has a concrete answer.

## Failure states

`scripts/cli-spike.ts` fails closed on every bad input: an unreadable/unparsable file, a snapshot that fails `validSnapshot`, an unknown `--source`, or a source with no offline equivalent all exit non-zero with a specific message and never fall back to inventing data.

## Open blockers

- No documented or unofficial way to discover Copilot models outside a running VS Code extension host — this bounds any future CLI's source coverage, not just this spike's.
- Pair-export extraction (`src/extension.ts:1102-1217`) is unstarted; a two-option CLI workflow needs it first.
