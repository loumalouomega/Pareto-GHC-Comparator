# Development

Build, test, and install the extension locally. No API key is needed for automated tests.

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

Press **F5** to open an Extension Development Host after the build task runs. To use an existing Chromium installation for UI tests, set `PARETO_CHROMIUM_PATH` to its executable. To refresh the preview from an already validated benchmark snapshot, run `node --import tsx scripts/capture-screenshot.mjs /path/to/snapshot.json`. The helper uses explicit illustrative variant selections and never accepts or stores an API key.

The packaged VSIX contains the compiled extension, webview assets, documentation, and dependency license notices. It does not include test fixtures or credentials.

Tests cover Pareto ties and dominance, filtering, missing data, pricing formulas and thresholds, expired promotions, exact and ambiguous mappings, API pagination and failures, cache retention, host/webview messages, secret isolation, recommendations and ties, profile persistence and migration, keyboard selection, and themed browser rendering. Browser tests use synthetic model data and a mocked host; a real-account smoke test still requires Copilot sign-in and an Artificial Analysis key.

See [contributor guidance](../AGENTS.md) for implementation details and validation requirements, [the changelog](../CHANGELOG.md) for version history, and [the roadmap](roadmap.md) for planned work.

## VS Code tasks and installation

Run **Tasks: Run Build Task** (`Ctrl+Shift+B`) for the default `build` task. **Tasks: Run Task** also offers:

| Task | Result |
| --- | --- |
| `build` | Compile the extension and webview. |
| `package` | Type-check, build, and generate `pareto-ghc-comparator.vsix`. |
| `install` | Package the current source, then install the VSIX into VS Code using `--force`. |

Run `npm ci` once before using the tasks. The install task requires the `code` command on PATH. On macOS, use **Shell Command: Install 'code' command in PATH**. Reload the VS Code window after updating the extension. For another VS Code profile or Insiders, run the package task and use that editor's **Extensions: Install from VSIX…** command.

The VSIX filename stays constant as versions change; the version inside it comes from `package.json`. `npm run install:extension` is the equivalent terminal command. It is deliberately separate from npm's dependency installation lifecycle.
