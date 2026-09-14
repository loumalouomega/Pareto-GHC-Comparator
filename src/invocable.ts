// Pure, webview-safe (no Node imports). The one place that decides what
// "Copy" puts on the clipboard: an identifier a client's own documented
// --model flag or config key accepts verbatim, never one derived from a
// display name or an internal registry key. See
// docs/model-switching-investigation.md for why no client gets a
// host-triggered Apply action, and docs/roadmap.md for this task's scope.
import type { AvailableModel, InvocableRef } from "./types";
import { isStaticSource, type StaticSource } from "./staticSources";

/** Doc-verified usage hint per static source; absent sources have no documented id surface at all. */
const staticUsage: Partial<Record<StaticSource, string>> = {
  "claude-code": "claude --model <id> / \"model\" in settings.json",
  codex: "codex -m <id> / \"model\" in config.toml",
  "gemini-cli": "gemini -m <id> / \"model.name\" in settings.json",
};

/**
 * The exact identifier the model's source client accepts, or null when none
 * is verified. OpenCode's id is always derivable (the CLI's own
 * `provider/model[#variant]` reference form); static sources need an
 * explicit, doc-checked `AvailableModel.invocableId` per model (see
 * src/staticSources.ts); Copilot always returns null (model selection has no
 * documented external id surface, only the in-editor Chat model picker).
 */
export function invocableRef(model: AvailableModel): InvocableRef | null {
  if (model.source === "opencode") {
    const ref = model.id.replace(/^opencode:/, "");
    return {
      ref,
      usage: "opencode run -m <id> / \"model\" in opencode.json",
    };
  }
  if (model.source && isStaticSource(model.source) && model.invocableId) {
    const usage = staticUsage[model.source];
    if (usage) return { ref: model.invocableId, usage };
  }
  return null;
}
