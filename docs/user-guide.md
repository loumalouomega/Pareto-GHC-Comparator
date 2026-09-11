# User guide

How recommendations, saved workloads, and the Pareto chart work.

## Recommendations

The **Find a model** panel offers two modes using the currently filtered, available, comparable models:

- **Best under budget:** highest score at or below your maximum cost; lower cost breaks score ties. Each billing mode remembers its own budget, initially 1 AI credit, 1 premium request, or 1 USD.
- **Cheapest near best:** lowest cost within an allowed score gap from the highest displayed score; higher score breaks cost ties. The default gap is 3 index points, not a percentage.

Exact ties remain recommended together. Star-shaped chart points and **★ Recommended** table labels identify recommendations separately from the Pareto frontier. The panel explains the winning score, cost, and threshold. Over-budget models stay visible for context. Missing data is excluded, and an explicit empty state explains when no model qualifies. Changes to filters, mappings, pricing inputs, or benchmark data recompute the recommendation.

## Saved workload profiles

Save named configurations across projects using the **Saved workload** controls. **Save as** creates and applies a profile from the current settings. Select an existing profile and click **Apply** to restore its source, task, billing mode, annual plan, token counts, recommendation mode, all three budgets, and score gap.

Selecting **Custom** detaches the current workload from a saved profile without deleting it. Changing an applied profile marks it **Modified (not saved)**. **Update** explicitly overwrites that profile with the current workload. **Rename** uses the text in **Profile name**; **Delete** removes the selected profile while retaining the current workload. Names must be 1–60 characters after trimming and unique without regard to case.

Profiles live in VS Code extension global storage and are reusable across workspaces on that installation. They do not contain API keys, model mappings, model selections, or text filters. Applying a profile preserves the current filter. Existing v0.1 settings migrate to a **Custom** workload with recommendation defaults; caches and manual mappings are retained. Pre-source profiles and settings migrate to Copilot defaults with a 1 USD budget; switching sources resets billing to that source's default.

## Selecting models

The **Included models** checklist groups models by family, then by model, then by thinking level. Select a whole family, a model with all its thinking variants, or an individual thinking level. Parent checkboxes show a partial-selection state and selected/total counts. Sections collapse without losing the selection, and the **Filter models for selection** search keeps matching families and models visible. While filtering, **Select matching** and **Clear matching** (otherwise **Select all**/**Select none**) apply to the matching models. Selections persist per source and apply before the frontier, recommendations, and exports.

OpenCode reasoning variants appear as one thinking leaf per `#variant` row under a shared model. When several benchmark variants match one model (for example low/high), each variant automatically becomes its own comparable row with its own thinking-level checkbox — no manual selection needed. A model reporting its own thinking level resolves to that same level instead of expanding. To keep only one variant, pick it in the **Benchmark variant** dropdown in model details; **Use automatic matching** restores every variant. A selection that disappears stays visibly unresolved instead of silently switching to another variant. Pins still expand one model into one row per pinned variant.

## Reading the chart

Two chart views are available under **Chart display settings**. **Intelligence vs. cost per task** (the default, mirroring the Artificial Analysis homepage) plots the selected index against a workload-independent per-task cost: the same catalog rates applied to a fixed illustrative mix of 1,000 input and 1,000 output tokens. **Quality vs. workload cost** plots against your editable token workload instead. Legacy billing shows the per-interaction multiplier in both views. Token inputs are hidden in the per-task view; budgets and recommendations follow whichever cost is displayed.

Higher scores and lower costs are preferred. The dotted line connects the Pareto frontier: models for which no displayed model has both an equal or lower cost and an equal or higher score, with at least one strict improvement. Tied models remain on the frontier. The shaded **most attractive quadrant** (toggleable) marks models with an above-median score at or below the median cost; median guides divide the plot. Filtering recomputes the comparison for the visible models. Points with missing data are excluded from the chart, with reasons shown in the table.

Positive costs use a logarithmic axis. If any comparable model has zero cost, the chart switches to a linear axis. The table supports keyboard selection and provides the same values as the chart. Light, dark, and high-contrast themes follow VS Code.

Each preset uses its published Artificial Analysis index directly; scores are not invented or blended into a custom ranking. The tested reasoning variant appears in the details. Benchmark scores are a proxy for task suitability, not a guarantee of performance with Copilot's configuration. Comparing a fixed token workload does not estimate how many tokens different models need to complete the same task.
