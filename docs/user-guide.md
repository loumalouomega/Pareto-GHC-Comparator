# User guide

How recommendations, saved workloads, and the Pareto chart work.

## Layout

The panel has five tabs; the status line above them reports messages from any tab.

- **Tool analysis** — the default tab, first in the tab order. Source, task, billing, chart view, and model filter; the token workload (in the workload chart view); **Find a model**; the chart, table, and model details. Model details show the essentials first; **More details** holds the cost breakdown, pricing source and BYOK actions, pinning, and benchmark mapping, and opens by itself when a model has a missing benchmark or an unresolved price. While Compare options is on, this tab's controls edit whichever option **Editing** (on Compare tools) currently selects.
- **Compare tools** — turns on comparing two sources/tools side by side or overlaid (**Compare options**, off by default): **Tool A**/**Tool B** pick each option's source, and once on, this tab shows the results too — per-option panels or the overlaid chart, plus the B-minus-A delta. See "Compare options" below.
- **Plan & budget** — saved workload profiles and the monthly spending scenario.
- **Usage** — local Copilot usage, OpenCode BYOK rates, and the free-tier spotlight (the last two for OpenCode only).
- **Settings** — chart display (labels, frontier line, quadrant, cost scale, table sort, free tier only), included models, and exports.

The last open tab is restored when the panel reloads. Use the arrow keys, Home, and End to move between tabs from the keyboard.

## Recommendations

The **Find a model** panel offers two modes using the currently filtered, available, comparable models:

- **Best under budget:** highest score at or below your maximum cost; lower cost breaks score ties. Each billing mode remembers its own budget, initially 1 AI credit, 1 premium request, or 1 USD.
- **Cheapest near best:** lowest cost within an allowed score gap from the highest displayed score; higher score breaks cost ties. The default gap is 3 index points, not a percentage.

Exact ties remain recommended together. Star-shaped chart points and **★ Recommended** table labels identify recommendations separately from the Pareto frontier. The panel explains the winning score, cost, and threshold. Over-budget models stay visible for context. Missing data is excluded, and an explicit empty state explains when no model qualifies. Changes to filters, mappings, pricing inputs, or benchmark data recompute the recommendation.

## Saved workload profiles

Save named configurations across projects using the **Saved workload** controls. **Save as** creates and applies a profile from the current settings. Select an existing profile and click **Apply** to restore its source, task, billing mode, annual plan, token counts, recommendation mode, all three budgets, score gap, and monthly spending scenario.

Selecting **Custom** detaches the current workload from a saved profile without deleting it. Changing an applied profile marks it **Modified (not saved)**. **Update** explicitly overwrites that profile with the current workload. **Rename** uses the text in **Profile name**; **Delete** removes the selected profile while retaining the current workload. Names must be 1–60 characters after trimming and unique without regard to case.

Profiles live in VS Code extension global storage and are reusable across workspaces on that installation. They do not contain API keys, model mappings, model selections, or text filters. Applying a profile preserves the current filter. Existing v0.1 settings migrate to a **Custom** workload with recommendation defaults; caches and manual mappings are retained. Pre-source profiles and settings migrate to Copilot defaults with a 1 USD budget; switching sources resets billing to that source's default.

## Selecting models

The **Included models** checklist groups models by family, then by model, then by thinking level. Select a whole family, a model with all its thinking variants, or an individual thinking level. Parent checkboxes show a partial-selection state and selected/total counts. Sections collapse without losing the selection, and the **Filter models for selection** search keeps matching families and models visible. While filtering, **Select matching** and **Clear matching** (otherwise **Select all**/**Select none**) apply to the matching models. Selections persist per source and apply before the frontier, recommendations, and exports.

OpenCode reasoning variants appear as one thinking leaf per `#variant` row under a shared model. When several benchmark variants match one model (for example low/high), each variant automatically becomes its own comparable row with its own thinking-level checkbox — no manual selection needed. A model reporting its own thinking level resolves to that same level instead of expanding. To keep only one variant, pick it in the **Benchmark variant** dropdown in model details; **Use automatic matching** restores every variant. A selection that disappears stays visibly unresolved instead of silently switching to another variant. Pins still expand one model into one row per pinned variant, and a pin whose benchmark disappears shows the same unresolved, never-substituted row until you replace or unpin it.

