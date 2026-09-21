// Pure, webview-safe (no Node imports). Dated, sourced plan registry and
// what-if monthly spending projections. Every figure carries provenance
// (provider-verified, user input, observed history, or displayed estimate);
// projections are never bills. Undocumented values stay null and plans without
// verified rules are unavailable rather than approximated. See docs/billing.md.
import { sources } from "./sources";
import { costUnit } from "./types";
import type {
  Billing,
  Options,
  Row,
  ScenarioBoundary,
  ScenarioHistory,
  ScenarioPrefill,
  ScenarioProvenance,
  ScenarioResult,
  ScenarioSettings,
  Source,
  UsageSummary,
} from "./types";

export const planRegistryDate = "2026-09-14";
export const planSources = {
  plans: "https://docs.github.com/en/copilot/get-started/plans",
  individualBilling:
    "https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing",
  modelsPricing:
    "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing",
  flex: "https://github.blog/news-insights/company-news/github-copilot-individual-plans-introducing-flex-allotments-in-pro-and-pro-and-a-new-max-plan/",
  organizations:
    "https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises",
  legacyRequests:
    "https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/copilot-requests",
  opencodeGo: "https://opencode.ai/docs/go",
} as const;

export type PlanUnit = "ai-credits" | "premium-requests" | "billing-unit";
export interface PlanEntry {
  id: string;
  label: string;
  unit: PlanUnit;
  /** Null when the fee is not documented. */
  monthlyFeeUsd: number | null;
  feeBasis: "account" | "seat" | null;
  baseAllowance: number | null;
  legacyAllowance?: { pro: number; proPlus: number };
  /** Null when the plan publishes no flex allotment. */
  flexAllowance: number | null;
  flexVariable: boolean;
  overageUsdPerUnit: number | null;
  overageRequiresBudget: boolean;
  pooled: boolean;
  source: Source;
  billing: Billing[];
  sources: string[];
  availability: { status: "available" } | { status: "unavailable"; reason: string };
}

const creditPlan = (
  id: string,
  label: string,
  fee: number,
  feeBasis: "account" | "seat",
  base: number,
  flex: number | null,
  pooled: boolean,
): PlanEntry => ({
  id,
  label,
  unit: "ai-credits",
  monthlyFeeUsd: fee,
  feeBasis,
  baseAllowance: base,
  flexAllowance: flex,
  flexVariable: flex !== null,
  overageUsdPerUnit: 0.01,
  overageRequiresBudget: true,
  pooled,
  source: "copilot",
  billing: ["credits"],
  sources: pooled
    ? [planSources.plans, planSources.organizations, planSources.modelsPricing]
    : [
        planSources.plans,
        planSources.individualBilling,
        planSources.flex,
        planSources.modelsPricing,
      ],
  availability: { status: "available" },
});
const unavailablePlan = (
  id: string,
  label: string,
  source: Source,
  reason: string,
  url: string,
): PlanEntry => ({
  id,
  label,
  unit: "ai-credits",
  monthlyFeeUsd: null,
  feeBasis: null,
  baseAllowance: null,
  flexAllowance: null,
  flexVariable: false,
  overageUsdPerUnit: null,
  overageRequiresBudget: false,
  pooled: false,
  source,
  billing: [],
  sources: [url],
  availability: { status: "unavailable", reason },
});

export const planRegistry: readonly PlanEntry[] = [
  creditPlan("copilot-pro", "Copilot Pro", 10, "account", 1000, 500, false),
  creditPlan("copilot-pro-plus", "Copilot Pro+", 39, "account", 3900, 3100, false),
  creditPlan("copilot-max", "Copilot Max", 100, "account", 10000, 10000, false),
  creditPlan("copilot-business", "Copilot Business", 19, "seat", 1900, null, true),
  creditPlan("copilot-enterprise", "Copilot Enterprise", 39, "seat", 3900, null, true),
  {
    id: "copilot-legacy-annual",
    label: "Copilot Pro / Pro+ annual (legacy premium requests)",
    unit: "premium-requests",
    monthlyFeeUsd: null,
    feeBasis: null,
    baseAllowance: null,
    legacyAllowance: { pro: 300, proPlus: 1500 },
    flexAllowance: null,
    flexVariable: false,
    overageUsdPerUnit: 0.04,
    overageRequiresBudget: true,
    pooled: false,
    source: "copilot",
    billing: ["legacy"],
    sources: [planSources.legacyRequests],
    availability: { status: "available" },
  },
  unavailablePlan(
    "copilot-free",
    "Copilot Free",
    "copilot",
    "Copilot Free is documented as having an allowance of AI credits, but no amount is published.",
    planSources.plans,
  ),
  unavailablePlan(
    "copilot-student",
    "Copilot Student",
    "copilot",
    "Copilot Student is documented as having an allowance of AI credits, but no amount is published.",
    planSources.plans,
  ),
  unavailablePlan(
    "opencode-go",
    "OpenCode Go",
    "opencode",
    "OpenCode Go uses per-model dollar limits over 5-hour, weekly, and monthly windows, not a monthly allowance this projection can model.",
    planSources.opencodeGo,
  ),
  {
    id: "custom",
    label: "Custom plan",
    unit: "billing-unit",
    monthlyFeeUsd: null,
    feeBasis: "account",
    baseAllowance: null,
    flexAllowance: null,
    flexVariable: false,
    overageUsdPerUnit: null,
    overageRequiresBudget: false,
    pooled: false,
    source: "copilot",
    billing: ["credits", "legacy"],
    sources: [],
    availability: { status: "available" },
  },
];

