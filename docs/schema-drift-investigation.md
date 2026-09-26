# Upstream schema change early warning — feasibility investigation

Status: **Decided — feasible for OpenCode and already half-built; not automatable for Copilot Chat.** The missing piece is failure-mode separation and alerting, not new infrastructure.

Date checked: 2026-09-26. Versions: OpenCode 2.0.16 installed locally, 1.18.30 pinned in CI; documentation page fetched 2026-09-26. Extension version at time of writing: 1.2.0.

This document is research and design only. No CI run was triggered, no workflow file was changed, and no account or credential was used. Local commands were read-only invocations of `opencode` that list models or print aggregate statistics.

> **Delivered 2026-09-26.** Both decisions below have since shipped. The v2
> discovery break is fixed by a fallback to `opencode api model.list`, and the
> drift lane is live as `.github/workflows/drift.yml` with its classifier in
> `src/opencodeDrift.ts`. What follows is kept as the dated record of how the
> gap was found; the current behavior is documented in `AGENTS.md` and
> `docs/integrations.md`.

## The gap, demonstrated rather than hypothesized

The extension's entire OpenCode discovery boundary is `opencode models --verbose` (`src/opencode.ts`). Against the currently installed OpenCode, it fails:

```
$ opencode --version
opencode v2.0.16

$ opencode models --verbose
ERROR
  Unrecognized flag: --verbose in command opencode models
$ echo $?
1

$ npx tsx scripts/opencode-smoke.ts
{"os":"linux","arch":"x64",...,"ok":false,"failures":["discovery"],"kind":"command"}
```

`opencode models --help` on 2.0.16 lists neither `--verbose` nor `--refresh`. Discovery on OpenCode v2 is therefore broken today: a v2 user sees no OpenCode models at all, with a command-failure diagnostic rather than an actionable message.

> **Resolved 2026-09-26.** Everything above describes the state when this
> investigation was written. The break is fixed: v2 exposes
> `opencode api model.list`, whose OpenAPI `Model.Info` carries the identity,
> limits, rates, tiers, and variants that `--verbose` used to provide, and
> `discoverOpenCode` now falls back to it. The CI blindness described next is
> unchanged at the time, and is what the weekly `drift.yml` lane now covers.

**Why CI does not catch it**, from `.github/workflows/extension.yml`:

- The `opencode-smoke` matrix has two install methods. The `npm` lane pins `npm install -g opencode-ai@1.18.30` — the version the fixtures were captured against — so it is green by construction and can never observe a newer release.
- The `script` lane installs **latest** via `https://opencode.ai/install`, so it *is* exposed to this break.
- The whole job is `continue-on-error: true` and is deliberately excluded from the `release`/`publish` jobs' `needs` and from required status checks, because it depends on an external service. A real breaking change and an opencode.ai outage therefore produce the same signal: a yellow job nobody reads.
- There is no `schedule:` trigger. `on:` is `push` (master/tags), `pull_request`, and `workflow_dispatch` — so nothing runs weekly, and even if it did, nothing would notify anyone.

This is exactly the failure the roadmap item describes ("discovered only when a user hits `unsupported`/`unrecognized` output"), and it is the reason the item is worth closing with a verdict rather than a further study.

## Documentation checked

- OpenCode CLI reference: `https://opencode.ai/docs/cli/` — the `models` command still documents `--verbose` ("Use more verbose model output (includes metadata like costs)") and `--refresh`, and the page also documents `stats`, `session list --format json`, `export [sessionID] --sanitize`, and `db [query]` / `db path`. **The installed 2.0.16 build implements none of `--verbose`, `--refresh`, nor `db`**, so the published page is not a reliable description of v2. For a drift job this matters twice over: a documentation change is not evidence about the binary, and a binary change is not evidence about the documentation.
- VS Code Language Model API guide: `https://code.visualstudio.com/api/extension-guides/ai/language-model` — consent and request surfaces only; no session-history or usage export.
- No Copilot Chat CLI, offline export, or documented session endpoint was found. The extension's own `docs/integrations.md` records Copilot chat sessions as unversioned, with synthetic fixtures standing in for an unpublished schema.

## Local experiments (read-only, no account, no inference)

- The `--verbose` repro above, plus `opencode models --help`, `opencode models` (exit 0; one bare `provider/model` id per line; no cost, no variant, not JSON), `opencode stats --cost` (works; human-formatted aggregate totals; no format flag), `opencode session list -n 1 --format json` (valid JSON, zero rows here), and `opencode db path` (not a command in 2.0.16 — prints generic CLI help).
- The repository's own failure taxonomy in `src/opencode.ts` was read rather than reinvented: `OpenCodeFailure` is `"missing" | "timeout" | "command" | "parse" | "empty"`, and `fingerprintOpenCodeOutput` already produces content-free counters — `blocks`, `jsonFailures`, `missingId`, `missingProvider`, `missingName`, `invalidProvider`. The `--verbose` removal lands in `command` today because the binary exits non-zero; had it exited 0 with reshaped fields, it would have landed in `parse` or `empty` with counters explaining why.

## Can it run without real credentials or an account?