**Custom comparison** pins up to 6 models for a head-to-head without touching the checklist: tick **Pick** in the results table, or **Pick for custom comparison** in model details. The **Custom comparison** card below the table shows those rows' scores and native costs on the current task and cost basis with its own score bar. Picks persist on the panel across reloads but stay local — they are never sent anywhere, exported, or saved to profiles. A pick that leaves the view (changed filter, exclusion, or refresh) stays listed as no-longer-in-view until removed; it is never silently swapped for another model.

**Watchlist change alerts** (off by default; toggle in Settings under Included models) send one VS Code notification per benchmark refresh when a pinned model's price, benchmark score, mapping status, or availability changed since the previous snapshot, citing both snapshot versions and retrieval dates with an **Open comparison** action. Sub-threshold score drift and unknown scores never alert; excluded pins and pins from other sources stay silent. A pinned model from the current source that is no longer discovered is reported as such until unpinned.

### Resolving an unmapped model or an unpriced model

Model details explain *why* a benchmark mapping is unresolved: no catalog entry for the model id, several catalog entries (ambiguous), no benchmark name matched the model's aliases, or a previously selected benchmark that disappeared. When the Artificial Analysis benchmark slug exactly equals the model's own identifier (optionally plus a reasoning suffix, e.g. `-high`), it is listed under **Suggested (identifier match — unverified)** with an **Apply** button — both as a quick list and as a dropdown group. A suggestion is never applied automatically, and applying one only selects a benchmark: it never sets a price. Choosing a benchmark from the dropdown now stages the choice (shown as "Will map to …") until you click **Apply mapping**; **Reset to automatic** is its own explicit action.

Pricing gets the same treatment, kept separate: model details show the pricing source (catalog, live CLI rate, static registry, free tier, or BYOK) or, when unresolved, the reason. For a provider-billed OpenCode model the CLI leaves unpriced, a same-provider, same-identifier rate from the matching static registry (currently OpenAI models against the Codex registry) is offered as an unverified suggestion with its date and source link; **Apply rate to this model** (or **Apply to all N variants** when several `#variant` models share the suggestion) writes it as a BYOK rate with visible registry provenance. A BYOK rate whose registry entry later changes or disappears stays in effect with a visible staleness warning, never silently updated. **Edit in BYOK rates** and **Remove BYOK rate** manage an applied rate from the details panel; the BYOK table itself keeps listing a model after a rate is applied, showing its provenance and a **Remove** control, instead of disappearing.

## Reading the chart

Two chart views are available under **Chart display settings**. **Intelligence vs. cost per task** (the default, mirroring the Artificial Analysis homepage) plots the selected index against a workload-independent per-task cost: the same catalog rates applied to a fixed illustrative mix of 1,000 input and 1,000 output tokens. **Quality vs. workload cost** plots against your editable token workload instead. Legacy billing shows the per-interaction multiplier in both views. Token inputs are hidden in the per-task view; budgets and recommendations follow whichever cost is displayed.

Higher scores and lower costs are preferred. The dotted line connects the Pareto frontier: models for which no displayed model has both an equal or lower cost and an equal or higher score, with at least one strict improvement. Tied models remain on the frontier. The shaded **most attractive quadrant** (toggleable) marks models with an above-median score at or below the median cost; median guides divide the plot. Filtering recomputes the comparison for the visible models. Points with missing data are excluded from the chart, with reasons shown in the table.

**Workload sensitivity** (below the custom comparison card) sweeps the output share of the token workload from 0% to 100% at a fixed total and compresses the result into ranges where the recommendation and frontier stay constant — showing where the ranking stops depending on the workload assumption. It is a labelled what-if (illustrative, never measured cost or your usage history); uniform volume scaling preserves cost orderings by construction, so only the mix is swept. An empty workload falls back to an illustrative 2,000-token total, said so on the card, and legacy billing yields one flat range since per-interaction pricing cannot move with the mix.