const billingUnit = costUnit;
const billingLabel = (billing: Billing) =>
  billing === "credits"
    ? "AI credits"
    : billing === "legacy"
      ? "Legacy premium requests"
      : "USD";

/** Why a plan can't project for this option, or undefined when it can. */
function mismatch(
  entry: PlanEntry,
  source: Source,
  billing: Billing,
): string | undefined {
  if (entry.availability.status === "unavailable")
    return entry.availability.reason;
  if (entry.id === "custom")
    return billing === "credits" || billing === "legacy"
      ? undefined
      : "Custom plans project AI credits or premium requests; USD billing has no plan allowance unit.";
  if (entry.source !== source)
    return `${entry.label} applies to ${sources[entry.source].label} only.`;
  if (!entry.billing.includes(billing))
    return `${entry.label} projects ${billingUnit(entry.billing[0])}; switch Billing to ${billingLabel(entry.billing[0])}.`;
  return undefined;
}

export interface PlanChoice {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
}
/**
 * Plan choices for one option. Plans for other sources are omitted; a source
 * without verified plan rules gets a single disabled entry explaining why.
 */
export function plansFor(
  source: Source,
  billing: Billing,
  registry: readonly PlanEntry[] = planRegistry,
  registryDate: string = planRegistryDate,
): PlanChoice[] {
  const own = registry.filter((e) => e.source === source && e.id !== "custom");
  const choices: PlanChoice[] = own.length
    ? own.map((e) => {
        const reason = mismatch(e, source, billing);
        return { id: e.id, label: e.label, available: !reason, ...(reason ? { reason } : {}) };
      })
    : [
        {
          id: `${source}-plans`,
          label: `${sources[source].label} plans`,
          available: false,
          reason: `No verified billing rules for ${sources[source].label} plans in the plan registry dated ${registryDate}.`,
        },
      ];
  const custom = registry.find((e) => e.id === "custom");
  if (custom) {
    const reason = mismatch(custom, source, billing);
    choices.push({ id: custom.id, label: custom.label, available: !reason, ...(reason ? { reason } : {}) });
  }
  return choices;
}

const r = (x: number) => Math.round(x * 1e6) / 1e6;
export const scenarioDisclaimer =
  "Projection from your inputs and published plan rules — not a bill, an account balance, or measured task cost.";

export interface ScenarioInput {
  scenario: ScenarioSettings;
  options: Pick<Options, "source" | "billing" | "plan" | "display">;
  row: Row | undefined;
  rowOrigin: "selected" | "recommended" | "first-comparable";
  catalogDate: string;
  registry?: readonly PlanEntry[];
  registryDate?: string;
}

