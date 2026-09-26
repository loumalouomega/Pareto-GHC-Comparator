# Integration evidence matrix

Date checked: 2026-09-14. This page records which client × platform × version
combinations have been verified for the two local integrations whose schemas
can drift under us (Copilot chat session files, OpenCode CLI output), and
which fixtures pin each verified shape. It is referenced by
`docs/opencode-integration.md` (OpenCode boundary) and
`docs/cli-investigation.md` (standalone reuse of the OpenCode adapter).
Schema drift in either integration degrades to an actionable, content-free
fingerprint — never a silent zero — as described in each row.

## Copilot chat sessions (`src/usage.ts`)

VS Code / Copilot Chat exposes no session-schema version, so there is no
per-release capture to pin: the parser keys on the `kind` 0/1/2 envelope
shapes documented in `src/usage.ts`. All fixtures below are synthetic,
hand-written representatives — not captures from a real account.

| Fixture | Shape | Expected result |
| --- | --- | --- |
| `test/fixtures/usage/stable.jsonl`, `insiders.jsonl` | `kind: 0` anchor + `kind: 1` result | 1 observed request, `unsupported: 0`, no fingerprint |
| `test/fixtures/usage/truncated.jsonl` | Anchor + result + truncated line | 1 request, `malformed: 1`, no fingerprint |
| `test/fixtures/usage/unsupported.jsonl` | `{"newFormat": {"events": []}}` (no known envelope) | `unsupported: 1`, `fingerprint: jsonl v1 lines=1 kinds=[kind:absent] … envelopes=[no-anchor no-append no-result]` |
| `test/fixtures/usage/drifted.jsonl` | `kind: 3` + `kind: "session.v2"` (future kinds, no 0/1/2 envelope) | `unsupported: 1`, fingerprint records `kinds=[3,session.v2]` with no known envelope — covered by a drifted-schema regression test |
| `test/fixtures/usage/legacy.json` | Legacy `{"requests": [...]}` document | Text-length estimates stay labelled `estimated` |

Unsupported files surface as: "Unsupported files don't match any known
Copilot chat schema — please file an issue with the fingerprint(s): …" in
the Usage card (`webview/main.ts`), with previously stored requests retained
as stale contributions. Fingerprints record only known-field presence and
bounded shape counters — never values, chat text, identifiers, or paths.

**No CI job can exercise a real Copilot chat session.** There is no Copilot
CLI, no server, and no documented export; session files exist only on a
signed-in machine. That user-reported fingerprint notice is therefore the whole
of the Copilot-side drift signal, and a scheduled check against the latest
`@types/vscode` would cover extension-API drift rather than this session shape.
Verdict and cadence: `docs/schema-drift-investigation.md`.

### Session storage roots

`usageRoots()` in `src/usage.ts` enumerates where those sessions can live. Only
the root's *path* is claimed here; the session *shape* is the section above and
is verified only against synthetic fixtures.

| Root id | Editor | Path (Linux; macOS swaps the base for `~/Library/Application Support`, Windows for `%APPDATA%`) | Evidence | Status |
| --- | --- | --- | --- | --- |
| `code`, `code-insiders` | VS Code, VS Code Insiders | `<base>/Code{, - Insiders}/User/workspaceStorage` | VS Code's documented user-data layout; the two roots shipped before the registry existed | In use since 1.0.0 |
| `vscodium`, `cursor`, `windsurf`, `code-oss`, `trae` | VS Code forks | `<base>/<Editor dir>/User/workspaceStorage` | Forks keep VS Code's `User/workspaceStorage` layout; each is offered only when its directory exists, never asserted to support Copilot | Path only; no session read on this machine |
| `vscode-server`, `vscode-server-insiders` | Remote-SSH / WSL / dev container hosts | `~/.vscode-server{,-insiders}/data/User/workspaceStorage` (non-Windows hosts only) | VS Code Server keeps remote user data under `~/.vscode-server/data/User`; the extension host runs on the remote side, so these roots are local to it | Path only; no session read on this machine |

Detection is existence-only (`detectUsageRoots` stats the directory), and a root
is read only after its own opt-in, so listing a root in the Usage card is not a
read of its contents.

**Unverified:** parsing against a real signed-in Copilot session store on any
platform or in any fork, and that a given fork still ships Copilot Chat at all.
Automated tests use synthetic fixtures only; a real smoke test needs Copilot
sign-in on a user-owned machine.

## OpenCode CLI (`src/opencode.ts`)

