export function workspaceLabel(path: string, id: string, full: boolean): string {
  if (!path) return `${id} · unmapped workspace (no readable workspace.json)`;
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