export function projectScenario(input: ScenarioInput): ScenarioResult {
  const { scenario, options, row, rowOrigin, catalogDate } = input;
  const registry = input.registry ?? planRegistry;
  const registryDate = input.registryDate ?? planRegistryDate;
  if (scenario.planId === "none") return { status: "off" };
  const entry = registry.find((e) => e.id === scenario.planId);
  const unavailable = (label: string, reason: string, notes: string[] = []) =>
    ({
      status: "unavailable",
      planId: scenario.planId,
      label,
      reason,
      notes,
      disclaimer: scenarioDisclaimer,
    }) as const;
  if (!entry)
    return unavailable(
      scenario.planId,
      `Plan "${scenario.planId}" is not in the plan registry dated ${registryDate}.`,
    );
  const reason = mismatch(entry, options.source, options.billing);
  if (reason) return unavailable(entry.label, reason);
  const custom = entry.id === "custom";
  if (
    custom &&
    (scenario.custom.monthlyFeeUsd === null ||
      scenario.custom.allowance === null ||
      scenario.custom.overageUsdPerUnit === null)
  )
    return unavailable(
      entry.label,
      "Enter the custom plan's monthly fee, included allowance, and overage rate.",
    );
  if (scenario.requestsLow > scenario.requestsHigh)
    return unavailable(entry.label, "The low request estimate exceeds the high estimate.");
  const unit = billingUnit(options.billing) as "AI credits" | "premium requests";
  if (!row)
    return unavailable(
      entry.label,
      "No priced model selected. Select a model to use its per-request estimate.",
    );
  if (row.cost === null || !Number.isFinite(row.cost))
    return unavailable(
      entry.label,
      `${row.name} has no ${unit} estimate${row.reasons.length ? `: ${row.reasons.join(" ")}` : "."}`,
    );

  const legacy = options.billing === "legacy";
  const basis = legacy ? "legacy-multiplier" : options.display.chart;
  const provider: ScenarioProvenance = {
    kind: "provider",
    date: registryDate,
    sources: [...entry.sources],
  };
  const planProvenance: ScenarioProvenance = custom ? { kind: "user" } : provider;
  const base = custom
    ? scenario.custom.allowance!
    : legacy && entry.legacyAllowance
      ? entry.legacyAllowance[options.plan]
      : (entry.baseAllowance ?? 0);
  const flex = custom ? 0 : (entry.flexAllowance ?? 0);
  const rate = custom ? scenario.custom.overageUsdPerUnit! : entry.overageUsdPerUnit;
  const fee = custom ? scenario.custom.monthlyFeeUsd! : entry.monthlyFeeUsd;
  const perRequest = row.cost;
  const usage = {
    low: r(scenario.requestsLow * perRequest),
    high: r(scenario.requestsHigh * perRequest),
  };
  const allowanceHigh = r(base + flex);
  // Conservative per end: the low bound assumes the full allowance (base +
  // flex), the high bound assumes base only, since flex may change.
  const overageUnits = {
    low: r(Math.max(0, usage.low - allowanceHigh)),
    high: r(Math.max(0, usage.high - base)),
  };
  const overageUsd =
    rate === null
      ? null
      : {
          low: r(overageUnits.low * rate),
          high: r(overageUnits.high * rate),
          provenance: planProvenance,
        };
  // The fee is counted exactly once and never scaled by usage; included
  // usage is never converted to USD.
  const totalUsd =
    fee === null || overageUsd === null
      ? null
      : { low: r(fee + overageUsd.low), high: r(fee + overageUsd.high) };
  const boundaryOf = (u: number): ScenarioBoundary =>
    u <= base ? "within-base" : u <= allowanceHigh ? "within-flex" : "over-allowance";
  const history: ScenarioHistory | null =
    scenario.origin === "history" ? scenario.history : null;

  const notes: string[] = [];
  if (custom) notes.push("Custom plan values are your own inputs and are not verified.");
  if (entry.unit === "ai-credits") {
    notes.push(
      "Code completions and next edit suggestions do not consume AI credits and are not included.",
      "Included credits reset at 00:00 UTC on the 1st of each month; unused credits do not roll over.",
    );
  }
  if (entry.overageRequiresBudget)
    notes.push(
      "Usage beyond the allowance is billed only when an additional-usage budget is set; without one, those requests are unavailable, and a budget may cap spending.",
    );
  if (flex > 0)
    notes.push(
      `Base credits are used first, then the flex allotment. Flex allotments may change (published ${registryDate}), so the allowance is shown from base only (low) to base + flex (high).`,
    );
  if (entry.pooled)
    notes.push(
      "Included credits are pooled across the billing entity, so this per-user projection is approximate; the organization pays the seat fee, and additional usage depends on admin policy.",
    );
  if (legacy && !custom)
    notes.push(
      "Legacy request-based billing ends when the annual plan ends; the account then moves to Copilot Free.",
      "Uses manual model selection multipliers; the 10% Auto model selection discount is not applied.",
      "The annual plan fee is not documented, so no monthly total is shown; use a Custom plan to include a fee.",
    );
  if (basis === "task")
    notes.push(
      "Per-request cost uses the fixed 1,000 input + 1,000 output task proxy, not a measured request; switch the chart view to workload and use Use my average for a history-based estimate.",
    );
  else if (basis === "workload")
    notes.push("Per-request cost treats the editable token workload as one request.");
  if (rowOrigin !== "selected")
    notes.push(
      `Uses ${row.name}, the ${rowOrigin === "recommended" ? "recommended" : "first comparable"} model, because no model is selected.`,
    );
  if (history)
    notes.push(
      "Requests come from local history across all Copilot models, priced as if every request used the selected model.",
    );
  if (perRequest === 0)
    notes.push("The selected model costs 0 per request in this estimate.");

  return {
    status: "projected",
    plan: {
      id: entry.id,
      label: entry.label,
      unit,
      registryDate: custom ? null : registryDate,
    },
    row: { id: row.id, name: row.name, origin: rowOrigin },
    perRequest: {
      value: perRequest,
      provenance: { kind: "estimate", basis, catalogDate },
    },
    requests: {
      low: scenario.requestsLow,
      high: scenario.requestsHigh,
      provenance: history ? { kind: "history", ...history } : { kind: "user" },
    },
    usage,
    allowance: {
      low: base,
      high: allowanceHigh,
      provenance: planProvenance,
      flexVariable: !custom && entry.flexVariable,
    },
    overageUnits,
    overageUsd,
    feeUsd: {
      value: fee,
      basis: fee === null ? null : entry.feeBasis,
      provenance: fee === null ? null : planProvenance,
    },
    totalUsd,
    boundary: { low: boundaryOf(usage.low), high: boundaryOf(usage.high) },
    notes,
    disclaimer: scenarioDisclaimer,
  };
}

