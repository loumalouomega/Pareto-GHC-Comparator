export function html(
  script: string,
  css: string,
  source: string,
  nonce: string,
): string {
  // Emoji glyphs below are placeholders for future ad-hoc icons. They sit
  // in aria-hidden spans so accessible tab/heading/button names stay clean.
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${source}; img-src ${source} data:; font-src ${source};"><link rel="stylesheet" href="${css}"><title>Pareto GHC Comparator</title></head><body>
  <header><div class="eyebrow" id="eyebrow">PARETO / GITHUB COPILOT</div><h1><span class="emoji" aria-hidden="true">📊</span> Find your model’s sweet spot.</h1><p id="subtitle">Compare benchmark quality with estimated Copilot usage. Better value is toward the upper left.</p><div class="actions" id="header-actions"><button id="refresh">🔄 Refresh data</button><button id="key" class="secondary">🔑 Set API key</button></div>
  <nav class="tabs" role="tablist" aria-label="Sections"><button id="tab-compare" class="tab" role="tab" aria-selected="true" aria-controls="panel-compare"><span class="emoji" aria-hidden="true">📊</span>Tool analysis</button><button id="tab-tools" class="tab" role="tab" aria-selected="false" aria-controls="panel-tools" tabindex="-1"><span class="emoji" aria-hidden="true">⚖️</span>Compare tools</button><button id="tab-plan" class="tab" role="tab" aria-selected="false" aria-controls="panel-plan" tabindex="-1"><span class="emoji" aria-hidden="true">💰</span>Plan &amp; budget</button><button id="tab-usage" class="tab" role="tab" aria-selected="false" aria-controls="panel-usage" tabindex="-1"><span class="emoji" aria-hidden="true">📈</span>Usage</button><button id="tab-settings" class="tab" role="tab" aria-selected="false" aria-controls="panel-settings" tabindex="-1"><span class="emoji" aria-hidden="true">⚙️</span>Settings</button></nav></header>
 <main>
  <p id="status" role="status" aria-live="polite"></p>
 <section id="snapshot-banner" class="card snapshot-banner" aria-labelledby="snapshot-title" role="status" hidden>
  <h2 id="snapshot-title"><span class="emoji" aria-hidden="true">🧾</span> Historical snapshot — read-only</h2>
  <p id="snapshot-detail"></p>
  <p id="snapshot-basis" class="hint"></p>
  <p id="snapshot-limits" class="hint"></p>
  <div class="controls"><button id="snapshot-back" class="secondary">↩︎ Back to live comparison</button></div>
 </section>
 <div id="panel-tools" class="tab-panel" role="tabpanel" aria-labelledby="tab-tools" hidden>
 <section class="card comparison-controls" aria-labelledby="comparison-title">
  <h2 id="comparison-title"><span class="emoji" aria-hidden="true">⚖️</span> Compare tools</h2>
 <label class="checkbox-label"><input id="comparison-enabled" type="checkbox">Compare options</label>
 <label>Tool A<select id="comparison-source-a" disabled><option value="copilot">GitHub Copilot</option><option value="opencode">OpenCode</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option><option value="gemini-cli">Gemini CLI</option><option value="cursor">Cursor</option><option value="windsurf">Windsurf</option><option value="aider">Aider</option><option value="amazon-q">Amazon Q Developer</option></select></label>
 <label>Tool B<select id="comparison-source-b" disabled><option value="copilot">GitHub Copilot</option><option value="opencode">OpenCode</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option><option value="gemini-cli">Gemini CLI</option><option value="cursor">Cursor</option><option value="windsurf">Windsurf</option><option value="aider">Aider</option><option value="amazon-q">Amazon Q Developer</option></select></label>
 <label>Editing<select id="comparison-active"><option value="A">A</option><option value="B">B</option></select></label>
 <label>Option name<input id="comparison-name" maxlength="60"></label>
 <label class="checkbox-label"><input id="comparison-normalize" type="checkbox" disabled>Show USD equivalents</label>
 <label>View<select id="comparison-view" disabled><option value="side-by-side">Side by side</option><option value="overlay">Overlay</option></select></label>
 <p class="hint">Off by default. Tool A and Tool B pick each option's source directly; Task, billing, and the rest stay under Editing on the Tool analysis tab, since every tab's controls edit whichever option Editing selects. Side by side draws two charts; Overlay superimposes both options on one chart, converting to a USD equivalent when their billing units differ, so the same-cost tradeoffs are easier to compare.</p>
 </section>
 <section id="comparison-overlay" class="comparison-overlay" hidden aria-label="Overlay comparison"></section><p id="comparison-status" class="sr-only" role="status" aria-live="polite"></p>
 <section id="comparison-panels" class="comparison-panels" hidden aria-label="Comparison results"></section><p id="comparison-delta" role="status" hidden></p>
 </div>
 <div id="panel-compare" class="tab-panel" role="tabpanel" aria-labelledby="tab-compare">
  <section class="controls" aria-label="Comparison controls">
  <label>Source<select id="source"><option value="copilot">GitHub Copilot</option><option value="opencode">OpenCode</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option><option value="gemini-cli">Gemini CLI</option><option value="cursor">Cursor</option><option value="windsurf">Windsurf</option><option value="aider">Aider</option><option value="amazon-q">Amazon Q Developer</option></select></label>
  <label>Task<select id="preset"><option value="coding">Coding</option><option value="general">General</option><option value="agentic">Agentic</option></select></label>
  <label>Billing<select id="billing"><option value="credits">AI credits</option><option value="legacy">Legacy premium requests</option><option value="usd">USD</option></select></label>
 <label id="plan-label" hidden>Annual plan<select id="plan"><option value="pro">Copilot Pro</option><option value="proPlus">Copilot Pro+</option></select></label>
  <label>Chart view<select id="display-chart"><option value="task">Intelligence vs. cost per task</option><option value="workload">Quality vs. workload cost</option></select></label>
 <label class="filter">Filter models<input id="filter" type="search" placeholder="Model name or ID" maxlength="200"></label>
 </section>
 <fieldset id="tokens"><legend>Illustrative token workload · editable estimate</legend><div class="token-grid">
 <label>Uncached input<input id="input" type="number" required min="0" max="100000000" step="1" value="1000"></label><label>Cache read<input id="read" type="number" required min="0" max="100000000" step="1" value="0"></label><label>Cache write<input id="write" type="number" required min="0" max="100000000" step="1" value="0"></label><label>Output (including reasoning)<input id="output" type="number" required min="0" max="100000000" step="1" value="1000"></label></div>
     <div class="controls"><button id="usage-prefill" class="secondary">📈 Use my average</button> <span id="usage-prefill-note" class="hint" role="status"></span></div>
 <p class="hint">Input buckets are disjoint. Cache-write tokens use the write rate when listed, otherwise the normal input rate. This is not measured task cost or your account bill.</p></fieldset>
  <p id="legacy-note" class="hint" hidden>For existing annual Pro / Pro+ plans using legacy billing. Manual model selection, per interaction; Auto discounts and code review are not included.</p>
 <section class="recommendation-card" aria-label="Find a model"><div class="controls">
 <label>Find a model<select id="recommendation-mode"><option value="budget">Best under budget</option><option value="nearBest">Cheapest near best</option></select></label>
 <label id="budget-label"><span id="budget-unit">Maximum AI credits</span><input id="budget" type="number" required min="0" max="100000000" step="any" value="1"></label>
 <label id="gap-label" hidden>Allowed score gap (index points)<input id="score-gap" type="number" required min="0" max="100000000" step="any" value="3"></label>
 <p id="recommendation-result" role="status" aria-live="polite"></p>
  </div><p id="budget-suggestion" class="hint" role="status"></p><button id="budget-apply" class="secondary" hidden>✅ Use suggested budget</button></section>
  <section class="chart-card" aria-labelledby="chart-title"><div class="chart-heading"><h2 id="chart-title">Quality vs. usage cost</h2><span id="count"></span></div><div id="legend" aria-label="Providers"></div><div id="chart-wrap"><canvas id="chart" role="img" aria-label="Model quality and cost scatter plot. Arrow keys move between plotted models and Enter selects one; the table below provides all values." aria-describedby="chart-desc"></canvas></div><p id="chart-desc" class="sr-only"></p><p id="chart-status" class="sr-only" role="status" aria-live="polite"></p><p id="empty" hidden></p><p class="hint" id="chart-hint">Dotted line and a ring around the point: Pareto frontier — no displayed model offers both a lower or equal cost and a higher or equal score, with one strict improvement. Shaded quadrant: most attractive — above-median score at or below median cost, repeated in the table's Comparison column. Star markers: recommendations, which consider only the displayed, comparable models. Colours come from a colour-blind-safe palette, but never carry meaning on their own; focus the chart and use the arrow keys to hear each plotted model.
  <div id="free-bar-wrap" hidden><h3 id="free-bar-title">Best free options</h3><div id="free-bar-chart-wrap"><canvas id="free-bar" role="img" aria-label="Free-tier models ranked by benchmark score. The list below provides all values and model selection."></canvas></div><p id="free-bar-empty" class="hint" hidden></p><ul id="free-bar-list" class="sr-only"></ul><p class="hint">Free-tier models ranked by benchmark score only — cost is zero, so no cost unit applies. PNG export captures the Pareto chart above, not this bar.</p></div></section>
  <div class="results"><section class="table-card" aria-labelledby="table-title"><h2 id="table-title"><span class="emoji" aria-hidden="true">📋</span> Models exposed to this extension</h2><div class="table-scroll"><table><caption class="sr-only">Filtered comparison results. Select a model to inspect its benchmark and tradeoffs.</caption><thead><tr><th scope="col">Model</th><th scope="col">Score</th><th id="cost-heading" scope="col">AI credits</th><th id="efficiency-heading" scope="col">Cost / quality</th><th scope="col">Comparison</th><th scope="col">Pick</th></tr></thead><tbody id="rows"></tbody></table></div></section>
  <aside aria-labelledby="details-title"><h2 id="details-title"><span class="emoji" aria-hidden="true">🔍</span> Model details</h2><div id="details"><p>Select a model in the chart or table.</p></div></aside></div>
  <section class="card" aria-labelledby="custom-title" id="custom-card"><h2 id="custom-title"><span class="emoji" aria-hidden="true">📌</span> Custom comparison</h2><p class="hint">Pin up to 6 models with the Pick checkboxes above for a head-to-head on the current task and cost basis. Picks stay on this machine until cleared; a pick that leaves the view stays listed until removed, never swapped.</p><div class="controls"><button id="custom-clear" class="secondary">🧹 Clear custom comparison</button></div><div id="custom-chart-wrap" hidden><canvas id="custom-chart" role="img" aria-label="Picked models ranked by benchmark score. The table below provides all values."></canvas></div><p id="custom-empty" class="hint" role="status">No models picked yet — use Pick in the table above.</p><div class="table-scroll"><table><caption class="sr-only">Manually picked models for head-to-head comparison.</caption><thead><tr><th scope="col">Model</th><th scope="col">Score</th><th id="custom-cost-heading" scope="col">Cost</th><th scope="col">Comparison</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead><tbody id="custom-rows"></tbody></table></div></section>
  <section class="card" aria-labelledby="sensitivity-title" id="sensitivity-card"><h2 id="sensitivity-title"><span class="emoji" aria-hidden="true">🔬</span> Workload sensitivity</h2><p class="hint">What-if sweep: how the recommendation and Pareto frontier move as the output share of the token workload varies. Illustrative only — not measured cost, not your usage history, and uniform volume scaling never changes cost orderings.</p><p id="sensitivity-note" class="hint" role="status"></p><div class="table-scroll"><table><caption class="sr-only">Output-share ranges with a constant recommendation and frontier.</caption><thead><tr><th scope="col">Output share</th><th scope="col">Best</th><th scope="col">Frontier</th></tr></thead><tbody id="sensitivity-rows"></tbody></table></div></section>
 </div>
 <div id="panel-plan" class="tab-panel" role="tabpanel" aria-labelledby="tab-plan" hidden>
 <section class="card profile-bar" aria-labelledby="profiles-title">
  <h2 id="profiles-title"><span class="emoji" aria-hidden="true">💾</span> Saved workloads</h2>
  <label>Saved workload<select id="profile"><option value="">Custom</option></select></label>
  <button id="profile-apply" class="secondary">✅ Apply</button>
  <label>Profile name<input id="profile-name" maxlength="60" placeholder="e.g. Debugging"></label>
  <button id="profile-save">💾 Save as</button><button id="profile-update" class="secondary">🔄 Update</button><button id="profile-rename" class="secondary">✏️ Rename</button><button id="profile-delete" class="secondary">🗑️ Delete</button>
 <span id="profile-state" role="status"></span>
 </section>
  <section class="card" aria-labelledby="scenario-title" id="scenario-card">
   <h2 id="scenario-title"><span class="emoji" aria-hidden="true">💰</span> Monthly spending scenario</h2>
  <p class="hint">What-if projection from your inputs and published plan rules — separate from local history and per-task/workload estimates, and never a bill.</p>
  <div class="controls">
  <label>Plan<select id="scenario-plan"><option value="none">Off</option></select></label>
  <label>Expected requests / month (low)<input id="scenario-requests-low" type="number" min="0" max="10000000" step="1" value="0"></label>
  <label>Expected requests / month (high)<input id="scenario-requests-high" type="number" min="0" max="10000000" step="1" value="0"></label>
     <button id="scenario-prefill" class="secondary">📈 Use my request history</button> <span id="scenario-prefill-note" class="hint" role="status"></span>
  </div>
  <fieldset id="scenario-custom" hidden><legend>Custom plan · your own figures, not verified</legend>
  <label>Monthly fee (USD)<input id="scenario-custom-fee" type="number" min="0" max="1000000" step="any"></label>
  <label><span id="scenario-custom-allowance-unit">Included AI credits / month</span><input id="scenario-custom-allowance" type="number" min="0" max="1000000000" step="any"></label>
  <label><span id="scenario-custom-overage-unit">USD per extra AI credit</span><input id="scenario-custom-overage" type="number" min="0" max="1000000" step="any"></label>
  </fieldset>
  <p id="scenario-plan-note" class="hint" role="status"></p>
  <div id="scenario-result" role="status" aria-live="polite"></div>
  <ul id="scenario-notes" class="hint"></ul>
  </section>
 </div>
 <div id="panel-usage" class="tab-panel" role="tabpanel" aria-labelledby="tab-usage" hidden>
  <section class="card" aria-labelledby="usage-title" id="usage-card">
   <h2 id="usage-title"><span class="emoji" aria-hidden="true">📈</span> Local usage</h2><div class="controls">
   <button id="usage-scan" class="secondary">🔍 Scan local usage</button>
   <button id="usage-pause" class="secondary" hidden>⏸️ Pause watching</button>
   <button id="usage-clear" class="secondary">🧹 Erase local usage</button>
   <button id="usage-show" class="secondary">📄 Show stored usage data</button>
  <label>Keep history (days)<input id="usage-retention" type="number" min="0" max="3650" step="1" placeholder="Unlimited"></label>
  <label class="checkbox-label"><input id="usage-full-paths" type="checkbox">Show full paths</label>
  <span id="usage-watching" role="status"></span>
  </div><div class="usage-sources-block"><h3>Sources</h3><div id="usage-sources"></div></div><p id="usage-editors-note" class="hint"></p><div id="usage-editors"></div><p id="usage-diagnostics" role="status"></p><p id="usage-summary" role="status" aria-live="polite"></p><div id="usage-models"></div><div id="usage-days"></div><div id="usage-workspaces"></div><p id="usage-unknown" class="hint"></p><p class="hint">GitHub Copilot chat sessions: local estimates only, not measured billing and not your account bill. Hidden system and context tokens are not visible locally, and tokenizers differ by model.</p></section>
  <section class="card" aria-labelledby="claude-usage-title" id="claude-usage-card" hidden>
   <h2 id="claude-usage-title"><span class="emoji" aria-hidden="true">🧠</span> Claude Code usage</h2>
   <p class="hint">A separate ledger in tokens, read from Claude Code transcripts you included above. It is never added to the Copilot figures: Copilot counts premium requests or AI credits, and Claude Code counts tokens under a different billing model. No price is shown, because the client's own cost figure is not a rate we can verify.</p>
   <p id="claude-usage-diagnostics" role="status"></p>
   <p id="claude-usage-summary" role="status" aria-live="polite"></p>
   <div id="claude-usage-models"></div>
   <div id="claude-usage-days"></div>
   <div id="claude-usage-workspaces"></div>
   <p id="claude-usage-exclusions" class="hint"></p>
  </section>
  <section class="card" aria-labelledby="byok-title" id="byok-card" hidden>
   <h2 id="byok-title"><span class="emoji" aria-hidden="true">💳</span> Provider-billed (BYOK) rates</h2>
   <div class="controls"><button id="byok-save" class="secondary">💾 Save BYOK rates</button><button id="byok-clear" class="secondary">🧹 Clear fields</button></div>
  <p class="hint">USD per million tokens for OpenCode models billed directly by their provider. Saved locally; free-tier models are never overridden and invalid entries keep the model unpriced.</p>
  <div id="byok-table"></div>
  </section>
  <section class="card" aria-labelledby="spotlight-title" id="spotlight-card">
     <h2 id="spotlight-title"><span class="emoji" aria-hidden="true">🎁</span> Free-tier spotlight</h2><p id="spotlight-result" role="status" aria-live="polite"></p></section>
 </div>
 <div id="panel-settings" class="tab-panel" role="tabpanel" aria-labelledby="tab-settings" hidden>
  <section class="card" aria-labelledby="display-title">
   <h2 id="display-title"><span class="emoji" aria-hidden="true">📊</span> Chart display</h2>
  <div class="controls">
  <label class="checkbox-label"><input id="display-labels" type="checkbox" checked>Model labels</label>
  <label class="checkbox-label"><input id="display-frontier" type="checkbox" checked>Pareto frontier line</label>
  <label class="checkbox-label"><input id="display-quadrant" type="checkbox" checked>Most attractive quadrant</label>
  <label>Cost scale<select id="display-scale"><option value="auto">Auto</option><option value="log">Logarithmic</option><option value="linear">Linear</option></select></label>
  <label>Table sort<select id="display-sort"><option value="default">Discovery order</option><option value="efficiency">Cost per quality</option></select></label>
  <label class="checkbox-label" id="free-only-label" hidden><input id="free-only" type="checkbox">Free tier only</label>
  </div>
  </section>
  <section class="card" aria-labelledby="models-title">
   <h2 id="models-title"><span class="emoji" aria-hidden="true">✅</span> Included models</h2>
     <div class="controls"><button id="include-all" class="secondary">✅ Select all</button><button id="include-none" class="secondary">🧹 Select none</button><label class="checkbox-label"><input id="only-mine" type="checkbox">Only my models</label>
  <label class="filter">Filter models for selection<input id="checklist-search" type="search" placeholder="Filter families, models, or thinking levels" maxlength="200"></label></div>
  <p class="hint" id="checklist-hint">Families contain models; models with multiple thinking variants expand. Select a family, a model, or an individual thinking level. While filtering, bulk actions apply to matching models.</p>
  <div class="controls"><label class="checkbox-label"><input id="watchlist-alerts" type="checkbox">Watchlist change alerts</label></div>
  <p class="hint">Off by default. When on, refreshing benchmark data notifies once if a pinned model's price, score, mapping, or availability changed since the previous snapshot.</p>
  <div id="checklist"></div>
  </section>
  <section class="card" aria-labelledby="exports-title">
   <h2 id="exports-title"><span class="emoji" aria-hidden="true">📤</span> Export &amp; import</h2>
   <div class="controls">
   <button id="export-csv" class="secondary">📄 Export CSV</button>
   <button id="export-snapshot" class="secondary">🧾 Export snapshot JSON</button>
   <button id="export-badge" class="secondary">🏷️ Export badge JSON</button>
   <button id="export-png" class="secondary">📸 Export chart PNG</button>
   <button id="import-snapshot" class="secondary">📂 Import snapshot JSON (read-only)</button>
  <span id="export-note" role="status"></span>
  </div>
  <p class="hint">Importing reopens a snapshot JSON exported earlier as historical, read-only data. It never changes the live comparison, your saved workloads, or your exclusions.</p>
  </section>
 </div>
  <footer>Benchmarks by <a href="https://artificialanalysis.ai/">Artificial Analysis</a> · <span id="provenance">Not loaded</span><br><span id="pricing-line">Copilot pricing: <a id="pricing-link" href="https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing">GitHub Docs</a></span> · <span id="catalog"></span><p id="pricing-note">Benchmark results describe the tested variant, not guaranteed performance in Copilot. Pricing updates ship with extension releases.</p></footer>
 </main><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
