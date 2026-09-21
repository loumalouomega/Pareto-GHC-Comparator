// Pure, webview-safe (no Node imports). Optional USD-equivalent conversion
// for comparison mode only. Converts AI credits at the documented $0.01/credit
// pay-as-you-go rate; USD is already USD; legacy premium requests are never
// converted, because a per-interaction multiplier is not a token-workload
// cost. See docs/billing.md.
import { planRegistryDate, planSources } from "./plans";
import { costUnit, type Billing, type ChartType, type CostUnit } from "./types";
// Re-exported so existing `normalize`-module importers keep working; the
// canonical definition lives in types.ts (a leaf module) so plans.ts can
// share it without an import cycle.
export { costUnit };
export type { CostUnit };

export const usdPerAiCredit = 0.01;
export const conversionDate = planRegistryDate;
export const conversionSources: readonly string[] = [planSources.modelsPricing];
export const allowanceTreatment =
  "Pay-as-you-go rate equivalent: included plan allowance and the monthly plan fee are not counted. Use the monthly spending scenario for allowance-aware spending.";

export const normalizeReasons = {
  legacy:
    "Legacy premium requests are never converted: a per-interaction multiplier is not a token-workload cost.",
  cost: "Cost unavailable; nothing to convert.",
} as const;

// Strip float noise (e.g. 0.07 * 0.01) without collapsing small but real USD
// task costs, unlike the 1e-6 rounding used for monthly-scenario totals.
const round = (x: number) => Math.round(x * 1e10) / 1e10;

export type NormalizedCost =
  | {
      status: "native";
      original: { value: number; unit: "USD" };
      usd: number;
      basis: ChartType;
    }
  | {
      status: "converted";
      original: { value: number; unit: "AI credits" };
      usd: number;
      rate: { usdPerUnit: number; unit: "AI credits" };
      provenance: { kind: "provider"; date: string; sources: string[] };
      allowanceTreatment: string;
      basis: ChartType;
    }
  | {
      status: "unavailable";
      original: { value: number | null; unit: CostUnit };
      reason: string;
    };

/**
 * Converts a row's displayed cost to a USD equivalent when the billing mode
 * documents one. AI credits convert at the fixed pay-as-you-go rate; USD
 * passes through unchanged; legacy premium requests never convert.
 */
export function normalizeCost(
  cost: number | null | undefined,
  billing: Billing,
  basis: ChartType,
): NormalizedCost {
  const unit = costUnit(billing);
  if (billing === "legacy")
    return {
      status: "unavailable",
      original: { value: Number.isFinite(cost) ? (cost as number) : null, unit },
      reason: normalizeReasons.legacy,
    };
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
    return {
      status: "unavailable",
      original: { value: null, unit },
      reason: normalizeReasons.cost,
    };
  if (billing === "usd")
    return {
      status: "native",
      original: { value: cost, unit: "USD" },
      usd: round(cost),
      basis,
    };
  return {
    status: "converted",
    original: { value: cost, unit: "AI credits" },
    usd: round(cost * usdPerAiCredit),
    rate: { usdPerUnit: usdPerAiCredit, unit: "AI credits" },
    provenance: { kind: "provider", date: conversionDate, sources: [...conversionSources] },
    allowanceTreatment,
    basis,
  };
}
