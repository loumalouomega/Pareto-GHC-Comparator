import type { Options, Row } from "./types";
export interface SnapshotMeta {
  source: Options["source"];
  preset: Options["preset"];
  billing: Options["billing"];
  catalogDate: string;
  staticRegistryDate: string;
  version?: string;
  fetchedAt?: number;
}

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
export function exportSnapshot(
  rows: Row[],
  options: Options,
  recommended: Set<string>,
  meta: SnapshotMeta,
): string {
  return (
    JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        disclaimer:
          "Illustrative comparison from published benchmarks and catalog rates; not measured task cost or an account bill.",
        source: meta.source,
        preset: meta.preset,
        billing: meta.billing,
        catalogDate: meta.catalogDate,
        staticRegistryDate: meta.staticRegistryDate,
        benchmarkVersion: meta.version ?? null,
        benchmarkFetchedAt: meta.fetchedAt ?? null,
        rows: rows.map((r) => ({
          id: r.id,
          modelId: r.modelId,
          name: r.name,
          provider: r.provider,
          benchmark: r.benchmark
            ? { id: r.benchmark.id, name: r.benchmark.name }
            : null,
          score: r.score,
          cost: r.cost,
          tier: r.tier ?? null,
          frontier: r.frontier,
          recommended: recommended.has(r.id),
          mappingStatus: r.mappingStatus,
          reasons: r.reasons,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}
export function exportBadge(
  rows: Row[],
  options: Options,
  meta: Pick<SnapshotMeta, "source" | "preset">,
): string {
  const comparable = rows.filter(
    (r): r is Row & { cost: number; score: number } =>
      r.cost !== null &&
      r.score !== null &&
      Number.isFinite(r.cost) &&
      Number.isFinite(r.score),
  );
  const unit =
    options.billing === "credits"
      ? "AI credits"
      : options.billing === "legacy"
        ? "premium requests"
        : "USD";
  const best = comparable.length
    ? [...comparable].sort((a, b) => b.score - a.score || a.cost - b.cost)[0]
    : undefined;
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        label: `pareto ${meta.source} ${meta.preset}`,
        message: best
          ? `${best.name.slice(0, 120)}: ${best.score} pts at ${best.cost} ${unit}`
          : "no comparable models",
        color: best ? (best.frontier ? "brightgreen" : "blue") : "lightgrey",
      },
      null,
      2,
    ) + "\n"
  );
}
