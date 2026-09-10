# OpenCode integration decision

Status: **Accepted** — boundary for Tier 1 implementation (roadmap: `docs/roadmap.md`).

Date checked: 2026-09-10. OpenCode version tested: **1.18.30** (`opencode --version`).
Extension version at time of writing: 0.6.0 (Copilot-only discovery via
`vscode.lm.selectChatModels({ vendor: "copilot" })` in `src/extension.ts`).

This document records what was verified against current official OpenCode
documentation and a local experiment, and fixes the discovery boundary, data
contract, credential handling, failure states, and initial provider/pricing
scope. It contains no credentials and no inference requests were sent during
verification.

## Documentation checked

- Models (catalog composition, `provider/model[#variant]` references, local
  models, Ollama/LM Studio auto-discovery):
  `https://opencode.ai/docs/models` and `https://v2.opencode.ai/docs/models`.
- Configuration (file locations, precedence, provider/model/variant shapes,
  JSON schema at `https://opencode.ai/config.json`):
  `https://opencode.ai/docs/config` and `https://v2.opencode.ai/docs/config`.
- Providers (75+ via AI SDK/Models.dev, `/connect` credential flow,
  `auth.json` storage, blacklist/whitelist):
  `https://opencode.ai/docs/providers`.
- Server (`opencode serve`, OpenAPI at `/doc`, `GET /config/providers`,
  `GET /provider`): `https://opencode.ai/docs/server`.
- Zen (curated gateway, model/endpoint table, per-1M-token pricing table,
  deprecations): `https://opencode.ai/docs/zen`.

Key documented facts relied on below:

1. OpenCode builds its model catalog from Models.dev, provider integrations,
   and user configuration. **Only enabled models whose provider is available
   for the current project appear** — so a listing already means
   configured/usable, and a public catalog entry alone never proves access.
2. Model references use the format `provider_id/model_id`, with an optional
   `#variant` suffix (e.g. `-m openai/gpt-5.2#high`). An unknown variant fails
   resolution instead of silently using the base model.
3. Zen pricing is published **per 1M tokens** (input / output / cached read /
   cached write, with `≤`/`>` long-context splits for some models).

## Local experiments (reproducible, no inference, no secrets)

All commands were run with OpenCode 1.18.30 on Linux. No session, message, or
generation command was used. Credential files were never read; only file
existence and provider presence were observed.

### Candidate A — CLI: `opencode models --verbose` (chosen)

```sh
opencode --version            # 1.18.30
opencode models               # 49 lines, one `provider/model` ID per line
opencode models --verbose     # same IDs, each followed by a JSON metadata block
opencode models does-not-exist  # Error: Provider not found: does-not-exist
opencode providers list       # provider/credential presence, no secret values
```

Observed (recorded 2026-09-10):

- 49 models across 3 provider IDs: `opencode` (7), `opencode-go` (27),
  `openai` (15). All entries reported `"status": "active"`.
- Each verbose block carries: `id`, `providerID`, `name`, `family`,
  `cost { input, output, cache: { read, write } }`,
  `limit { context, input?, output? }`, `capabilities`, `release_date`,
  `variants` (object; empty `{}` when the model defines none, e.g.
  `opencode-go/kimi-k2.7-code`; populated e.g. `openai/gpt-5.4` with
  `none/low/medium/high/xhigh`).
- Long-context tiers are exposed in-band, e.g. `opencode-go/gpt-5.6-luna`
  carries `tiers: [{ input: 0.4, output: 1.8, cache: { read: 0.04, write: 0.5
  }, tier: { type: "context", size: 272000 } }]` alongside an
  `experimentalOver200K` duplicate. The `experimental*` naming marks this
  shape as volatile (see blocker B3).
- Runtime is ~1.4 s for the full verbose listing; output contains **no
  credential material** (no keys, tokens, or auth URLs).
- `opencode models [provider]` filters by provider ID and errors clearly on
  unknown providers. A `--refresh` flag exists (refreshes the Models.dev
  cache); the adapter must not pass it during routine discovery.

### Candidate B — local server API (rejected)

