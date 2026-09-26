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

Boundary: `opencode models --verbose`, parsed by `parseModels`; the CLI
version is probed best-effort via `opencode --version` (`parseOpenCodeVersion` /
`getOpenCodeVersion`) and attached to every discovery-failure diagnostic, so a
tier-shape change reads as "OpenCode CLI 1.18.30: …" rather than an
unexplained count. Parse failures carry a content-free fingerprint
(`blocks`, `jsonFailures`, `missingId/Provider/Name`, `invalidProvider`) plus
"please file an issue with the fingerprint and your OpenCode CLI version".

| Client version | OS | Install method | Verified scope | Date | Evidence | Fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 1.18.30 | Linux | install script (`~/.opencode/bin`) | Home fallback, path with spaces; 17 free-tier rows / 13 variants; priced `opencode-go` (65) + unpriced `openai` (81) with a real signed-in account (163 rows total) | 2026-09-10 / 2026-09-14 | `docs/opencode-integration.md`, `docs/testing.md` | `test/fixtures/opencode/verbose-1.18.30.txt` (synthetic representative of the observed shape, not a raw capture) |
| 1.18.30 | Linux | npm global | PATH, path with spaces; 17 free-tier rows | 2026-09-14 | CI run 34817372006 (`OpenCode smoke (ubuntu-latest, npm)`), `docs/testing.md` | Same representative fixture |
| 1.18.30 | macOS | install script + npm global | PATH, path with spaces; 17 free-tier rows | 2026-09-14 | CI run 34817372006 (both macOS smoke jobs), `docs/testing.md` | Same representative fixture |
| 1.18.30 | Windows | npm global | npm-layout candidate (`node_modules\opencode-ai\bin\opencode.exe`), path with spaces; 17 free-tier rows | 2026-09-14 | CI runs 34817141985 (gap) → 34817372006 (fixed), `docs/testing.md` | Same representative fixture |

Drift case: `test/fixtures/opencode/drifted.txt` is a hypothetical future
shape (a single top-level JSON document with no `provider/model` header
lines). `parseModels` rejects it with a `parse` error carrying
`schema v1 blocks=0 …` and the file-an-issue guidance; `discoverOpenCode`
additionally attaches the probed CLI version. Covered by a drifted-schema
regression test.

**Unverified:** provider-billed pricing and native resolution with a real
signed-in account on macOS and Windows (CI is credential-free by design);
install-script layout on Windows (POSIX-shell target, not exercised).