**Two listing surfaces, because 1.x and 2.x share none.** 1.x exposes
`opencode models --verbose`, parsed by `parseModels`. 2.x removed that flag but
exposes `opencode api model.list`, an OpenAPI client whose `Model.Info` carries
the same identity, limits, per-million rates, long-context tiers, and variants;
`parseModelList` reads it. `cost` and `variants` are arrays on 2.x where 1.x
nests them, and 2.x composes `id` as `providerID/modelID` with the bare id in
`modelID`. The CLI version is probed best-effort via `opencode --version`
(`parseOpenCodeVersion` / `getOpenCodeVersion`) and attached to every
discovery-failure diagnostic, so a tier-shape change reads as "OpenCode CLI
2.0.16: …" rather than an unexplained count — 2.x prefixes that output with the
binary name, so the parser matches a version-shaped token rather than assuming
the first one. Parse failures carry a content-free fingerprint
(`blocks`/`records`, `jsonFailures`, `missingId/Provider/Name`,
`invalidProvider`, plus `envelope` for the 2.x shape) plus "please file an issue
with the fingerprint and your OpenCode CLI version".

`discoverOpenCode` tries the 1.x surface first, so every currently-working
install stays on exactly the path it uses today, and falls back to the 2.x one
when the first yields nothing — a dispatch by fallback rather than a version
table, so a future release that keeps either surface keeps working. A missing
binary or a timeout is an environment failure rather than a shape change and
never falls back, since a second attempt could only double a 20-second wait.
When neither surface lists anything, the 1.x failure is reported (it is the
preferred surface) with the 2.x attempt named alongside it. A 2.x background
service that has not finished starting answers with an error envelope rather
than a listing, which is indistinguishable from real drift, so `discoverOpenCode`
retries that surface once (`retryDelayMs`, set by the extension host and the
smoke script, disabled by default so tests stay timer-free).

CI cannot see a 2.x regression on its own: the `opencode-smoke` npm lane pins
1.18.30, the `script` lane installs latest under `continue-on-error: true`, and
the release workflow has no `schedule:` trigger. No 2.x release exists on npm at
all (`latest` is 1.18.32), so the install-script lane is structurally the only
one that can ever exercise v2. **Early warning is now the weekly
`drift.yml` lane** (see `AGENTS.md`): it runs both lanes on Linux, classifies
the pair with `src/opencodeDrift.ts`, and files or updates one tracked issue
only when the pinned release lists models and the latest one does not. Its
evidence is in `docs/testing.md`; the underlying investigation is
`docs/schema-drift-investigation.md`.

| Client version | OS | Install method | Verified scope | Date | Evidence | Fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 1.18.30 | Linux | install script (`~/.opencode/bin`) | Home fallback, path with spaces; 17 free-tier rows / 13 variants; priced `opencode-go` (65) + unpriced `openai` (81) with a real signed-in account (163 rows total) | 2026-09-10 / 2026-09-14 | `docs/opencode-integration.md`, `docs/testing.md` | `test/fixtures/opencode/verbose-1.18.30.txt` (synthetic representative of the observed shape, not a raw capture) |
| 1.18.30 | Linux | npm global | PATH, path with spaces; 17 free-tier rows | 2026-09-14 | CI run 34817372006 (`OpenCode smoke (ubuntu-latest, npm)`), `docs/testing.md` | Same representative fixture |
| 1.18.30 | macOS | install script + npm global | PATH, path with spaces; 17 free-tier rows | 2026-09-14 | CI run 34817372006 (both macOS smoke jobs), `docs/testing.md` | Same representative fixture |
| 1.18.30 | Windows | npm global | npm-layout candidate (`node_modules\opencode-ai\bin\opencode.exe`), path with spaces; 17 free-tier rows | 2026-09-14 | CI runs 34817141985 (gap) → 34817372006 (fixed), `docs/testing.md` | Same representative fixture |
| 1.18.32 | Linux | npm global (postinstall binary) | 1.x surface unchanged after the 2.x work: 204 rows / 189 variants / 22 free, `--expect-free` satisfied, `cliVersion` 1.18.32 | 2026-09-26 | local run of `scripts/opencode-smoke.ts` against a real 1.18.32 install | `test/fixtures/opencode/verbose-1.18.30.txt` (the 1.x contract fixture) |
| 2.0.16 | Linux | install script (`~/.opencode/bin`) | `models --verbose` exits 1 (`Unrecognized flag: --verbose`), but `api model.list` returns the full listing: 143 rows / 124 variants / 76 priced / 22 free / 24 long-context tiers, `--expect-free` satisfied, `cliVersion` 2.0.16. `api` is absent on 1.x and `--verbose` on 2.x, so neither surface serves both. `--version` prints `opencode v2.0.16`. Still absent in 2.0.16: `--refresh`, `db` | 2026-09-26 | local run of `scripts/opencode-smoke.ts` against a real 2.0.16 install; surface established from `opencode api GET /openapi.json` (`Model.Info`, `Model.Cost`, `Model.Variant`) | `test/fixtures/opencode/model-list-2.0.16.json` (sanitized representative of the observed shape, not a raw capture) |

