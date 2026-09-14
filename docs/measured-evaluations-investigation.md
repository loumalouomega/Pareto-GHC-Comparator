# Opt-in measured evaluations — feasibility investigation

Status: **Decided — feasible with a bounded v1, delivery not yet scheduled.** (roadmap: `docs/roadmap.md`).

Date checked: 2026-09-14. This document is research and design only: no code was written, no request was sent to any inference provider, and no account, config, or credential state was changed.

## Documentation checked

- VS Code Language Model API: consent (`vscode.lm.sendRequest` requires per-extension user consent the first time it's called, renewable), `CancellationToken` support, and the absence of any token/spend cap parameter — `https://code.visualstudio.com/api/extension-guides/ai/language-model`.
- GitHub Copilot: premium-request budgets and included-request policy pages — `https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing` (already cited by `src/sources.ts`/`docs/billing.md`). No documented programmatic per-run request cap for an extension driving `vscode.lm`; only the account-wide monthly allowance already modeled by `src/plans.ts`.
- OpenAI: project-level usage budgets/limits and per-request `max_output_tokens` — `https://platform.openai.com/docs/guides/rate-limits`, `https://platform.openai.com/docs/api-reference/chat/create#chat-create-max_completion_tokens`.
- Anthropic: workspace spend limits and per-request `max_tokens` — `https://docs.anthropic.com/en/api/rate-limits`, `https://docs.anthropic.com/en/api/messages`.
- OpenRouter: per-key credit limits — `https://openrouter.ai/docs/api-reference/limits`.
- OpenCode Zen: billing and usage page — `https://opencode.ai/docs/zen`.
- Codex CLI / Claude Code: per-session turn or budget flags, checked from `--help` output only (no session started) — `codex exec --help`, `claude --help`. Neither's `--help` output lists an explicit per-run USD spend cap; Claude Code exposes `--effort`/`--model`/`--fallback-model` and Codex exposes `-c`/`--config` overrides, but no first-party budget flag was found in either.

## Workflow design

A measured evaluation run would need, as separate, explicit steps a user triggers:

1. **Select inputs.** The user picks a small, local, already-open input set (e.g. a handful of prompts or files) — never an automatic scan or upload of project contents. This mirrors the existing local-usage-history consent pattern (`usageConsent` in `src/extension.ts`), not a new implicit trigger.
2. **Select model/config and limits.** One model (or a short user-picked list) per run, with an explicit **request count cap** and, where the provider documents one, a **spend cap**. No default limits — the user must set them.
3. **Confirm and run, with cancellation.** A visible in-progress indicator and a cancel action (backed by `vscode.lm`'s native `CancellationToken` for Copilot; provider-appropriate equivalents elsewhere) that stops further requests immediately, leaving already-completed results intact.
4. **Capture per-run.** Every request's model/config, token counts (with the existing `TokenProvenance`), latency, and outcome are recorded — not just an aggregate.
5. **Store separately.** Measured results never merge into the Artificial Analysis benchmark series or the local-usage-history series; they get their own store and their own UI section, cited with their own date/config, per the roadmap's "clearly separate published benchmarks, local-history estimates, and measured results" requirement.

## Per-run capture (design sketch, not implemented)

```ts
interface MeasuredRun {
  id: string;
  startedAt: number;
  client: "copilot" | "opencode" | Source; // whichever client executed the request
  clientVersion: string;
  modelId: string;
  variant?: string;
  configHash: string; // hash of the resolved request config, for reproducibility without storing prompts
  inputSetHash: string; // hash identifying the user-selected input set, content never uploaded
  limits: { maxRequests: number; maxSpendUsd: number | null };
  requests: Array<{
    tokens: { prompt: number; output: number };
    promptProvenance: TokenProvenance;
    outputProvenance: TokenProvenance;
    costUsd: number | null;
    latencyMs: number;
  }>;
  status: "completed" | "cancelled" | "limit-reached" | "failed";
  costProvenance: "measured"; // new kind, alongside existing provider/user/history/estimate (src/plans.ts) and TokenProvenance (src/types.ts)
}
```

`costProvenance: "measured"` would be a new addition next to `src/plans.ts`'s existing `provider | user | history | estimate` scenario-provenance kinds and `src/types.ts`'s `PricingSource`/`TokenProvenance` — never conflated with either, so a chart or export can always say whether a number came from a published benchmark, a local-history estimate, or an actual measured run.

## Limits and cancellation: provider enforcement matrix

| Provider/client | Server-side spend/request cap available | Client-side cap enforceable by this extension | Cancellation |
| --- | --- | --- | --- |
| GitHub Copilot (`vscode.lm`) | No per-extension cap; only the account's monthly premium-request allowance | Yes — the extension can count requests and stop issuing more, and `sendRequest` accepts a `CancellationToken` | Yes, via `CancellationToken` |
| OpenAI (direct API) | Yes — project usage budgets/limits, plus per-request `max_output_tokens` | Yes, in addition to any server-side cap | Yes, by aborting the HTTP request |
| Anthropic (direct API) | Yes — workspace spend limits, plus per-request `max_tokens` | Yes | Yes, by aborting the HTTP request |
| OpenRouter | Yes — per-key credit limits | Yes | Yes |
| OpenCode Zen | Documented billing/usage page; no confirmed programmatic per-run cap | Yes (request counting only) | Depends on the OpenCode CLI/server's own cancellation support — not verified here |
| Codex CLI / Claude Code (as subprocesses) | Not confirmed from `--help` alone | Yes — the extension can cap how many subprocess invocations it starts | Yes, by killing the subprocess |

Every row supports client-side request counting and cancellation at minimum; only the direct-API providers (OpenAI, Anthropic, OpenRouter) additionally expose a provider-enforced spend cap independent of the extension's own bookkeeping.

## Credential handling

No new credential storage is required for the client-driven paths (Copilot via `vscode.lm`, or CLI subprocess clients that already manage their own auth). If a direct-API path (OpenAI/Anthropic/OpenRouter) were ever added, its key would need its own explicit `SecretStorage` entry and its own consent prompt — never reused from, or written to, the existing `artificialAnalysis.apiKey` secret, and never read from an editor's or CLI's own credential files (the same boundary already fixed for OpenCode in `docs/opencode-integration.md`'s rejected config/auth-file-read alternative).

## Consent and data handling

Mirrors the existing local-usage-history pattern (`ensureUsageConsent`, a generation counter, and `clearUsageData` in `src/extension.ts`): a first-run modal naming exactly what will happen (real, billed requests will be sent, up to the stated caps), a visible indicator while a run is active, and an explicit erase action for stored measured results. No run starts without consent; consent for usage-history reading does not imply consent for measured evaluations, and vice versa — they would be separate toggles.

## Separation from other data

Per the roadmap's acceptance criterion, measured results must never silently substitute for or blend with published Artificial Analysis benchmarks or local-history estimates in a chart, table, or export — each keeps its own provenance label and its own citation (config/date for measured, catalog/registry date for benchmarks, scan window for history), consistent with how `src/drift.ts` and `src/plans.ts` already keep provenance explicit rather than blending sources.

## Test plan (for when delivery is scheduled)

- A fake/mocked provider (not a real `vscode.lm` model, per the existing host-test guard whose `sendRequest` throws "Inference must never be called") that counts calls and returns deterministic token counts, used to assert: the run stops at exactly `maxRequests`; a cancellation token mid-run leaves partial results and a `cancelled` status; a spend cap computed from returned token counts stops the run at `limit-reached` before exceeding it.
- No run starts without consent (assert the modal/toggle gate, same shape as `ensureUsageConsent`'s tests).
- Erase deletes stored measured results and cancels any pending run, mirroring `clearUsageData`'s tests.
- A measured result never appears in, or is computed from, the benchmark or usage-history aggregates (export/UI assertions).
- The existing "Inference must never be called" guard stays in place for every non-evaluation test, so this feature can never accidentally leak a real request into the rest of the suite.

## Decision

**Feasible as a bounded v1**: Copilot-only (via `vscode.lm`, whose consent and cancellation primitives already fit the requirement), with a hard, user-set request cap enforced client-side (no server-side spend cap exists for Copilot, so the extension's own counting is the only enforcement available) and results kept in a wholly separate, clearly labeled store. Direct-API providers (OpenAI/Anthropic/OpenRouter) offer stronger provider-enforced spend caps but require new credential storage and consent scope; they are candidates for a later iteration, not v1. Delivery is not scheduled now: it is real, billed work with real user financial exposure, so it should not start without an explicit go-ahead beyond this investigation, per the roadmap's own instruction that "listing them does not authorize inference, spending, account changes, or additional data collection."

## Failure states

Not applicable — no runtime behavior is introduced by this investigation.

## Open blockers

- No provider-side spend cap exists for GitHub Copilot; a v1 must document that its request cap is best-effort client-side counting, not a hard financial guarantee.
- Codex CLI / Claude Code per-run budget flags were not found in `--help` output; confirm against their full documentation (not just `--help`) before relying on subprocess-level caps for those clients.
- OpenCode Zen's server-side cancellation behavior was not verified locally (would require starting `opencode serve`, already rejected as an extension boundary in `docs/opencode-integration.md` for unrelated credential-leak reasons).
