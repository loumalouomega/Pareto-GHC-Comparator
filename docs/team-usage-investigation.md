# Team usage aggregation — feasibility investigation

Status: **Decided — recommend against any merged aggregate figure.** A per-contributor, unit-labelled, non-merged summary is the only honest form, and building it is a feature, not an output of this investigation.

Date checked: 2026-09-26. Extension version at time of writing: 1.2.0.

This document is research and design only. No code was written, no usage data left the machine, and no file was exported or shared. Nothing in this investigation reads a real contributor's history beyond the field names in `src/types.ts`.

## What exists today

Neither of the repository's two export surfaces is a usage-sharing format, which is the first finding:

| Surface | What it actually contains | Usable as a team-usage input? |
| --- | --- | --- |
| Snapshot JSON (`src/export.ts`, schema v3, `kind: "single" \| "comparison"`) | Compared rows: model names/ids, benchmark, quality score, cost, cost basis, pricing provenance, dates, disclaimers | No. It is a *comparison* artifact — one person's view of model quality versus cost, not a record of what they used |
| Stored `usage.json` (`src/usage.ts`, version 2) | The real usage ledger: per-model/day/workspace totals, completeness counters, diagnostics, schema fingerprints, unknown models, medians and p90s | Not as shipped. It is a local cache opened read-only by `paretoGhc.showUsageData` for inspection, it is not schema-versioned for third-party consumption, and it carries absolute workspace paths |

So a team feature would need a **new, purpose-built export** — this investigation is not choosing between two existing formats.

## The de-identification surface

Enumerated from `UsageSummary` and its row types in `src/types.ts`, this is exactly what a shared file would carry:

| Field | Identifying? | Note |
| --- | --- | --- |
| `scannedAt`, `dateRange` | Low | Timing metadata; a small window is itself a fingerprint |
| `fileCount`, `requestCount`, `promptTokens`, `outputTokens`, `estimatedTokens` | None | The counts a team would actually want |
| `models[]` (per-model totals) | Low | Model ids are public strings; a very distinctive mix can be identifying in a small team |
| `days[]` | Low | Per-day totals are close to re-identifying when a team is small — "who worked on the release day" |
| `workspaces[]` | **High** | Workspace names are usually repository names, and `UsageWorkspaceStat` can carry an absolute path plus an `editor` label. This is the field that makes a naive export identifying |
| `unknownModels[]` | Low | Client-reported model strings that did not resolve |
| `completeness`, `diagnostics`, `schemaFingerprints` | None | Content-free by construction — the fingerprint records field *presence* and bounded shape counters, never values |
| `medianPrompt`, `medianOutput`, `premiumP90`, `creditP90` | Low | Distribution hints; a p90 over a handful of requests is close to a single value |

Two properties make a *narrowed* export genuinely low-risk, and both should be required of any future format: `UsageSummary` contains **no chat text, no prompts, and no responses** — the parser extracts token, model, and timestamp fields and never retains content — and its diagnostics are content-free by design.

The unavoidable conclusion is that a team export must **drop the workspace dimension or coarsen it**, and that choice is a product decision, not a technical one.

## Consent

Today's consent model is per-machine and per-source: `usageRoots` in global state records which roots the user included, `detectUsageRoots` establishes existence with a `stat` and nothing else, and the Usage card states each root's `purpose` in the confirmation modal. That model answers "may this extension read this location on this machine".

Team aggregation asks a different question — "may I hand a file about my work to someone else" — and the current model does not answer it:

- Consent to *read* is not consent to *redistribute*. A future feature needs a separate, explicit per-export action; it cannot be inherited from the reading consent.
- The extension has **no network collection** as a hard boundary. Merge-a-file keeps that boundary intact, which means the shared *format* is the entire risk surface and must be the thing that is minimized.
- Contributors are independent actors with their own employers and repositories. A team lead cannot consent on their behalf, so any aggregation flow needs a per-contributor export step that each person takes themselves.

## Unit comparability — the decisive problem

This is where aggregation stops being a formatting question. The repository already refuses to blend units inside a single view, and a team view would blend across *people*:

- **Different billing currencies.** Copilot legacy bills in **premium requests**; Copilot's current plans bill in **AI credits**; OpenCode and a future Claude source bill in **USD**. `src/normalize.ts` converts credits to a USD equivalent only at the documented pay-as-you-go rate, and treats legacy premium requests as permanently `unavailable` because a per-interaction multiplier is not a token-workload cost. There is therefore **no honest conversion from premium requests into anything else**, and one exists at all only for credits.
- **Different allowances, even in the same currency.** `src/plans.ts` records Pro at 1,000 base + 500 flex credits, Pro+ at 3,900 + 3,100, Max at 10,000 + 10,000, Business at 1,900 per user pooled, and a legacy annual Pro allowance of 300 premium requests against Pro+'s 1,500. A Pro contributor and a Max contributor reporting "60% of my allowance" are describing different absolute volumes, and the extension cannot verify which plan anyone is on: `plansFor` is a static registry and the legacy `Options.plan` is a user-declared value.
- **Different workloads behind the same unit.** Credits spent on a 10k-token task and credits spent on a 200k-token task are not comparable quantities. The repository's answer to this is the workload-sensitivity card and the explicit cost-basis labels, both of which are per-view settings a shared file cannot carry honestly.
- **A shared label is not a shared unit.** This is the roadmap's own standing requirement: "A shared currency label alone does not make different billing models or task workloads comparable." A team dashboard headed "total spend" across contributors on different plans, currencies, and workloads would violate it at the aggregate level — the one place where a reader is least able to check.

Summing is therefore not implementable honestly. What *is* honest is a **per-contributor list of non-merged figures**, each labelled with its unit, plan, basis, and window — which is a leaderboard of separately-labelled numbers, not an aggregate, and delivers much less than a team normally wants from this.

## Decision

**No merged aggregate figure is built. Recommend against pursuing one.**

- **Summing across contributors is not honestly comparable** and no format field can fix it: three billing currencies (one of which has no conversion at all), per-plan allowances that differ by an order of magnitude, unself-verifiable plan identity, and per-contributor workload settings. This is the same rule the extension already enforces inside one chart, one frontier, and one export.
- **The only defensible artifact is per-contributor and non-merged**: one row per person, each with its own unit, plan, cost basis, workload, date window, and completeness counters, displayed side by side and explicitly not added together. Whether that is worth building is a product judgment for a future task, and it is explicitly **not** scheduled by this investigation.
- **A shared export must drop the workspace dimension.** Repository names and absolute paths are the identifying field; a team view that keeps them is a directory of who works on what, not an aggregate.
- **Redistribution consent must be separate from reading consent**, taken per contributor, per export, with the fields to be shared stated before the file is written.

If a team feature is ever scheduled, the preconditions are: a new purpose-built, schema-versioned export (not a reuse of snapshot JSON or the `usage.json` cache); workspace-free rows by default; per-row unit/plan/basis/window/completeness provenance carried from `UsageSummary` rather than recomputed; an explicit redistribution consent step; and a UI that renders the result as separate labelled figures with a stated reason they are not summed. None of that is aggregation, which is why this investigation recommends against the feature rather than scoping it.

## Failure states

Not applicable — no runtime behavior is introduced. A future team feature's failure states would center on the two this analysis identifies as hardest: a contributor whose unit cannot be labeled (making their row unmergeable *and* unplaceable), and an export that silently omits a contributor's completeness counters, making an incomplete history look like a small one.

## Open blockers

- **Whether teams actually want a non-merged view is unvalidated.** This investigation establishes what cannot be built honestly; it does not establish that the honest alternative is worth building. No user research was performed.
- **Plan identity cannot be verified.** Any per-contributor plan label would be self-declared, and this document does not assess how a user would react to their declared plan being displayed next to their usage.
- **Small-team re-identification through `days[]` was not quantified.** Per-day totals plus a small team size can be re-identifying even with no workspace field; the threshold was not measured.
- **No de-identification standard was consulted.** This document uses the repository's existing privacy posture as the bar. A formal standard (or an organization's own policy) may require more, and that review was not performed.
- **Whether an employer may prohibit contributing usage data at all** is outside this repository's scope and was not investigated.