## Claude Code transcripts (`src/usageClaude.ts`)

Boundary: `~/.claude/projects/<projectSlug>/<sessionId>.jsonl`, registered as a
`UsageRoot` with `layout: "claude-transcripts"` and its own id, so it shares the
one consent set and the one source list while never being walked as a Copilot
`workspaceStorage` tree. Only `*.jsonl` directly inside a project directory is
read, because the same tree holds Claude Code's auto memory (`memory/MEMORY.md`),
which is user content rather than usage. Parsing keys on `type` and reads only
`assistant` records, whose `usage` carries the same four disjoint buckets
`src/usage.ts` already models; `isSidechain` marks subagent turns.

| Requirement for a per-request ledger | Available in the transcript? | Notes |
| --- | --- | --- |
| Model identity | Yes — `message.model` | Client-reported string, shown verbatim; never prefix-matched to a registry id, which would be inferring from a similar name |
| Input/output tokens | Yes — `usage.input_tokens`, `usage.output_tokens` | |
| Cache buckets | Yes — `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens` | The disjoint buckets `estimate` already models |
| Timestamp | Yes — envelope `timestamp` (ISO string) | A bare number is accepted only when it is plainly epoch milliseconds |
| Workspace attribution | Yes — `cwd` | Same sensitivity as `UsageWorkspaceStat.editor`; full paths stay in tooltips |
| Subagent turns | Yes — `isSidechain` | Held out of the headline totals and counted, never dropped silently |
| Billing tier signal | Yes — `usage.service_tier` | **Never adopted as a rate.** The client computes its own cost; a client-reported price is not a catalog rate |
| Schema version | Envelope `version` | Better than Copilot, which exposes no version at all |
| Vendor-documented record schema | **No** | The directory reference documents `projects/` for auto memory and the CLI reference acknowledges transcripts are purgeable, but no field list or stability promise is published |

| Client version | OS | Verified scope | Date | Evidence | Fixture |
| --- | --- | --- | --- | --- | --- |
| 2.1.280 | Linux | **Shape only.** Key names, record-type names, and row counts read from 8 transcripts; no token, model, path, or content value was recorded. The source has not been run against a real installation | 2026-09-26 | `docs/other-client-usage-investigation.md` | `test/fixtures/usage/claude/*.jsonl` (synthetic representatives written for these tests, not captures) |

Drift case: `test/fixtures/usage/claude/session-drifted.jsonl` is a synthetic
future shape — `assistant` records whose `usage` carries renamed buckets, plus
two unknown record `type` values. `parseClaudeTranscript` reports it
`unsupported` with a `claude-jsonl v1 client=… no-usage.input_tokens …`
fingerprint rather than as a silent zero, and a file that already contributed
keeps its data and is marked stale. The other 13 known record types are
**ignored, not counted malformed**: in the observed sample they outnumber
`assistant` records roughly two to one.

**Unverified:** every platform and version other than the single Linux 2.1.280
observation — macOS and Windows paths follow each platform's home convention but
were never sampled, no real transcript has been parsed end to end, real
multi-root or relocated `cwd` attribution is untested, and how often
`isSidechain` is set in real traffic is unknown. A release that changes any of
these fields is expected to surface as a fingerprint, not a wrong total.

Drift cases: `test/fixtures/opencode/drifted.txt` is a hypothetical future 1.x
shape (a single top-level JSON document with no `provider/model` header
lines). `parseModels` rejects it with a `parse` error carrying
`schema v1 blocks=0 …` and the file-an-issue guidance; `discoverOpenCode`
additionally attaches the probed CLI version. Covered by a drifted-schema
regression test. On the 2.x surface the equivalent failure is a response
without a `data` array — which is also what a 1.x binary and a cold background
service both return — so `parseModelList` reports `list schema v1 envelope=true
…` rather than a silent zero-model listing.

**Unverified:** provider-billed pricing and native resolution with a real
signed-in account on macOS and Windows (CI is credential-free by design);
install-script layout on Windows (POSIX-shell target, not exercised); the 2.x
listing surface on macOS and Windows, and whether the `--verbose` removal also
holds there (the flag's absence is version-level, so a platform difference is
unlikely, but it is unmeasured — the `script` smoke lane and the `drift.yml`
lane both exclude `windows-latest`); how long a 2.x background service takes to
become ready, so whether the single retry is always sufficient on a cold
machine; any 2.x release after 2.0.16; and whether a scheduled workflow is
permitted to open issues in this repository.