| Surface | Credential-free CI? | Why |
| --- | --- | --- |
| OpenCode model listing | **Yes — already proven** | `opencode-smoke` runs with an isolated `HOME`/`XDG_*` and expects only the Zen free tier, across Linux, macOS, and Windows, with two install methods and a path-with-spaces re-run |
| OpenCode session store | Not needed, and not appropriate | Reading a real account's sessions means reading the SQLite file documented in `docs/other-client-usage-investigation.md`, which is co-located with OAuth credential tables |
| Copilot Chat session shape | **No** | There is no CLI, no server, and no documented export. Session files exist only on a signed-in machine with the extension installed. A CI runner can obtain nothing resembling a real Copilot chat session without an account |
| VS Code API surface | Partly | A scheduled `npm run check` against the latest `@types/vscode` catches extension-API drift. This is a real, automatable signal, but it is a *different* drift from the session-file shape this item is about, and it must not be presented as coverage of it |

So the acceptance criterion resolves cleanly: **yes for OpenCode, no for Copilot Chat**, and the Copilot half must be reported as un-automatable rather than approximated with a fixture that only ever proves the fixture still parses.

## Decision

**Feasible, and mostly a matter of finishing what exists. Three changes, no new infrastructure class:**
1. **Separate the failure modes instead of swallowing them.** The `script` lane's `continue-on-error: true` should stay — it is correct for an external dependency — but its outcome must be *classified* using the taxonomy the code already has: `missing` (binary not found), `timeout`, `command` (non-zero exit, e.g. today's unrecognized flag), `parse`/`empty` (output shape changed), and install/network failure. `scripts/opencode-smoke.ts` already prints sanitized counts and the failure kind; the drift signal is the **combination** — pinned lane healthy *and* latest lane not — with the kind naming the class. That combination is what turns an ambiguous yellow job into a diagnosis.
2. **Add a scheduled lane against latest.** A weekly `schedule:` cron (none exists today) running the existing smoke script on **Linux only** for cost, leaving the three-OS matrix on the pinned version where it is a release gate. Keep the pinned lane as the contract fixture: `test/fixtures/opencode/verbose-1.18.30.txt` is the known-good shape, and it should keep representing the version the parser supports.
3. **Alert by opening or updating an issue, never by failing a release.** A weekly job that fails loudly trains everyone to ignore it, and a release gate that depends on opencode.ai makes releases hostage to a third party. The existing release discipline in `AGENTS.md` — non-gating external-service checks — is the right precedent; what is missing is a notification. An issue carrying the failure kind, the sanitized fingerprint counters, the detected version, and both lane outcomes is self-describing enough to act on.

**For Copilot Chat, no CI job is added.** The only real signal is user-reported: the existing `UsageSchemaFingerprint` notice ("don't match any known Copilot chat schema — please file an issue with the fingerprint(s)"), which is content-free by construction and already reaches the maintainers through a user's report. That path stays as the whole of the Copilot half. A scheduled `@types/vscode` type-check may be added later as a clearly-labelled API-drift signal; it must not be described as session-schema coverage.

**Cadence and alerting recommendation:** weekly, non-gating, issue-based, Linux-only for latest, all three platforms retained for the pinned version. Weekly matches how often these clients ship breaking CLI changes closely enough to matter while staying cheap; more often adds noise, less often delays a fix.

## What this investigation surfaced, for the roadmap

- **OpenCode v2 discovery compatibility is a live user-facing break, not a drift risk.** It shipped as a Tier 1 item and has since been delivered: the v2 listing carries no cost or variant metadata *on the bare `models` command*, but `opencode api model.list` exposes the same metadata as JSON, so v2 support is a port rather than a degraded mode. `1.x` and `2.x` share no working surface, so dispatch is by fallback rather than a version table.
- **The documentation/binary mismatch is itself the argument for the drift lane.** While the published OpenCode CLI page still documents a flag the shipped binary rejects, no amount of documentation reading substitutes for running the new version.

## Failure states

Not applicable — no workflow or runtime code changed. A future drift lane's own failure mode is the one this decision is designed around: a silent regression to "yellow job nobody reads", which is why classification and issue-based alerting are part of the deliverable rather than an optional extra.

## Open blockers

- **No alert channel was chosen.** GitHub Actions annotations are free but invisible to anyone not watching a run; opening an issue is noisy but durable. This investigation recommends issues without having checked the repository's issue volume or whether a scheduled workflow is permitted to create them. **Resolved:** issues were chosen and shipped — the weekly `drift.yml` lane creates a `drift`-labelled issue and updates it in place, and the evaluate job downgrades any failure to a warning. Whether the repository permits a scheduled workflow to open issues is still unconfirmed.
- ~~**The v2 replacement for `--verbose` is unknown.**~~ **Resolved.** 2.x does not need a poorer listing: `opencode api model.list` returns the full `Model.Info`, including per-million rates, long-context tiers, and variants, so the 2.x path is a port rather than a downgrade. See `docs/integrations.md` and the fallback dispatch in `discoverOpenCode`.
- **`opencode session list --format json` returned zero rows** in this environment, so the only documented machine-readable v2 surface is unverified. If it turns out to carry token and cost fields, the OpenCode ledger question in `docs/other-client-usage-investigation.md` would need revisiting. Still open — and now of lower consequence, since the model listing no longer depends on it.
- **Windows and macOS were not probed for the `--verbose` removal.** The flag's absence is version-level, so a platform difference is unlikely, but it is unmeasured — record as unperformed validation.
- **Only one newer version (2.0.16) was observed.** A single data point cannot distinguish "v2 removed it" from "a recent v2 build removed it", and the weekly lane is what would settle that. No 2.x release exists on npm, so an install-script CI lane is the only way to observe a successor.
- **The Copilot half has no automation path at all.** If a real account is ever acceptable in CI, the credential and cost implications were not investigated and are not authorized by this document.