Positive costs use a logarithmic axis. If any comparable model has zero cost, the chart switches to a linear axis. The table supports keyboard selection and provides the same values as the chart, plus a **Cost / quality** column (cost per index point; missing values show as unresolved). **Table sort** under chart display settings orders the table by cost per quality with unpriced or unscored rows last, or keeps discovery order. Light, dark, and high-contrast themes follow VS Code.

Under the OpenCode source, a **Best free options** bar below the Pareto chart ranks every scored free-tier model by the current task's benchmark index, highest first. Cost is zero so no cost unit applies and the bar never mixes with the cost chart above; clicking a bar selects that row, and a screen-reader list carries the same values and frontier flags. The ranking follows the same baseline as the free-tier spotlight text (checklist selections and the model filter apply; the free-tier-only and only-my-models restrictions don't) and ignores billing, since scores don't depend on it. Scores are never invented: free models without a score for the current task are simply absent.

The footer shows the pricing catalog and registry dates. When either is older than 90 days, a stale-pricing nudge appears with a pointer to `docs/catalog.md`; it never blocks the comparison. Model details show each row's own pricing-source date (catalog, registry, or applied-registry rate) with a stale-source flag past the same 90-day threshold, computed independently of the footer — either can fire without the other — and More details opens by itself for a stale-priced row. Live OpenCode CLI rates, free-tier zeros, manual BYOK rates, and unresolved prices carry no source date and are never flagged.

Each successful benchmark refresh retains the previous validated snapshot locally. The table annotates scores with their change since that snapshot (for example `48 (+1.0)`), and model details cite both snapshot versions and retrieval dates. Models without a comparable previous score show unknown rather than zero. A change under 1 index point reads as within measurement noise (for example `48 (+0.3, noise)`), with the reasoning in model details — Artificial Analysis publishes a 95% confidence interval of less than ±1% for the Intelligence Index (see its intelligence-benchmarking methodology), and the 1-point threshold is conservative relative to that across the observed score range. No per-model interval is shown because the benchmark source publishes none for these indices; model details say so explicitly rather than implying one.

Under the OpenCode source, the **Provider-billed (BYOK) rates** table lists models the CLI reports as provider-billed, including ones that already have an applied rate, with fields for input, cache-read, cache-write (blank means input rate), and output USD rates per million tokens. **Save BYOK rates** stores the table locally and prices those models with a visible BYOK label; empty rows remove the entry, and invalid entries keep the model unpriced. Free-tier models are never overridden. A rate applied from a suggested static-registry match (see "Resolving an unmapped model or an unpriced model" above) shows its registry and date next to the model name, with its own **Remove** control; manually typed rates show no such provenance. Saving the form again without changing a registry-applied rate keeps its provenance.

## Compare options

**Compare tools → Compare options** turns on a second, independent set of settings, A and B: each keeps its own source, task, billing, chart view, filters, exclusions, and pinned/overridden mappings. **Tool A** and **Tool B**, right on this tab, pick each option's source directly. **Editing** picks which option every *other* tab's controls edit (task, billing, filters, workload, and so on); switching it swaps the whole panel to that option's saved settings.

**View** chooses how this tab shows both options. **Side by side** (default) draws two independent charts and tables, one per option. **Overlay** superimposes both options' models on a single chart instead — each option's own Pareto frontier, plus a combined frontier across both — so you can see at a glance which of two tools or models is the better value across the cost range. When the two options bill differently, the overlay's axis switches to a labelled USD equivalent; see `docs/billing.md`'s "Overlay view" section for the conversion rule, what gets excluded (legacy premium requests), and when the combined frontier is withheld instead of drawn.

**Show USD equivalents** (off by default) additionally shows each option's selected cost, and the B-minus-A delta, converted to USD when the two options bill differently — see `docs/billing.md`.

## Local Copilot usage

The **Local Copilot usage** card is independent of the benchmark comparison. **Scan local usage** asks for consent on first use, then reads `workspaceStorage/chatSessions` files (stable and Insiders installations, current JSONL plus legacy JSON sessions) on this machine only and reports request, token, and premium-request totals by model, day, and workspace. Only changed files are re-parsed between scans, using a size/mtime index; an opt-in file watcher keeps totals fresh with a visible indicator, mirrored in a status bar item while watching is active. **Pause watching** (Usage tab button, status bar click, or command) stops the watcher without deleting stored data or revoking consent — manual scans still work — and **Resume watching** restarts it. **Erase local usage** stops watching and deletes the stored data; rescanning asks for consent again.

