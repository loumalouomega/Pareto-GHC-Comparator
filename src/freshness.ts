import type { PricingInfo } from "./types";
const staleAfterMs = 90 * 86400000;
export function freshnessAlert(
  catalogDate: string,
  staticRegistryDate: string,
  now: number = Date.now(),
  planRegistryDate?: string,
): string | null {
  const dates = [catalogDate, staticRegistryDate, ...(planRegistryDate === undefined ? [] : [planRegistryDate])];
  const times = dates.map((d) => Date.parse(d));
  if (times.some((t) => !Number.isFinite(t)))
    return "Pricing dates are unavailable; rates may be stale (see docs/catalog.md).";
  const oldest = Math.min(...times);
  if (now - oldest <= staleAfterMs) return null;
  const days = Math.round((now - oldest) / 86400000);
  const plans = planRegistryDate === undefined ? "" : `, plans ${planRegistryDate}`;
  return `Pricing is ${days} days old (catalog ${catalogDate}, registries ${staticRegistryDate}${plans}); rates may be stale (see docs/catalog.md).`;
}
/**
 * A single row's own pricing-source date and whether it is stale by the same
 * 90-day threshold as the catalog-wide alert. Only rows with a real source
 * date participate: live OpenCode CLI rates, free-tier zeros, manual BYOK
 * rates, and unresolved/cross-unit rows carry no date and are never flagged.
 * An unparseable date is reported without a flag, never as fresh.
 */
export function pricingAge(
  pricing: PricingInfo,
  catalogDate: string,
  staticRegistryDate: string,
  now: number = Date.now(),
): { date: string | null; stale: boolean; daysOld: number | null } {
  let date: string | null = null;
  if (pricing.status === "priced") {
    if (
      pricing.source === "copilot-catalog" ||
      pricing.source === "legacy-multiplier"
    )
      date = catalogDate;
    else if (pricing.source === "static-registry") date = staticRegistryDate;
    // opencode-cli: live rate, no source date.
  } else if (
    pricing.status === "byok" &&
    pricing.byok?.provenance.kind === "registry"
  ) {
    date = pricing.byok.provenance.registryDate;
  }
  if (date === null) return { date: null, stale: false, daysOld: null };
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return { date, stale: false, daysOld: null };
  const daysOld = Math.round((now - time) / 86400000);
  return { date, stale: now - time > staleAfterMs, daysOld };
}
