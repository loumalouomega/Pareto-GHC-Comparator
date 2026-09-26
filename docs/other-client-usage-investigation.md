# Local usage from other assistant clients — feasibility investigation

Status: **Decided — Claude Code feasible with delivery recommended; OpenCode not supported.** The Claude Code source has since shipped (`src/usageClaude.ts`); OpenCode remains unsupported and no read of its store is implemented.

Date checked: 2026-09-26. Versions: Claude Code 2.1.280, OpenCode 2.0.16, documentation pages fetched 2026-09-26. Extension version at time of writing: 1.2.0.

This document records what was verified against installed clients and official documentation. No inference request was sent, no session was started, no client configuration was read or written, and **no credential value, message content, or model identifier belonging to the machine's user was read into this document.** Local inspection was limited to directory and file *shapes*: file names, JSON/SQLite *key names*, column names, and row counts.

## Documentation checked

- Claude Code local data: `https://code.claude.com/docs/en/claude-directory` (the `~/.claude` layout reference) — documents the global `~/.claude/` directory and, in its Global tab, `projects/` as **auto memory** (`projects/<project>/memory/MEMORY.md` plus topic files, keyed by repository path).
- Claude Code CLI reference: `https://code.claude.com/docs/en/claude-code/cli-reference` — `claude project purge [path]` is documented as deleting "all local Claude Code state for a project: transcripts, task lists, debug logs, file-edit history, prompt history lines, and the project's entry in `~/.claude.json`". This establishes that per-project transcripts exist as local state and are user-deletable.
- OpenCode CLI reference: `https://opencode.ai/docs/cli/` (page footer "Last updated: Sep 25, 2026"; the site carries a "New OpenCode v2 is now available" banner). The `models` command still documents `--verbose` ("Use more verbose model output (includes metadata like costs)") and `--refresh`. The same page documents `stats` ("Show token usage and cost statistics"), `session list --format json`, `export [sessionID] --sanitize`, and `db [query] --format json|tsv` / `db path`.
- Neither client's documentation specifies a **session record schema**: no field list, no version contract, and no stability guarantee for either the Claude transcript JSONL or the OpenCode session store.

## Local experiments (reproducible, no inference, no secrets)

Redaction rule applied throughout: only names of directories/files, JSON keys, SQLite table and column names, and row counts were read. Token, cost, path, model-id, and message-content values were never read or recorded.

- `~/.claude/projects/` contains one directory per project slug, each holding `<sessionId>.jsonl` transcripts, plus other local state (`sessions/`, `cache/`, `backups/`, `ide/`, `downloads/`).
- Claude transcript shape: one JSON object per line. Across the 8 most recent transcripts, 14 distinct `type` values were observed — `assistant` (6348), `attachment` (3591), `user` (2984), `atis-latch` (1000), `last-prompt` (999), `ai-title` (992), `pr-link` (400), `bridge-session` (375), `queue-operation` (191), `mode` (165), `file-history-delta` (89), `file-history-snapshot` (23), `cost-state` (15), `system` (4). Only a small subset carries usage.
- An `assistant` record's envelope keys: `advisorModel`, `apiBlockIndex`, `cwd`, `effort`, `entrypoint`, `gitBranch`, `isSidechain`, `message`, `parentUuid`, `perTurnEffort`, `requestId`, `serverClassifierRequest`, `sessionId`, `slug`, `timestamp`, `type`, `userType`, `uuid`, `version`. Its `message` carries `model`, `role`, `content`, `usage`, `stop_reason`, `context_management`, `diagnostics`, `input_transformations`, `id`, `container`.
- The `usage` object carries the four disjoint token buckets this extension already models: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, plus `service_tier`, `inference_geo`, `iterations`, `output_tokens_details`, `server_tool_use`.
- `opencode models --verbose` fails on 2.0.16 with exit 1 and `Unrecognized flag: --verbose in command opencode models`; `opencode models --help` lists neither `--verbose` nor `--refresh`. `scripts/opencode-smoke.ts` against the installed binary reports `ok: false, kind: "command"`.
- `opencode models` with no flags succeeds (exit 0) and prints one bare `provider/model` id per line — no cost, no variant, and not JSON.
- `opencode stats --cost` succeeds and prints human-formatted aggregate totals (cost, input, output, reasoning, cache read, cache write, cached-input percentage). It has no `--format`/`--json` flag in 2.0.16, so the output is not machine-readable through any documented surface.
- `opencode session list -n 1 --format json` returns valid JSON (a list), but returned zero rows in this environment, so its field set is unverified.
- `opencode db path` is not a command in 2.0.16 — it prints generic CLI help — despite being documented.
- The OpenCode session store is `~/.local/share/opencode/opencode.db` (SQLite, with `-wal`/`-shm` siblings). Table names and row counts only: `session_v2` (122) and a parallel legacy `session` table, `message` (10310), `session_message` (11445), `part` (39948), `migration` (48), plus `project`, `workspace`, `todo`, `event`, `kv`, and others. `session_v2` columns include `directory`, `model`, `cost`, `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`, `time_created`, `time_updated`, `time_archived`, `time_suspended`. Legacy JSON files remain under `storage/session_diff/`.
- **The same database file holds credential tables.** `pragma table_info` shows `account` and `control_account` with `access_token`/`refresh_token` columns and `credential` with a `value` column. No row from any of these tables was read. A reader of this file would have to be trusted to avoid them.

