import type { Options, Row } from "./types";

function cell(value: string): string {
  return /[",\n\r]/.test(value) || /^(=|\+|-|@)/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function exportCsv(
  rows: Row[],
  options: Options,
  recommended: Set<string> = new Set(),
): string {
  const header = [
    "model",
    "model_id",
    "provider",
    "tested_variant",
    "benchmark_id",
    "score",
    "score_preset",
    "cost",
    "cost_unit",
    "cost_tier",
    "frontier",
    "recommended",
    "mapping_status",
    "reasons",
  ];
  const unit =
    options.billing === "credits"
      ? "AI credits"
      : options.billing === "legacy"
        ? "premium requests"
        : "USD";
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.id,
        r.provider,
        r.benchmark?.name ?? "",
        r.benchmark?.id ?? "",
        r.score === null ? "" : String(r.score),
        options.preset,
        r.cost === null ? "" : String(r.cost),
        unit,
        r.tier ?? "",
        r.frontier ? "yes" : "no",
        recommended.has(r.id) ? "yes" : "no",
        r.mappingStatus,
        r.reasons.join(" "),
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
