import type { Row } from "./types";
export function efficiencyOf(row: Row): number | null {
  if (
    row.cost === null ||
    row.score === null ||
    !Number.isFinite(row.cost) ||
    !Number.isFinite(row.score) ||
    row.score <= 0 ||
    row.cost < 0
  )
    return null;
  return row.cost / row.score;
}
export function sortRowsByEfficiency(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const ea = efficiencyOf(a),
      eb = efficiencyOf(b);
    if (ea === null && eb === null)
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    if (ea === null) return 1;
    if (eb === null) return -1;
    return ea - eb || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
