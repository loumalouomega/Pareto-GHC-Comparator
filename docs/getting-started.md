# Getting started

Install Pareto GHC Comparator and open your first comparison.

1. Install VS Code 1.100 or newer and enable GitHub Copilot Chat. Sign in to an account with model access.
2. Run **Extensions: Install from VSIX…** and select `pareto-ghc-comparator.vsix`.
3. Run **Pareto GHC: Open Model Comparison** from the Command Palette.
4. Click **Set API key** and enter your own [Artificial Analysis Free API key](https://artificialanalysis.ai/data-api). The key is stored in VS Code SecretStorage, not settings or the webview.
5. Choose **Coding**, **General**, or **Agentic**, select a billing mode, and edit the illustrative token workload if needed.
6. Select a chart point or a model button in the table to inspect the tested variant and cost tradeoff. **Copy model name** lets you select that model in Copilot yourself.

## Model mapping

An unmatched or ambiguous model stays in the table with an explanation. Model details show **Exact match**, **User selected**, **Needs selection**, or **Missing benchmark**. The searchable variant picker lists candidates from explicitly mapped model families, including alternate names used by Artificial Analysis. A single candidate resolves automatically; multiple reasoning variants require your choice.

Enable **Show other benchmarks for manual mapping** only when you need a benchmark outside the suggested family. Manual selections persist locally. **Use automatic matching** removes the override. If a selected variant disappears from the API, it stays unresolved until you choose a replacement or reset it; another variant is never substituted silently. A matching family does not verify Copilot's reasoning configuration. Models without verified pricing remain unpriced.
