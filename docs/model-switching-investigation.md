# User-controlled model switching — feasibility investigation

Status: **Decided — no delivery for host-triggered Apply; deliver an invocable-id copy fix instead** (roadmap: `docs/roadmap.md`).

Date checked: 2026-09-14. Versions: VS Code 1.137.0, GitHub Copilot Chat (bundled model picker), OpenCode 1.18.30, Codex CLI 0.149.1, Claude Code 2.1.261. Gemini CLI not installed locally; checked from documentation only. Extension version at time of writing: 0.11.0.

This document records what was verified against installed clients and official documentation. No inference request was sent, no session was started, and no client configuration or credential file was read or written during verification.

## Documentation checked

- VS Code built-in commands reference: `https://code.visualstudio.com/api/references/commands`.
- VS Code Language Model API guide: `https://code.visualstudio.com/api/extension-guides/ai/language-model`.
- VS Code Chat extension guide: `https://code.visualstudio.com/api/extension-guides/ai/chat`.
- `@types/vscode` 1.100 (bundled in this repo's `node_modules`).
- OpenCode config (`model` key), CLI reference, TUI reference, server reference: `https://opencode.ai/docs/config`, `/docs/cli`, `/docs/tui`, `/docs/server`.
- Codex CLI reference and config reference: `https://developers.openai.com/codex/cli`, `https://developers.openai.com/codex/config-reference` (`model`, `model_reasoning_effort`, `-c`/`--config`).
- Claude Code settings and CLI reference: `https://docs.claude.com/en/docs/claude-code/settings`, `https://docs.claude.com/en/docs/claude-code/cli-reference` (`model`, `ANTHROPIC_MODEL`, `--model`, `/model`).
- Gemini CLI configuration: `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md` (`-m`/`--model`, `settings.json` `model.name`).
- Aider configuration: `https://aider.chat/docs/config/options.html` (`--model`, `.aider.conf.yml` `model`).
- Cursor, Windsurf, Amazon Q: public docs searched for any documented external/CLI/API surface to set the active chat model from outside the editor session itself; none found for any of the three (see per-client rows below).

## Local experiments (reproducible, no inference, no secrets)

All commands were run on Linux with the versions above. No `run`, `exec`, `-p`/`--print`, chat `query` argument, `codex doctor`, or `codex debug models` was executed — those either send a prompt or touch auth/runtime state beyond what is needed here.

```sh
grep -o 'modelSelector.\{0,160\}' /usr/share/code/resources/app/out/vs/workbench/workbench.desktop.main.js
grep -c 'No language models found matching selector' /usr/share/code/resources/app/out/vs/workbench/workbench.desktop.main.js
grep -n 'modelSelector\|setCurrentLanguageModel' node_modules/@types/vscode/index.d.ts

opencode run --help
opencode models openai        # existing discovery path, read-only

codex --help
codex exec --help

claude --help
```

Observed:

- The installed VS Code 1.137.0 workbench bundle implements a `modelSelector` argument on the `workbench.action.chat.open` command: it calls `selectLanguageModels(modelSelector)`, picks the first sorted match, then calls `setCurrentLanguageModel` on the chat widget's input. If no model matches, it throws `No language models found matching selector: <json>`; if a matched model isn't loaded, `Language model not loaded: <id>`. The same command also accepts `mode` and a `query` (which would submit a prompt — out of scope here) and `isPartialQuery`.
- This argument is **not** in `@types/vscode` 1.100 (no `modelSelector`, `setCurrentLanguageModel`, in the public command or API surface) and is **not** listed on `code.visualstudio.com/api/references/commands`. It is internal/undocumented workbench behavior, observed only by reading the shipped bundle, not a supported extension API.
- There is no public VS Code API to read back which model the Chat view currently has selected outside a chat participant's own `ChatRequest.model` (only visible inside that participant's own request handler, not to an arbitrary extension).
- `opencode run --help` confirms `-m, --model` (`provider/model`) and `--variant` (provider-specific reasoning effort) as documented, per-invocation flags — no persistent "set the default model" command exists in the CLI reference.
- `codex --help` / `codex exec --help` confirm `-m, --model <MODEL>` as a per-invocation flag, and `-c model="…"` / `-c model_reasoning_effort="…"` as documented config overrides (dotted-path TOML values layered over `~/.codex/config.toml`).
- `claude --help` confirms `--model`, `--fallback-model`, and `--effort <level>` as per-session CLI flags; `/model` is documented as an in-session slash command, and `settings.json`'s `model` key sets the default outside any session.

