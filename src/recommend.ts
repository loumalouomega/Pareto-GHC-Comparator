import type { Options, RecommendationResult, Row } from "./types";
const format = (n: number) =>
  new Intl.NumberFormat("en", { maximumSignificantDigits: 6 }).format(n);
export function recommend(rows: Row[], options: Options): RecommendationResult {
  const comparable = rows.filter(
    (r): r is Row & { cost: number; score: number } =>
      r.cost !== null &&
      r.score !== null &&
      Number.isFinite(r.cost) &&
      Number.isFinite(r.score),
  );
  if (!comparable.length)
    return {
      modelIds: [],
      explanation:
        "No comparable models in the current filter. Resolve missing benchmarks or prices to get a recommendation.",
    };
  const unit =
    options.billing === "credits"
      ? "AI credits"
      : options.billing === "legacy"
        ? "premium requests"
        : "USD";
  const settings = options.recommendation;
  const threshold =
    settings.mode === "budget"
      ? settings.budgets[options.billing]
      : Math.max(...comparable.map((r) => r.score)) - settings.scoreGap;
  const eligible = comparable.filter((r) =>
    settings.mode === "budget" ? r.cost <= threshold : r.score >= threshold,
  );
  if (!eligible.length)
    return {
      modelIds: [],
      threshold,
      explanation: `No displayed model fits the budget of ${format(threshold)} ${unit}. Increase the budget or change the workload.`,
    };
  const ranked = eligible.sort((a, b) =>
    settings.mode === "budget"
      ? b.score - a.score || a.cost - b.cost
      : a.cost - b.cost || b.score - a.score,
  );
  const best = ranked[0];
  const winners = ranked.filter(
    (r) => r.cost === best.cost && r.score === best.score,
  );
  const rule =
    settings.mode === "budget"
      ? `Highest score within ${format(threshold)} ${unit}; lower cost breaks score ties.`
      : `Lowest cost with a score of at least ${format(threshold)} (best displayed score minus ${format(settings.scoreGap)} points); higher score breaks cost ties.`;
  return {
    modelIds: winners.map((r) => r.id),
    threshold,
    explanation: `${winners.map((r) => r.name).join(", ")}: ${format(best.score)} index points at ${format(best.cost)} ${unit}. ${rule}${winners.length > 1 ? " Exact ties are retained." : ""}`,
  };
}
