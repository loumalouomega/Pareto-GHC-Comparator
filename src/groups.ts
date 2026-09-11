import { baseModelIdOf } from "./compare";
import type { AvailableModel, Row } from "./types";

export type CheckState = "checked" | "unchecked" | "mixed";

export interface ThinkingLeaf {
  /** Available-model id (exclusion key). */
  id: string;
  name: string;
  /** Variant/thinking label, e.g. "low", "high", or "Standard". */
  thinking: string;
  included: boolean;
  rowCount: number;
}

export interface ModelGroup {
  /** Stable model key (variant suffix stripped). */
  id: string;
  name: string;
  provider: string;
  state: CheckState;
  includedCount: number;
  totalCount: number;
  leaves: ThinkingLeaf[];
}

export interface FamilyGroup {
  id: string;
  name: string;
  state: CheckState;
  includedCount: number;
  totalCount: number;
  models: ModelGroup[];
}

const checkState = (included: number, total: number): CheckState =>
  included === 0 ? "unchecked" : included === total ? "checked" : "mixed";

/** Extract the thinking/variant label from an OpenCode `#variant` id. */
export function thinkingOf(model: AvailableModel): string {
  const hash = model.id.split("#")[1];
  if (hash && hash.length > 0 && hash.length <= 100) return hash;
  return "Standard";
}

/** Base-model display name: strip a trailing parenthetical variant. */
export function baseDisplayName(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, "").trim() || name;
}

function familyKeyOf(model: AvailableModel): string {
  const family = (model.family ?? "").trim();
  if (family) return family;
  return "Other";
}

function modelKeyOf(model: AvailableModel): string {
  return baseModelIdOf(model.id);
}

function modelNameOf(models: AvailableModel[]): string {
  const base = baseDisplayName(models[0]?.name ?? models[0]?.id ?? "Model");
  return base;
}

/**
 * Build Family → Model → Thinking groups from discovery/static availability.
 * Grouping is presentational: leaves map 1:1 to AvailableModel ids so the
 * existing per-model exclusion storage keeps working, including one leaf per
 * OpenCode `#variant` row.
 */
export function buildGroups(
  available: AvailableModel[],
  excluded: Set<string> | string[],
  rows: Row[] = [],
): FamilyGroup[] {
  const excludedSet = excluded instanceof Set ? excluded : new Set(excluded);
  const rowCounts = new Map<string, number>();
  for (const row of rows) {
    rowCounts.set(row.modelId, (rowCounts.get(row.modelId) ?? 0) + 1);
  }
  const providerOf = new Map<string, string>();
  for (const row of rows) {
    if (!providerOf.has(row.modelId)) providerOf.set(row.modelId, row.provider);
  }

  // Family key -> model key -> models.
  const families = new Map<string, Map<string, AvailableModel[]>>();
  const familyOrder: string[] = [];
  for (const model of available) {
    const family = familyKeyOf(model);
    const key = modelKeyOf(model);
    let models = families.get(family);
    if (!models) {
      models = new Map();
      families.set(family, models);
      familyOrder.push(family);
    }
    const list = models.get(key) ?? [];
    list.push(model);
    models.set(key, list);
  }

  const groups: FamilyGroup[] = [];
  for (const family of [...familyOrder].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )) {
    const modelsByKey = families.get(family)!;
    const models: ModelGroup[] = [];
    for (const [modelKey, list] of [...modelsByKey.entries()].sort((a, b) =>
      baseDisplayName(a[1][0]?.name ?? a[0]).localeCompare(
        baseDisplayName(b[1][0]?.name ?? b[0]),
        undefined,
        { sensitivity: "base" },
      ),
    )) {
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
      const leaves: ThinkingLeaf[] = sorted.map((m) => ({
        id: m.id,
        name: m.name,
        thinking: thinkingOf(m),
        included: !excludedSet.has(m.id),
        rowCount: rowCounts.get(m.id) ?? 0,
      }));
      const includedCount = leaves.filter((l) => l.included).length;
      const provider =
        providerOf.get(sorted[0]?.id ?? "") ?? "Unknown";
      models.push({
        id: `${family}::${modelKey}`,
        name: modelNameOf(sorted),
        provider,
        state: checkState(includedCount, leaves.length),
        includedCount,
        totalCount: leaves.length,
        leaves,
      });
    }
    const allLeaves = models.flatMap((m) => m.leaves);
    const includedCount = allLeaves.filter((l) => l.included).length;
    const display =
      family === "Other" ? "Other" : family;
    groups.push({
      id: family,
      name: display,
      state: checkState(includedCount, allLeaves.length),
      includedCount,
      totalCount: allLeaves.length,
      models,
    });
  }
  return groups;
}

/** All leaf ids under a family (for single-message bulk updates). */
export function leafIdsForFamily(
  groups: FamilyGroup[],
  familyId: string,
): string[] {
  const family = groups.find((g) => g.id === familyId);
  if (!family) return [];
  return family.models.flatMap((m) => m.leaves.map((l) => l.id));
}

/** All leaf ids under a model group. */
export function leafIdsForModel(
  groups: FamilyGroup[],
  modelId: string,
): string[] {
  for (const family of groups) {
    const model = family.models.find((m) => m.id === modelId);
    if (model) return model.leaves.map((l) => l.id);
  }
  return [];
}

/** Filter groups by a free-text query, keeping matching families/models. */
export function filterGroups(
  groups: FamilyGroup[],
  query: string,
): FamilyGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out: FamilyGroup[] = [];
  for (const family of groups) {
    const familyHit = family.name.toLowerCase().includes(q);
    const models: ModelGroup[] = [];
    for (const model of family.models) {
      const modelHit =
        model.name.toLowerCase().includes(q) ||
        model.provider.toLowerCase().includes(q);
      const leaves = model.leaves.filter(
        (l) =>
          familyHit ||
          modelHit ||
          l.name.toLowerCase().includes(q) ||
          l.thinking.toLowerCase().includes(q) ||
          l.id.toLowerCase().includes(q),
      );
      if (familyHit || modelHit || leaves.length) {
        const includedCount = leaves.filter((l) => l.included).length;
        models.push({
          ...model,
          state: modelHit || familyHit ? model.state : checkState(includedCount, leaves.length || 1),
          leaves: familyHit || modelHit ? model.leaves : leaves,
        });
      }
    }
    if (familyHit || models.length) {
      const allLeaves = models.flatMap((m) => m.leaves);
      const includedCount = allLeaves.filter((l) => l.included).length;
      out.push({
        ...family,
        state: familyHit ? family.state : checkState(includedCount, allLeaves.length || 1),
        models,
      });
    }
  }
  return out;
}
