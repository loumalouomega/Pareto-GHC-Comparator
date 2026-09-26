/**
 * Why a Claude Code transcript yields no workspace name: its records simply
 * carry no `cwd`. Client-specific so the cell never implies Copilot's reason,
 * and defined here rather than in `usageClaude.ts` because that module reads
 * the filesystem and the webview bundle must stay Node-free.
 */
export const claudeUnmappedWorkspace =
  "unmapped workspace (no cwd in transcript)";

/**
 * Workspace cell text. Basename per multi-root segment by default, full path on
 * toggle. `unmapped` is client-specific because the reason a workspace cannot be
 * named differs per source (Copilot has no readable `workspace.json`; a Claude
 * transcript simply carries no `cwd`), and the cell must not imply the other
 * client's reason.
 */
export function workspaceLabel(
  path: string,
  id: string,
  full: boolean,
  unmapped = "unmapped workspace (no readable workspace.json)",
): string {
  if (!path) return `${id} · ${unmapped}`;
  if (full) return path;
  const short = path
    .split(";")
    .map((part) => {
      const segments = part.trim().split(/[/\\]/).filter(Boolean);
      return segments.length ? segments[segments.length - 1] : part.trim();
    })
    .filter(Boolean)
    .join("; ");
  return short || id;
}
