# Roadmap

Candidate features for future Pareto GHC Comparator releases, prioritized by value versus effort given what the extension already ships.

This page is aspirational, not a commitment. Items may be reordered, rescoped, or dropped. Effort is a rough order of magnitude: **S** (a day or two), **M** (roughly a week), **L** (multiple weeks). Estimates include implementation, documentation, and validation.

## How this file works

- Tiers are ordered by recommended execution order. Each tier states its admission criterion; tasks within a tier follow dependency order.
- Each task defines the current gap, deliverables, dependencies, and acceptance criteria. Reference tasks by name rather than their position in the list.
- Remove completed tasks after recording verified implementation guidance in `AGENTS.md` and user-visible changes in `CHANGELOG.md`. Remove empty tiers. This file tracks only candidate future work — it does not keep a running summary of what already shipped; `AGENTS.md` is the record of current verified behavior and `CHANGELOG.md` of what changed and when.
- Link a corresponding GitHub issue when one exists. The issue holds the request and discussion; this file defines the proposed scope. Verify claims against the code before treating them as implemented behavior.
- Former non-goals are reconsidered below as delivery candidates or feasibility investigations. Keep data integrity and consent requirements as acceptance criteria, rather than treating whole feature areas as permanently excluded.
- Feasibility investigations must establish feasibility before implementation is scheduled; listing one does not authorize inference, spending, account changes, or additional data collection.

## Tier 2 — Delivery candidates from feasibility decisions

Admission criterion: a completed feasibility investigation recommended delivery. Three investigations closed this round — decisions and evidence are in `docs/model-switching-investigation.md`, `docs/cli-investigation.md`, and `docs/measured-evaluations-investigation.md`. Only the first produced a scoped delivery task; the CLI and measured-evaluations investigations concluded feasible-but-deferred (see their Decision sections) and are not yet delivery candidates.

### Copy invocable model identifier — S

- **Gap:** `src/extension.ts:867-872`'s `copy` handler writes a row's display name (e.g. "GPT-5.4 (high)") to the clipboard, not an identifier any client actually accepts. Found while investigating `docs/model-switching-investigation.md`, which also concluded no client supports a verifiable, documented host-triggered Apply action — copy-name stays the fallback, corrected to copy something pasteable.
- **Deliverables:** For OpenCode rows, copy `provider/model#variant` (matching `-m`/`--variant`, or `-m provider/model#variant`). For static-source rows (Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Aider, Amazon Q), copy the bare catalog id with a short label noting which flag/setting accepts it (e.g. `--model`, `model` in config). Copilot keeps copying the display name — Copilot has no separate invocable id distinct from what's already shown.
- **Dependencies:** None beyond `docs/model-switching-investigation.md`'s capability matrix.
- **Acceptance:** The copied string is one the target client's documented `--model`/config key accepts verbatim; no client config is read or edited; no model is switched or inferred from display-name similarity.

## Requirements across future work

These remain acceptance requirements while the former product exclusions above become scoped candidates:

- **Consent and local data:** Keep local usage reads opt-in, visibly indicate watching, and retain disable/erase controls. Broader data sources need explicit opt-in and a stated purpose; convenience is not a reason for silent default-on scanning.
- **Evidence and uncertainty:** Do not infer prices or reasoning configurations from display-name similarity. Keep unknowns visible and distinguish observed zero counts from missing fields and legacy estimates.
- **Honest comparisons:** Preserve cost units, workload assumptions, benchmark variants, and pricing provenance. A shared currency label alone does not make different billing models or task workloads comparable.
- **Supported integrations:** Record evidence and validation gaps by client/platform. Treat session schemas and external capabilities as versioned dependencies, and degrade with actionable explanations when they change.