Treat every figure as a local estimate, not a bill: session files omit hidden system and context tokens, tokenizers differ by model, legacy sessions are estimated from text length, and unknown models use a labeled 1.0 premium fallback. Premium estimates apply the pre-2026-06 or post-2026-06 multiplier table per request date. The card never changes the comparison, profiles, or exports.

Three actions build on a scan. **Use my average** (in the token workload fieldset) fills input and output from median observed tokens per request, showing the sample size and date range; requests without token data are excluded. It is an ordinary edit: it marks an active profile modified and can be reverted by re-applying the profile. Chart points, tooltips, table rows, and model details show local request counts for models you have used, and **Only my models** (in the inclusion section) restricts the whole comparison — frontier, recommendations, and exports — to those models while the checklist keeps every model selectable. A budget suggestion next to the recommendation controls cites its p90 basis, sample, and window (premium requests for legacy billing, AI credits for credit billing; none for USD since history covers Copilot only); **Use suggested budget** applies it explicitly and manual budgets always win.

The **By workspace** table lists up to 20 workspaces with request, token, and premium totals, labeled by folder basename (multi-root sessions join names with `; `); **Show full paths** reveals absolute paths, kept as tooltips otherwise. Sessions whose workspace cannot be resolved show the storage id with an unmapped-workspace note. Paths never leave the machine.

### Editors and consent

Local usage covers the storage roots you have included. VS Code and VS Code Insiders are covered by the first consent prompt; every other source is added on its own:

- The Usage tab's **Editors** block lists what is included, and any other editor whose storage directory was found on this machine — each with a plain statement of what it reads and its own **Include this editor**, confirmed in a separate prompt. Finding an editor does not read it, and an editor that turns out to hold no Copilot sessions says so rather than showing a zero.
- The same block has **Stop reading …** per editor, which stops watching it and deletes only that editor's stored data. **Erase Local Copilot Usage** still removes everything at once.
- Totals are split per editor, and once more than one editor contributes, workspace rows name the editor they came from. Upgrading the extension never adds a source: an existing consent keeps covering exactly the two VS Code roots.

## Monthly spending scenario

The **Monthly spending scenario** card is a separate what-if projection — fee plus expected usage against a plan's documented allowance and overage rate — kept apart from the cost estimates in the chart and table, and from local usage history. It is off by default (**Off**).

Choose a **Plan** (Copilot Pro, Pro+, Max, Business, Enterprise, the legacy annual Pro/Pro+ plan, or **Custom plan**) and enter **Expected requests / month** as a low–high range. Plans that don't apply to the current source or billing mode are listed but disabled, with the reason shown as a tooltip and under the plan select; an unrecognized saved plan id is kept and shown as unavailable rather than silently swapped for another plan. **Custom plan** reveals fields for your own monthly fee, included allowance, and overage rate — always labelled as your own input, never verified.

**Use my request history** fills the range from your last local usage scan (needs a scan first): the high estimate is requests per active day × 30, the low estimate is requests over the full calendar span × 30, both labelled "observed history" with the window and how many undated requests were excluded. History requests span every discovered Copilot model but are priced as if they all used the currently selected row; editing the requests fields by hand afterward returns to "your input".

The result shows, for each field, its value and where it came from — provider-verified (with the plan registry date), your input, observed history, or the displayed per-request estimate (and which chart basis it uses) — plus requests, monthly usage, the allowance range, how far beyond it you'd be (in the plan's unit, and in USD only if a budget would allow it), the plan fee, an estimated monthly total range, and a boundary indicator (within base, within flex, or over the allowance) for each end of the range. A plan with an undocumented fee (the legacy annual plan) shows no total, with a note pointing to Custom plan. Every result carries a disclaimer that it is a projection, not a bill.

