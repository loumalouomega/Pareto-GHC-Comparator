import { parseOptions } from "./compare";
import type { HostMessage, ProfileAction, Source } from "./types";
const validSources: Source[] = [
  "copilot",
  "opencode",
  "claude-code",
  "codex",
  "gemini-cli",
  "cursor",
  "windsurf",
  "aider",
  "amazon-q",
];
export function parseMessage(raw: unknown): HostMessage {
  if (!raw || typeof raw !== "object") throw new Error("Invalid action.");
  const m = raw as Record<string, unknown>;
  const string = (v: unknown): v is string =>
    typeof v === "string" && v.length <= 1000;
  if (m.type === "ready" || m.type === "refresh" || m.type === "key")
    return { type: m.type };
  if (m.type === "exportCsv") return { type: "exportCsv" };
  if (
    m.type === "exportPng" &&
    typeof m.png === "string" &&
    m.png.startsWith("data:image/png;base64,") &&
    m.png.length <= 15_000_000
  )
    return { type: "exportPng", png: m.png };
  if (
    m.type === "source" &&
    typeof m.source === "string" &&
    (validSources as string[]).includes(m.source)
  )
    return { type: "source", source: m.source as Source };
  if (m.type === "options")
    return { type: "options", options: parseOptions(m.options) };
  if ((m.type === "select" || m.type === "copy") && string(m.id))
    return { type: m.type, id: m.id };
  if (m.type === "mapping" && string(m.id) && string(m.benchmarkId))
    return { type: "mapping", id: m.id, benchmarkId: m.benchmarkId };
  if (m.type === "pin" && string(m.id) && string(m.benchmarkId) && m.benchmarkId)
    return { type: "pin", id: m.id, benchmarkId: m.benchmarkId };
  if (m.type === "unpin" && string(m.id) && string(m.benchmarkId))
    return { type: "unpin", id: m.id, benchmarkId: m.benchmarkId };
  if (m.type === "exclude" && string(m.id) && typeof m.excluded === "boolean")
    return { type: "exclude", id: m.id, excluded: m.excluded };
  if (m.type === "excludeAll" && typeof m.excluded === "boolean")
    return { type: "excludeAll", excluded: m.excluded };
  if (m.type === "profile" && m.change && typeof m.change === "object") {
    const a = m.change as Record<string, unknown>;
    let change: ProfileAction | undefined;
    if (a.action === "custom") change = { action: "custom" };
    else if (a.action === "saveAs" && string(a.name))
      change = { action: a.action, name: a.name };
    else if (a.action === "rename" && string(a.id) && string(a.name))
      change = { action: a.action, id: a.id, name: a.name };
    else if (
      (a.action === "update" ||
        a.action === "delete" ||
        a.action === "apply") &&
      string(a.id)
    )
      change = { action: a.action, id: a.id };
    if (change) return { type: "profile", change };
  }
  throw new Error("Invalid action.");
}
