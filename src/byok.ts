import type { ByokEntry, ByokProvenance, ByokStore, Rates } from "./types";
import { isStaticSource } from "./staticSources";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const money = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const keyPattern = /^opencode:[A-Za-z0-9][\w\-.]*\/[\w][\w\-.#]*$/;
const registryIdPattern = /^[a-z0-9][a-z0-9:_.-]{0,199}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function ratesOf(v: unknown): Rates {
  if (
    !object(v) ||
    !money(v.input) ||
    !money(v.read) ||
    !(v.write === null || money(v.write)) ||
    !money(v.output)
  )
    throw new Error(
      "BYOK rates need nonnegative input, read, output and null-or-nonnegative write rates.",
    );
  return {
    input: v.input,
    read: v.read,
    write: v.write ?? null,
    output: v.output,
  };
}
/** Strict: throws on any invalid `source`. Used by parseByokStore only. */
function provenanceOf(v: unknown): ByokProvenance {
  if (v === undefined) return { kind: "manual" };
  if (!object(v)) throw new Error("Invalid BYOK provenance.");
  if (v.kind === "manual") return { kind: "manual" };
  if (
    v.kind === "registry" &&
    typeof v.registry === "string" &&
    isStaticSource(v.registry) &&
    typeof v.registryId === "string" &&
    registryIdPattern.test(v.registryId) &&
    typeof v.registryDate === "string" &&
    datePattern.test(v.registryDate)
  )
    return {
      kind: "registry",
      registry: v.registry,
      registryId: v.registryId,
      registryDate: v.registryDate,
    };
  throw new Error("Invalid BYOK provenance.");
}
/** Rates and optional long-context tier only; throws on any invalid shape. */
function entryFieldsOf(
  v: unknown,
): { rates: Rates; long?: { threshold: number; rates: Rates } } {
  if (!object(v)) throw new Error("Invalid BYOK entry.");
  const rates = ratesOf(v.rates);
  if (v.long === undefined) return { rates };
  if (
    !object(v.long) ||
    typeof v.long.threshold !== "number" ||
    !Number.isSafeInteger(v.long.threshold) ||
    v.long.threshold <= 0
  )
    throw new Error("BYOK long-context entries need a positive threshold.");
  return {
    rates,
    long: { threshold: v.long.threshold, rates: ratesOf(v.long.rates) },
  };
}
/**
 * Strict validator: throws on any invalid entry, including a malformed
 * `source`. A missing `source` becomes manual (the migration for entries
 * saved before provenance existed).
 */
export function parseByokStore(raw: unknown): ByokStore {
  if (!object(raw)) throw new Error("Invalid BYOK rate table.");
  const keys = Object.keys(raw);
  if (keys.length > 1000) throw new Error("Too many BYOK entries.");
  const out: ByokStore = {};
  for (const k of keys) {
    if (k.length > 300 || !keyPattern.test(k))
      throw new Error(`Invalid BYOK model id: ${k.slice(0, 80)}.`);
    const v = raw[k];
    out[k] = {
      ...entryFieldsOf(v),
      source: provenanceOf(object(v) ? v.source : undefined),
    };
  }
  return out;
}
/**
 * Validator for the webview's whole-store BYOK form message: rates/long are
 * still strict, but any `source` the webview sends is ignored outright and
 * every entry becomes manual. Registry provenance can only be created by the
 * host, via `byokApply` in src/extension.ts using a verified registry rate
 * from src/assist.ts — never by replaying this message.
 */
export function parseByokFormStore(raw: unknown): ByokStore {
  if (!object(raw)) throw new Error("Invalid BYOK rate table.");
  const keys = Object.keys(raw);
  if (keys.length > 1000) throw new Error("Too many BYOK entries.");
  const out: ByokStore = {};
  for (const k of keys) {
    if (k.length > 300 || !keyPattern.test(k))
      throw new Error(`Invalid BYOK model id: ${k.slice(0, 80)}.`);
    out[k] = { ...entryFieldsOf(raw[k]), source: { kind: "manual" } };
  }
  return out;
}
/**
 * Tolerant loader for stored global state: an entry with invalid rates/long
 * is dropped individually (never discards the whole store), and an invalid
 * `source` alone resets just that entry to manual instead of dropping it.
 */
export function loadByokStore(raw: unknown): ByokStore {
  if (!object(raw)) return {};
  const out: ByokStore = {};
  let count = 0;
  for (const k of Object.keys(raw)) {
    if (count >= 1000) break;
    if (k.length > 300 || !keyPattern.test(k)) continue;
    const v = raw[k];
    let fields: { rates: Rates; long?: { threshold: number; rates: Rates } };
    try {
      fields = entryFieldsOf(v);
    } catch {
      continue;
    }
    let source: ByokProvenance;
    try {
      source = provenanceOf(object(v) ? v.source : undefined);
    } catch {
      source = { kind: "manual" };
    }
    out[k] = { ...fields, source };
    count++;
  }
  return out;
}
function ratesEqual(a: Rates, b: Rates): boolean {
  return a.input === b.input && a.read === b.read && a.write === b.write && a.output === b.output;
}
function longEqual(
  a: { threshold: number; rates: Rates } | undefined,
  b: { threshold: number; rates: Rates } | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.threshold === b.threshold && ratesEqual(a.rates, b.rates);
}
/**
 * Merges validated form entries (always manual provenance) into the stored
 * BYOK store: an entry whose rates and long tier are unchanged keeps its
 * prior provenance (so re-saving the form without editing a registry-applied
 * rate doesn't silently relabel it manual); any actual edit downgrades it.
 */
export function mergeByokForm(prev: ByokStore, incoming: ByokStore): ByokStore {
  const out: ByokStore = {};
  for (const [id, entry] of Object.entries(incoming)) {
    const prior = prev[id];
    const unchanged =
      prior?.source?.kind === "registry" &&
      ratesEqual(prior.rates, entry.rates) &&
      longEqual(prior.long, entry.long);
    out[id] = unchanged ? { ...entry, source: prior!.source } : entry;
  }
  return out;
}
