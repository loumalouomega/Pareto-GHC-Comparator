import type { ByokEntry, ByokStore, Rates } from "./types";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const money = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const keyPattern = /^opencode:[A-Za-z0-9][\w\-.]*\/[\w][\w\-.#]*$/;
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
function entryOf(v: unknown): ByokEntry {
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
  return { rates, long: { threshold: v.long.threshold, rates: ratesOf(v.long.rates) } };
}
export function parseByokStore(raw: unknown): ByokStore {
  if (!object(raw)) throw new Error("Invalid BYOK rate table.");
  const keys = Object.keys(raw);
  if (keys.length > 1000) throw new Error("Too many BYOK entries.");
  const out: ByokStore = {};
  for (const k of keys) {
    if (k.length > 300 || !keyPattern.test(k))
      throw new Error(`Invalid BYOK model id: ${k.slice(0, 80)}.`);
    out[k] = entryOf(raw[k]);
  }
  return out;
}
export function loadByokStore(raw: unknown): ByokStore {
  try {
    return parseByokStore(raw);
  } catch {
    return {};
  }
}
