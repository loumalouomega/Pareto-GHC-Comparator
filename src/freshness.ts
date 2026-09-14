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
