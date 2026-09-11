export function html(
  script: string,
  css: string,
  source: string,
  nonce: string,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${source}; img-src ${source} data:; font-src ${source};"><link rel="stylesheet" href="${css}"><title>Pareto GHC Comparator</title></head><body>
  <header><div class="eyebrow" id="eyebrow">PARETO / GITHUB COPILOT</div><h1>Find your model’s sweet spot.</h1><p id="subtitle">Compare benchmark quality with estimated Copilot usage. Better value is toward the upper left.</p><div class="actions"><button id="refresh">Refresh data</button><button id="key" class="secondary">Set API key</button></div></header>
 <main>
 <section class="profile-bar" aria-label="Workload profiles">
 <label>Saved workload<select id="profile"><option value="">Custom</option></select></label>
 <button id="profile-apply" class="secondary">Apply</button>
 <label>Profile name<input id="profile-name" maxlength="60" placeholder="e.g. Debugging"></label>
 <button id="profile-save">Save as</button><button id="profile-update" class="secondary">Update</button><button id="profile-rename" class="secondary">Rename</button><button id="profile-delete" class="secondary">Delete</button>
 <span id="profile-state" role="status"></span>
 </section>
  <section class="controls" aria-label="Comparison controls">
  <label>Source<select id="source"><option value="copilot">GitHub Copilot</option><option value="opencode">OpenCode</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option><option value="gemini-cli">Gemini CLI</option><option value="cursor">Cursor</option><option value="windsurf">Windsurf</option><option value="aider">Aider</option><option value="amazon-q">Amazon Q Developer</option></select></label>
  <label>Task<select id="preset"><option value="coding">Coding</option><option value="general">General</option><option value="agentic">Agentic</option></select></label>
  <label>Billing<select id="billing"><option value="credits">AI credits</option><option value="legacy">Legacy premium requests</option><option value="usd">USD</option></select></label>
 <label id="plan-label" hidden>Annual plan<select id="plan"><option value="pro">Copilot Pro</option><option value="proPlus">Copilot Pro+</option></select></label>
 <label class="filter">Filter models<input id="filter" type="search" placeholder="Model name or ID" maxlength="200"></label>
 </section>
 <fieldset id="tokens"><legend>Illustrative token workload · editable estimate</legend><div class="token-grid">
 <label>Uncached input<input id="input" type="number" required min="0" max="100000000" step="1" value="1000"></label><label>Cache read<input id="read" type="number" required min="0" max="100000000" step="1" value="0"></label><label>Cache write<input id="write" type="number" required min="0" max="100000000" step="1" value="0"></label><label>Output (including reasoning)<input id="output" type="number" required min="0" max="100000000" step="1" value="1000"></label></div>
 <p class="hint">Input buckets are disjoint. Cache-write tokens use the write rate when listed, otherwise the normal input rate. This is not measured task cost or your account bill.</p></fieldset>
  <p id="legacy-note" class="hint" hidden>For existing annual Pro / Pro+ plans using legacy billing. Manual model selection, per interaction; Auto discounts and code review are not included.</p>
  <section class="controls" aria-label="Chart display settings">
  <label>Chart view<select id="display-chart"><option value="task">Intelligence vs. cost per task</option><option value="workload">Quality vs. workload cost</option></select></label>
  <label class="checkbox-label"><input id="display-labels" type="checkbox" checked>Model labels</label>
  <label class="checkbox-label"><input id="display-frontier" type="checkbox" checked>Pareto frontier line</label>
  <label class="checkbox-label"><input id="display-quadrant" type="checkbox" checked>Most attractive quadrant</label>
  <label>Cost scale<select id="display-scale"><option value="auto">Auto</option><option value="log">Logarithmic</option><option value="linear">Linear</option></select></label>
  <label>Table sort<select id="display-sort"><option value="default">Discovery order</option><option value="efficiency">Cost per quality</option></select></label>
  <label class="checkbox-label" id="free-only-label" hidden><input id="free-only" type="checkbox">Free tier only</label>
  </section>
  <section class="controls" aria-label="Model inclusion">
  <div><strong>Included models</strong> <button id="include-all" class="secondary">Select all</button> <button id="include-none" class="secondary">Select none</button></div>
  <label class="filter">Filter models for selection<input id="checklist-search" type="search" placeholder="Filter families, models, or thinking levels" maxlength="200"></label>
  <p class="hint" id="checklist-hint">Families contain models; models with multiple thinking variants expand. Select a family, a model, or an individual thinking level. While filtering, bulk actions apply to matching models.</p>
  <div id="checklist"></div>
  </section>
  <section class="controls" aria-label="Exports">
  <button id="export-csv" class="secondary">Export CSV</button>
  <button id="export-snapshot" class="secondary">Export snapshot JSON</button>
  <button id="export-badge" class="secondary">Export badge JSON</button>
  <button id="export-png" class="secondary">Export chart PNG</button>
  <span id="export-note" role="status"></span>
  </section>
  <section class="recommendation-card" aria-labelledby="spotlight-title" id="spotlight-card">
  <h2 id="spotlight-title">Free-tier spotlight</h2><p id="spotlight-result" role="status" aria-live="polite"></p></section>
 <section class="recommendation-card" aria-labelledby="recommendation-title">
 <h2 id="recommendation-title">Find a model</h2><div class="controls">
 <label>Recommendation mode<select id="recommendation-mode"><option value="budget">Best under budget</option><option value="nearBest">Cheapest near best</option></select></label>
 <label id="budget-label"><span id="budget-unit">Maximum AI credits</span><input id="budget" type="number" required min="0" max="100000000" step="any" value="1"></label>
 <label id="gap-label" hidden>Allowed score gap (index points)<input id="score-gap" type="number" required min="0" max="100000000" step="any" value="3"></label>
 </div><p id="recommendation-result" role="status" aria-live="polite"></p><p class="hint">Recommendations use only the displayed, comparable models. Star markers identify recommendations; the dotted line remains the Pareto frontier.</p></section>
 <p id="status" role="status" aria-live="polite"></p>
 <section class="chart-card" aria-labelledby="chart-title"><div class="chart-heading"><h2 id="chart-title">Quality vs. usage cost</h2><span id="count"></span></div><div id="legend" aria-label="Providers"></div><div id="chart-wrap"><canvas id="chart" role="img" aria-label="Model quality and cost scatter plot. The table below provides all values and model selection."></canvas></div><p id="empty" hidden></p><p class="hint">Dotted line: Pareto frontier — no displayed model offers both a lower or equal cost and a higher or equal score, with one strict improvement. Shaded quadrant: most attractive — above-median score at or below median cost.</p></section>
 <div class="results"><section class="table-card" aria-labelledby="table-title"><h2 id="table-title">Models exposed to this extension</h2><div class="table-scroll"><table><caption class="sr-only">Filtered comparison results. Select a model to inspect its benchmark and tradeoffs.</caption><thead><tr><th scope="col">Model</th><th scope="col">Score</th><th id="cost-heading" scope="col">AI credits</th><th id="efficiency-heading" scope="col">Cost / quality</th><th scope="col">Comparison</th></tr></thead><tbody id="rows"></tbody></table></div></section>
 <aside aria-labelledby="details-title"><h2 id="details-title">Model details</h2><div id="details"><p>Select a model in the chart or table.</p></div></aside></div>
  <footer>Benchmarks by <a href="https://artificialanalysis.ai/">Artificial Analysis</a> · <span id="provenance">Not loaded</span><br><span id="pricing-line">Copilot pricing: <a id="pricing-link" href="https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing">GitHub Docs</a></span> · <span id="catalog"></span><p id="pricing-note">Benchmark results describe the tested variant, not guaranteed performance in Copilot. Pricing updates ship with extension releases.</p></footer>
 </main><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