```sh
opencode serve --port 4199 --hostname 127.0.0.1 &
curl http://127.0.0.1:4199/global/health          # {"healthy":true,"version":"1.18.30"}
curl http://127.0.0.1:4199/config/providers       # provider+model inventory
curl http://127.0.0.1:4199/doc                    # OpenAPI 3.1 spec (HTTP 200)
```

The server works and exposes the needed inventory, but it is rejected as the
extension boundary for two reasons:

1. **Credential leak by design:** `GET /config/providers` embeds live provider
   API keys in its response payload. An extension adapter would have to ingest
   and then scrub secrets on every discovery pass — an unacceptable blast
   radius next to Candidate A, whose output never contains secrets.
2. **Lifecycle cost:** the extension would have to start, own, health-check,
   and stop a per-window daemon (port selection/conflicts, `OPENCODE_SERVER_PASSWORD`
   handling, orphan processes). The CLI is stateless per invocation.

The server remains a valid power-user/IDE-plugin path, but it is out of scope
for the initial integration.

### Rejected alternative — reading config/auth files directly

Reading `~/.config/opencode/opencode.json(c)` or
`~/.local/share/opencode/auth.json` was considered and rejected: config files
merge across global/project scopes with precedence rules the extension must not
reimplement, and `auth.json` holds raw secrets. Presence of a credential entry
also does not prove a model is enabled for the current project, while the CLI
listing does (per the documented availability rule above).

## Decision

**Boundary:** spawn the installed OpenCode CLI and parse
`opencode models --verbose`. No server lifecycle, no config-file parsing, no
auth-file reads, no inference requests, no model switching.

**Prerequisites (to document in README during implementation):**

- OpenCode CLI **1.18.30 or newer** installed with the binary on `PATH`
  (default install places it under `~/.opencode/bin/`).
- At least one provider connected (`opencode providers login` in the
  terminal or `/connect` in the TUI).
- Verified only on Linux; macOS/Windows paths are untested (blocker B4).

## Availability semantics

- The CLI listing **is** the configured/usable set for the current project:
  listed ⇒ enabled model with an available provider. This preserves the
  existing rule that catalog membership alone never implies account access —
  here, listing membership is the access signal, and anything not listed must
  not be shown as available.
- Identity is namespaced as `opencode:<provider>/<model>[#variant]`
  (e.g. `opencode:opencode-go/gpt-5.6-luna`,
  `opencode:openai/gpt-5.4#high`). The namespace is required: identical base
  model names exist under different providers with different billing
  (`opencode-go/gpt-5.6-luna` vs `openai/gpt-5.6-luna`).
- Reasoning variants are preserved as distinct selectable identities via the
  `#variant` suffix. An unknown variant is an unresolved state, never a silent
  fallback to the base model (mirrors the existing benchmark-override rule).
- Empty/error states must be actionable: binary missing → install guidance;
  empty list → connect-a-provider guidance; unknown provider filter is an
  internal error, never user-facing jargon.

## Pricing

**Authoritative sources:** the CLI verbose `cost` fields, cross-checked against
the Zen pricing table at `https://opencode.ai/docs/zen`.

**Unit verification (2026-09-10):** CLI `cost` values match the Zen table in
USD per 1M tokens on every model spot-checked:

| Model (`opencode-go/…`) | CLI `cost` | Zen table |
| --- | --- | --- |
| `kimi-k2.7-code` | 0.95 / 4.0 / read 0.19 | $0.95 / $4.00 / $0.19 |
| `kimi-k3` | 3 / 15 / read 0.3 | $3.00 / $15.00 / $0.30 |
| `qwen3.7-max` | 2.5 / 7.5 / read 0.5 / write 3.125 | $2.50 / $7.50 / $0.50 / $3.125 |

**Cost formula (USD per workload):**

```text
usd = (input × r_input + cache_read × r_read
       + cache_write × r_write + output × r_output) / 1_000_000
```

- `r_write`: CLI `cost.cache.write` when nonzero; when `0`, no separate
  write rate is documented (Zen table shows "—"), so cache-write tokens fall
  back to `r_input` — the same fallback rule as the existing Copilot
  `write: null` handling in `src/compare.ts`.
- Long-context tiers: map CLI `tiers[]` (`tier.type: "context"`,
  `tier.size`) onto the existing `long: { threshold, rates }` catalog shape;
  the whole workload uses tier rates once total input exceeds the threshold,
  matching current Copilot behavior. Unrecognized tier shapes fall back to
  base rates with a visible note (see blocker B3).
