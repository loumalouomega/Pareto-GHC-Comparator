# Getting started

Install Pareto GHC Comparator and open your first comparison.

1. Install VS Code 1.100 or newer and enable GitHub Copilot Chat. Sign in to an account with model access.
2. Run **Extensions: Install from VSIX…** and select `pareto-ghc-comparator.vsix`.
3. Run **Pareto GHC: Open Model Comparison** from the Command Palette.
4. Click **Set API key** and enter your own [Artificial Analysis Free API key](https://artificialanalysis.ai/data-api). The key is stored in VS Code SecretStorage, not settings or the webview.
5. Choose **Coding**, **General**, or **Agentic**, select a billing mode, and edit the illustrative token workload if needed.
6. Select a chart point or a model button in the table to inspect the tested variant and cost tradeoff. For OpenCode and some static-source models, **Copy model ID** copies an id verified against that client's own docs (with a hint showing where to paste it, e.g. `codex -m <id>`); otherwise **Copy model name** copies the display name for you to select in the client's own model picker — see `docs/model-switching-investigation.md` for what's verified per client and why there's no automatic "apply" button.

## Comparing OpenCode models

Use the **Source** selector to switch between GitHub Copilot and OpenCode. Switching sources resets billing to that source's default (AI credits for Copilot, USD for OpenCode) and clears the selection; manual benchmark mappings are namespaced per source and never collide.

Prerequisites for OpenCode:

- OpenCode CLI **1.18.30 or newer** with a native `opencode` binary on PATH: the install-script default (`~/.opencode/bin/`), a global npm install (`npm install -g opencode-ai`, including its Windows `node_modules\opencode-ai\bin\opencode.exe` layout), or another native install. Script-only `.cmd`/`.ps1`/`.bat` shims are not supported.
- At least one provider connected (`opencode providers login` in the terminal or `/connect` in the TUI).
- Executable resolution (including the npm layout on Windows, and an executable path containing spaces) is verified in CI on Linux, macOS, and Windows, and locally on Linux with real accounts. Priced/unpriced provider listings from a real signed-in account are verified on Linux only; macOS/Windows CI runs are credential-free and see only the Zen free tier. See [Testing](testing.md#tier-1-validation) for the run evidence.

The listing is the configured, usable set for the current project. Each reasoning variant appears as its own row (e.g. `GPT-5.4 (high)`). If the binary is missing, nothing is listed, or discovery fails, the status line explains what to do; failed refreshes retain the previous listing.

## Model mapping

An unmatched or ambiguous model stays in the table with an explanation. Model details show **Exact match**, **User selected**, **Needs selection**, or **Missing benchmark**. The searchable variant picker lists candidates from explicitly mapped model families, including alternate names used by Artificial Analysis. A single candidate resolves automatically; multiple reasoning variants require your choice.

Enable **Show other benchmarks for manual mapping** only when you need a benchmark outside the suggested family. Manual selections persist locally. **Use automatic matching** removes the override. If a selected variant disappears from the API, it stays unresolved until you choose a replacement or reset it; another variant is never substituted silently. A matching family does not verify Copilot's reasoning configuration. Models without verified pricing remain unpriced.
