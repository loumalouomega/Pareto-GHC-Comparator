import { randomUUID } from "node:crypto";
import { migrateOptions, parseOptions } from "./compare";
import type { Options, ProfileAction, ProfileStore, Workload } from "./types";
export function workload(options: Options): Workload {
  const { filter: _, ...values } = parseOptions(options);
  return values;
}
export function profileModified(
  store: ProfileStore,
  options: Options,
): boolean {
  const active = store.items.find((p) => p.id === store.activeId);
  return (
    !!active &&
    JSON.stringify(active.workload) !== JSON.stringify(workload(options))
  );
}
function profileName(
  name: unknown,
  store: ProfileStore,
  except?: string,
): string {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60)
    throw new Error("Profile names must contain 1–60 characters.");
  const normalized = name.trim();
  if (
    store.items.some(
      (p) =>
        p.id !== except && p.name.toLowerCase() === normalized.toLowerCase(),
    )
  )
    throw new Error("A profile with that name already exists.");
  return normalized;
}
export function loadProfiles(value: unknown): ProfileStore {
  const result: ProfileStore = { version: 1, items: [] };
  if (!value || typeof value !== "object") return result;
  const store = value as ProfileStore;
  if (store.version !== 1 || !Array.isArray(store.items)) return result;
  for (const p of store.items) {
    try {
      if (
        !p ||
        typeof p.id !== "string" ||
        !p.id ||
        result.items.some((i) => i.id === p.id)
      )
        continue;
      const name = profileName(p.name, result);
      result.items.push({
        id: p.id,
        name,
        // migrateOptions maps pre-source records to Copilot defaults while
        // parseOptions still rejects invalid records individually.
        workload: workload(
          parseOptions(migrateOptions({ ...p.workload, filter: "" })),
        ),
      });
    } catch {
      /* Ignore invalid records without discarding valid saved profiles. */
    }
  }
  if (result.items.some((p) => p.id === store.activeId))
    result.activeId = store.activeId;
  return result;
}
export function changeProfile(
  store: ProfileStore,
  options: Options,
  action: ProfileAction,
  makeId: () => string = randomUUID,
): { store: ProfileStore; options: Options } {
  const next = structuredClone(store);
  if (action.action === "custom") {
    delete next.activeId;
    return { store: next, options };
  }
  if (action.action === "saveAs") {
    const name = profileName(action.name, next),
      id = makeId();
    next.items.push({ id, name, workload: workload(options) });
    next.activeId = id;
    return { store: next, options };
  }
  const target = next.items.find((p) => p.id === action.id);
  if (!target) throw new Error("That profile no longer exists.");
  if (action.action === "apply")
    return {
      store: { ...next, activeId: target.id },
      options: parseOptions({ ...target.workload, filter: options.filter }),
    };
  if (action.action === "update") {
    target.workload = workload(options);
    next.activeId = target.id;
  } else if (action.action === "rename")
    target.name = profileName(action.name, next, target.id);
  else if (action.action === "delete") {
    next.items = next.items.filter((p) => p.id !== target.id);
    if (next.activeId === target.id) delete next.activeId;
  }
  return { store: next, options };
}