## Evidence per client

### Claude Code

| Requirement for a per-request ledger | Available in the transcript? | Notes |
| --- | --- | --- |
| Model identity | Yes — `message.model`, plus `advisorModel`, `effort` | Model ids are client-reported strings, not our catalog ids; they need the same namespaced-identity treatment as OpenCode's `provider/model` |
| Input/output tokens | Yes — `usage.input_tokens`, `usage.output_tokens` | Directly comparable to the buckets `src/usage.ts` already aggregates |
| Cache buckets | Yes — `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens` | Matches the disjoint input/cache-read/cache-write model in `estimate` (`src/compare.ts`) |
| Timestamp | Yes — envelope `timestamp` | |
| Workspace attribution | Yes — `cwd`, and a `slug` key | `cwd` is a real absolute path: the same sensitivity as `UsageWorkspaceStat.editor`, and it must never leave the machine |
| Subagent turns | Yes — `isSidechain` | Must be excluded or labelled, or subagent work double-counts |
| Billing tier signal | Yes — `usage.service_tier` | A real pricing input, but see "prices are never inferred" below |
| Schema version | Envelope `version` | Better than Copilot, which exposes no version at all |
| Vendor-documented record schema | **No** | The directory page documents `projects/` for auto memory; the CLI reference acknowledges transcripts exist and are purgeable, but no field list or stability promise is published |

### OpenCode

| Candidate surface | Machine-readable | Per-request | Verdict |
| --- | --- | --- | --- |
| `opencode stats --cost` | No — no documented format flag | No, aggregate totals only | Cannot feed model/day/workspace tables; parsing a human-formatted table is not a supported contract |
| `opencode session list --format json` | Yes | No token/cost fields documented; returned 0 rows here | Listing surface only; unverified content |
| `opencode.db` (`session_v2`, `message`, `part`) | Yes, via SQL | Yes, and richer than Copilot (per-session `cost`) | Undocumented schema with two live session tables and a migration ledger, co-located with OAuth credential tables |
| `opencode models --verbose` (the shipped discovery path) | Was JSON in 1.18.30 | n/a | **Removed in 2.0.16** — see `docs/schema-drift-investigation.md` |

## Decision

**Claude Code: feasible, delivery recommended as a separate opt-in source. OpenCode: not supported.**

