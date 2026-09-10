import { parseOptions } from "./compare";
import type { HostMessage, ProfileAction } from "./types";
export function parseMessage(raw: unknown): HostMessage {
  if (!raw || typeof raw !== "object") throw new Error("Invalid action.");
  const m = raw as Record<string, unknown>;
  const string = (v: unknown): v is string =>
    typeof v === "string" && v.length <= 1000;
  if (m.type === "ready" || m.type === "refresh" || m.type === "key")
    return { type: m.type };
  if (m.type === "options")
    return { type: "options", options: parseOptions(m.options) };
  if ((m.type === "select" || m.type === "copy") && string(m.id))
    return { type: m.type, id: m.id };
  if (m.type === "mapping" && string(m.id) && string(m.benchmarkId))
    return { type: "mapping", id: m.id, benchmarkId: m.benchmarkId };
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