- **Units are USD, never Copilot credits.** USD rows and credit rows must
  never share a frontier, chart axis, budget, or recommendation (existing
  non-goal: no cross-unit comparison without a documented conversion).

**Initial pricing scope:** `opencode` and `opencode-go` (Zen-gateway)
providers only. Verified facts:

- `opencode-go/*` paid models carry nonzero USD/M rates (verified above).
- `opencode/*` entries are Zen free-tier models (`cost` all zero; Zen docs
  list them as limited-time free). They compare with `cost: 0` in USD and a
  "Free tier" label.
- `openai/*` entries report `cost` all zero **because they are billed
  directly by the provider (BYOK), not by Zen** — zero here means
  *unpriced*, not free.

**Zero-cost rule:** `cost: 0` ⇒ free only for Zen-gateway providers with
documented free status; for any direct provider (`openai`, future
`anthropic`, custom OpenAI-compatible, local) zero means unresolved pricing
with a visible "Billed by provider; no verified rate" reason, excluded from
cost-based comparison. This generalizes the existing "unknown prices stay
null with reasons" rule.

Unsupported/missing rates, unrecognized tier shapes, and context-limit
overruns are visible unresolved states, never assumptions.

## Credential handling

- The adapter spawns `opencode models [--verbose]` (and optionally
  `opencode providers list` for presence-only setup hints). It never reads
  `auth.json`, never passes `--refresh` routinely, and never sends prompts.
- Only parsed fields (`providerID`, `id`, `name`, `family`, `cost`, `limit`,
  `variants`, `status`) cross into extension state. Full provider
  configurations, keys, and environment-variable interpolations never enter
  webview state, logs, fixtures, or docs.
- Test fixtures for the adapter contain only the whitelisted fields above.

## Failure states

| Condition | Signal | UX |
| --- | --- | --- |
| Binary missing / not on PATH | spawn ENOENT | Setup state with install guidance |
| Non-zero exit / unparseable output | exit code, stderr, JSON error | Error state with retry; retain previous listing |
| Unknown provider filter (internal) | `Error: Provider not found: …` | Logged; not user-facing |
| No providers connected / empty list | zero entries | Empty state with connect guidance |
| Unrecognized `cost`/`tiers` shape | schema guard fails | Model shown, cost unresolved with reason |
| Command latency | ~1.4 s observed | Same loading pattern as Copilot discovery |

Discovery performs no inference and no automatic model switching; copying a
model name for manual selection stays the only action (existing product
boundary).

## Initial provider scope (bounded)

1. **Discovery:** full configured catalog — every model the CLI lists,
   namespaced by provider (user-approved "full catalog" answer: availability
   for all configured providers, including BYOK/custom/local).
2. **Pricing:** Zen-gateway providers (`opencode`, `opencode-go`) with
   verified USD/M rates; everything else lists availability but stays
   unpriced with an explicit reason until its rates are verified.
3. Benchmark matching reuses the existing `benchmarkFamilies` mechanism and
   user-selection flow; benchmark overrides must additionally be namespaced
   by `source/provider/model` so identical names cannot collide.

## Open blockers / follow-ups for implementation

- **B1 — Cost-unit scoping:** charts, budgets, recommendations, and workload
  profiles must be scoped per source+unit (USD vs credits vs legacy
  multipliers). Saved v0.6 state migrates to Copilot defaults without loss.
- **B2 — Stale-source guard:** switching sources must not render late
  discovery results, mappings, or budgets from the previous source.
- **B3 — Tier-shape volatility:** `tiers[]`/`experimentalOver200K` naming
  suggests the CLI schema may change; the adapter needs a version-tolerant
  schema guard with fallback to base rates.
- **B4 — Platform coverage:** verification was Linux-only; macOS/Windows
  binary resolution and at least one smoke run per platform (or an explicit
  unsupported statement) are outstanding.
- **B5 — Catalog freshness:** Zen prices change (e.g. dated discounts such as
  "50% off through September 18, 2026"); the OpenCode price catalog needs a
  `catalogDate` and update cadence mirroring `src/catalog.ts` maintenance.
