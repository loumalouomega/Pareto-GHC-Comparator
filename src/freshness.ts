const staleAfterMs = 90 * 86400000;
export function freshnessAlert(
  catalogDate: string,
  staticRegistryDate: string,
  now: number = Date.now(),
): string | null {
  const catalogTime = Date.parse(catalogDate),
    registryTime = Date.parse(staticRegistryDate);
  if (!Number.isFinite(catalogTime) || !Number.isFinite(registryTime))
    return "Pricing dates are unavailable; rates may be stale (see docs/catalog.md).";
  const oldest = Math.min(catalogTime, registryTime);
  if (now - oldest <= staleAfterMs) return null;
  const days = Math.round((now - oldest) / 86400000);
  return `Pricing is ${days} days old (catalog ${catalogDate}, registries ${staticRegistryDate}); rates may be stale (see docs/catalog.md).`;
}