- **Claude Code** carries everything a per-request ledger needs — model, four disjoint token buckets, timestamp, workspace, subagent flag, service tier, and a `version` field — in a per-project JSONL transcript that the vendor acknowledges as local, purgeable state. Delivery is recommended as a **new source beside Copilot's, never merged into it**: its own root entry, its own consent record, its own unit, and its own tables.
- **The schema is still unverified by the vendor.** No field list or stability promise is published, which is the same evidence standard the repository already applies to Copilot chat sessions (`docs/integrations.md` calls those fixtures synthetic representatives for exactly this reason). A Claude source therefore ships only with the drift machinery that already exists: a content-free schema fingerprint, `unsupported` handling that keeps previous data, and a "file an issue with the fingerprint" path. One advantage over Copilot: transcript records carry `version`.
- **Client-side cost fields are not prices.** `service_tier` and the observed `cost-state` record mean the client computes its own cost. The repository never adopts a client-reported price as a catalog rate; a Claude source must price from catalog/BYOK inputs or stay unresolved, exactly as `src/compare.ts` treats provider-billed OpenCode rows today.
- **Units stay separate and are never summed.** Copilot bills in premium requests or AI credits; Claude Code bills as an Anthropic subscription or API usage in USD; OpenCode bills per provider in USD. A shared currency label does not make billing models comparable, so a future Claude ledger must carry its own unit through every surface (`src/normalize.ts`'s optional USD-equivalent remains the only place a converted value may appear, and only for a *selected* row in the two-option comparison).
- **OpenCode is not supported for a ledger.** The richest surface is an undocumented SQLite schema that is mid-migration (two live session tables, a 48-entry `migration` ledger) and lives in the same file as OAuth access and refresh tokens. Opening a credential-bearing database to answer a usage question is a materially different consent proposition from reading chat session files, and the repository's bar — a documented, stable format read under an explicit opt-in — is not met by any of the three candidate surfaces. Revisit only if OpenCode documents a stable export or a supported query interface.
- **OpenCode's own documentation is not a reliable contract for v2.** The published CLI page still documents `models --verbose` and a `db` command that the installed 2.0.16 build does not have. That mismatch is itself the strongest argument against building on an undocumented surface.

## What a future Claude source must satisfy

- **Consent:** a per-root opt-in with a stated purpose, mirroring the existing `UsageRoot` registry and `detectUsageRoots` existence-only detection — the extension must offer the editor without reading inside it. Watching stays visible outside the Usage tab, and erase must drop the source's data while other sources keep theirs.
- **Purpose in the UI:** name what is read (token counts, model, timestamp, workspace) and what is not (message content), and point at `claude project purge` as the client's own deletion control.
- **Parser discipline:** key on `type`, use only `assistant` records for usage, treat `isSidechain` explicitly, and ignore the 12+ record types that carry no usage rather than treating them as malformed.
- **Path handling:** derive workspace labels from `cwd` with the same `src/workspaceLabel.ts` treatment; full paths stay in `title` tooltips and never leave the machine.
- **Provenance:** every aggregate stays labelled with its source client, and completeness counters follow the existing `UsageCompleteness` discipline so a missing field is never read as a zero.

## Failure states

Not applicable — no new runtime behavior is introduced by this investigation. The failure states a future Claude source would need (unsupported schema, changed record shape, unreadable root, mid-scan consent change) are the ones `src/usage.ts` already implements for Copilot.

## Open blockers

- **The Claude transcript schema is undocumented.** Observed shapes are evidence, not a contract; a vendor release could change any field. This is the same class of risk as Copilot's unversioned sessions, and it is why delivery is gated on fingerprinting rather than scheduled as a straightforward reader. **Delivered 2026-09-26** in `src/usageClaude.ts` with exactly that machinery; the schema remains unverified, so a change is reported as a fingerprint rather than absorbed.
- **Only Linux was inspected.** macOS (`~/.claude`) and Windows (`%USERPROFILE%\.claude`) paths follow from the platform's home conventions but were not verified, and no Windows or macOS transcript shape was sampled. Record as unperformed validation.
- **One Claude version was inspected (2.1.280).** No older or newer version was compared, so the schema's stability across releases is unmeasured.
- **`opencode session list --format json` returned no rows here**, so its field set is unknown; it was not retried against a running server.
- **OpenCode's `stats` output format was not captured** as a fixture, and its localized/formatting variants are unknown. Even if it were parsed, aggregate totals cannot produce a per-request ledger.
- **The OpenCode credential co-location was established from column names only.** Any future reader would need a threat model for a database that stores OAuth tokens, which this investigation did not produce.