/**
 * Request range from local history: high = requests per active day × 30,
 * low = requests per calendar day in the dated window × 30. Undated requests
 * are excluded and counted.
 */
export function historyScenarioPrefill(
  summary: Pick<UsageSummary, "days" | "requestCount"> | null,
): ScenarioPrefill | null {
  if (!summary) return null;
  const active = summary.days.filter((d) => d.requests > 0);
  if (!active.length) return null;
  const dates = active.map((d) => d.date).sort();
  const from = dates[0],
    to = dates[dates.length - 1];
  const requests = active.reduce((sum, d) => sum + d.requests, 0);
  const calendarDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return {
    low: Math.round((requests / calendarDays) * 30),
    high: Math.round((requests / active.length) * 30),
    from,
    to,
    activeDays: active.length,
    calendarDays,
    requests,
    undated: Math.max(0, summary.requestCount - requests),
  };
}

/** B minus A of the projected monthly total range ends, only when comparable. */
export function scenarioDelta(
  a: ScenarioResult | undefined,
  b: ScenarioResult | undefined,
): { low: number | null; high: number | null; reason: string } {
  const none = (reason: string) => ({ low: null, high: null, reason });
  if (a?.status !== "projected" || b?.status !== "projected")
    return none("Scenario off or unavailable on at least one option.");
  if (a.plan.unit !== b.plan.unit) return none("Different scenario units.");
  if (!a.totalUsd || !b.totalUsd)
    return none("Monthly total unavailable (plan fee not documented).");
  return {
    low: r(b.totalUsd.low - a.totalUsd.low),
    high: r(b.totalUsd.high - a.totalUsd.high),
    reason: "Difference of range ends (low − low, high − high), not a bound.",
  };
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const count = (v: unknown, max: number): number | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : undefined;
const amount = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Tolerant parse: invalid fields fall back to defaults one at a time, an
 * unknown but well-formed plan id is kept (shown as unavailable, never
 * substituted), and keys are emitted in a fixed order.
 */
export function parseScenario(raw: unknown): ScenarioSettings {
  const v = record(raw) ? raw : {};
  const planId =
    typeof v.planId === "string" && /^[a-z0-9][a-z0-9-]{0,59}$/.test(v.planId)
      ? v.planId
      : "none";
  const h = record(v.history) ? v.history : undefined;
  const activeDays = h ? count(h.activeDays, 100000) : undefined;
  const calendarDays = h ? count(h.calendarDays, 100000) : undefined;
  const requests = h ? count(h.requests, 1e9) : undefined;
  const history: ScenarioHistory | null =
    h &&
    typeof h.from === "string" &&
    datePattern.test(h.from) &&
    typeof h.to === "string" &&
    datePattern.test(h.to) &&
    activeDays !== undefined &&
    calendarDays !== undefined &&
    requests !== undefined
      ? { from: h.from, to: h.to, activeDays, calendarDays, requests }
      : null;
  const c = record(v.custom) ? v.custom : {};
  return {
    planId,
    requestsLow: count(v.requestsLow, 10000000) ?? 0,
    requestsHigh: count(v.requestsHigh, 10000000) ?? 0,
    origin: v.origin === "history" && history ? "history" : "user",
    history: v.origin === "history" ? history : null,
    custom: {
      monthlyFeeUsd: amount(c.monthlyFeeUsd, 1000000),
      allowance: amount(c.allowance, 1000000000),
      overageUsdPerUnit: amount(c.overageUsdPerUnit, 1000000),
    },
  };
}