## Capability matrix

| Client | Apply mechanism | Documented? | Variant/effort handling | Verify applied selection | Account-availability check | Failure feedback |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub Copilot (VS Code) | `workbench.action.chat.open` with `{ modelSelector }` | No — internal workbench behavior, absent from `@types/vscode` and the commands reference | `modelSelector` matches on vendor/family/id, no separate effort field | None — no public read-back API | `vscode.lm.selectChatModels` (already used for discovery) | Command throws `No language models found matching selector` / `Language model not loaded`, but only inside VS Code's own error handling, not surfaced to the caller in a structured way |
| OpenCode | `-m provider/model [--variant v]` per `opencode run` invocation, or `model`/`variant` in `opencode.json` | Yes (CLI reference, config schema) | `--variant` flag, separate from model id | Not applicable — the extension only discovers/compares, never starts a run | `opencode models` (already used for discovery) | CLI reports an unknown-provider/model error and exits non-zero (observed on `opencode models does-not-exist` during Tier 1 work); a launch string can't be verified without starting the run itself |
| Codex CLI | `-m MODEL` per invocation, or `-c model="…"` (`-c model_reasoning_effort="…"` for effort) | Yes (CLI reference, config reference) | Separate `model_reasoning_effort` config key | Not applicable — no run is started | No documented static/offline listing distinct from Copilot's `vendor:"copilot"` catalog; would need a real login | Malformed `-c` values are reported as TOML parse errors before any session starts |
| Claude Code | `--model`, `--effort <level>` per invocation, or `model` in `settings.json` | Yes (CLI reference, settings docs) | Separate `--effort` flag | Not applicable | No documented offline listing | CLI reports unknown-model errors before starting a session |
| Gemini CLI | `-m/--model`, or `model.name` in `settings.json` | Yes (public docs) | Not verified locally (not installed) | Not applicable | Not verified locally | Not verified locally |
| Aider | `--model`, or `model` in `.aider.conf.yml` | Yes (public docs) | Not verified locally | Not applicable | Not verified locally | Not verified locally |
| Cursor, Windsurf, Amazon Q | None found | No documented external command/API to set the active model from outside the editor's own UI | — | — | — | — |

## Existing behavior this investigation surfaced

`src/extension.ts:867-872`'s `copy` handler writes the model's **display name** to the clipboard (e.g. `"GPT-5.4 (high)"`), not an invocable identifier. That string cannot be pasted into any of the per-invocation flags above — `openai/gpt-5.4#high` (or `-m openai/gpt-5.4 --variant high`) is what OpenCode, Codex, and Claude Code actually accept. This is a small, independently fixable gap, tracked below.

## Decision

**No host-triggered Apply action is added for any client.**

- **Copilot:** the only mechanism found is undocumented internal workbench behavior with no way to verify the result. Per the roadmap's acceptance criterion ("do not silently switch models or edit undocumented configuration"), this is out of scope. Revisit only if VS Code publishes a supported API for setting or reading the Chat view's selected model.
- **OpenCode, Codex, Claude Code, Gemini CLI, Aider:** model selection is either a per-invocation CLI flag or a config key edited outside any session the extension starts. The extension never launches these CLIs interactively and has no reason to start doing so just to apply a model choice — that would cross from comparison into orchestration. There is also no way to confirm a config-file edit took effect without re-invoking the CLI.
- **Cursor, Windsurf, Amazon Q:** no external selection surface exists to target.
- **Copy-name stays the fallback**, per the acceptance criterion, but is corrected to copy an **invocable identifier** appropriate to the row's source (`provider/model#variant` for OpenCode; the bare id for the static-source clients, documented as "paste after `--model`/`-m`") instead of the display name. This is scoped as a small delivery task (see `docs/roadmap.md`).

## Failure states

Not applicable — no new runtime behavior is introduced by this investigation.

## Open blockers

- No supported VS Code API exists to set or verify the Chat view's model from an extension. This blocks any future Copilot Apply action regardless of implementation effort.
- Gemini CLI and Aider flag/config behavior was checked from documentation only, not run locally (Gemini CLI is not installed here; Aider was not installed either). Record as unperformed validation if either becomes a delivery candidate later.