In **Compare options**, each option keeps its own plan and requests; switching an option's source or billing can make its scenario unavailable rather than silently converted. Each comparison panel shows its own scenario line, and the delta line compares only the range ends between options with the same unit and a documented fee — otherwise it names why (off, unavailable, different units, or an undocumented fee).

## Extension settings

Three `paretoGhc.*` settings (VS Code Settings, user or workspace scope) mirror stored preferences: an explicitly configured value wins, otherwise the existing stored value applies unchanged, and an explicitly invalid value is ignored rather than failing. Nothing here needs a reload, and nothing here grants usage consent or scans on its own.

- `paretoGhc.usage.retentionDays` (default `0`, unlimited; 0–3650) overrides the stored **Keep history (days)** value and takes effect on the next consented scan. While it is configured, edits in the Usage tab input are written through to the setting so the two cannot drift apart; clearing the setting restores the stored value.
- `paretoGhc.usage.watchOnScan` (default `true`) decides whether a consented scan starts the file watcher automatically. Explicit **Pause watching** always wins over an enabled default, and **Resume watching** (or any Pause/Resume command) always works regardless of this setting.
- `paretoGhc.chart.defaultView` (`task` or `workload`, default `task`) is the chart cost basis for views without a saved chart choice, such as a fresh install. Changing it applies to the open chart immediately; picking a basis in the panel afterwards saves an ordinary view preference that then takes precedence until the setting itself changes again.

## Exports

**Export CSV** writes the displayed rows with recommendation markers. Every row also carries its cost basis (task or workload view, or legacy), the configured and actually-used token mix (empty for legacy billing, whose multiplier ignores tokens), the catalog/registry/benchmark-snapshot dates it was priced and matched against, and a machine-readable pricing issue. **Export snapshot JSON** (schema version 3, `kind: "single"`) writes the same rows plus the source, task, billing mode, the same cost-basis block, catalog, registry and plan-registry dates, benchmark snapshot version, and the current monthly spending scenario (labelled as a projection, never a bill), with a note that figures are illustrative rather than measured cost or a bill. **Export badge JSON** writes a shields-compatible payload (schema version 1) naming the highest-scoring displayed model, with its unit and cost basis stated alongside. **Export chart PNG** saves the current chart image with a one-line annotation (task, unit, cost basis, catalog and benchmark-snapshot dates). Compare-tools pair CSV/snapshot exports carry the same provenance per option, each row keeping its own native unit. All exports go through the save dialog and reflect the current filter, exclusions, and sort.

Each preset uses its published Artificial Analysis index directly; scores are not invented or blended into a custom ranking. The tested reasoning variant appears in the details. Benchmark scores are a proxy for task suitability, not a guarantee of performance with Copilot's configuration. Comparing a fixed token workload does not estimate how many tokens different models need to complete the same task.

## Reopening an exported snapshot

**Import snapshot JSON** (Settings → Export & import, or the `Pareto GHC: Import Snapshot JSON (Read-Only)` command) reopens a snapshot JSON you exported earlier as **historical, read-only** data — useful for reviewing what a comparison looked like at export time, or for reading a snapshot a colleague shared.

- A banner names the file, when it was exported, and the cost basis, unit, and pricing-registry dates **as of that export**. The panel keeps showing it until you choose **Back to live comparison**.
- Costs stay on the snapshot's own basis: the workload inputs and **Chart view** are locked, so exported numbers are never relabelled or recalculated. The text filter, chart display settings, and the custom comparison tray still work on the exported rows.
- Recommendations, frontier flags, and benchmark mapping are shown **as exported** and are not recomputed. Row details are reduced to read-only provenance — no copy, pin, benchmark mapping, or BYOK actions — and rows contain only what the export recorded, so there are no cost breakdowns, dominator lists, or local usage counts.
- Nothing you do here changes saved workloads, exclusions, or the live comparison; an attempt to change one is refused with an explanation.
- A file that is not a snapshot, an older or newer schema version, or a corrupted one is refused with a message saying why, and the live comparison stays as it was.
- Only the picked file's path is remembered (nothing is uploaded, and the file is never copied), so closing and reopening the panel shows the same snapshot. If the file has moved or changed, the panel explains that it could not reopen it and returns to live data.
