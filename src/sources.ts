import type { Billing, Source } from "./types";

export interface SourceMeta {
  id: Source;
  label: string;
  eyebrow: string;
  subtitle: string;
  billing: Billing[];
  live: boolean;
  availabilityNote: string;
  pricingLabel: string;
  pricingUrl: string;
  pricingNote: string;
}

export const sourceOrder: Source[] = [
  "copilot",
  "opencode",
  "claude-code",
  "codex",
  "gemini-cli",
  "cursor",
  "windsurf",
  "aider",
  "amazon-q",
];

export const sources: Record<Source, SourceMeta> = {
  copilot: {
    id: "copilot",
    label: "GitHub Copilot",
    eyebrow: "PARETO / GITHUB COPILOT",
    subtitle:
      "Compare benchmark quality with estimated Copilot usage. Better value is toward the upper left.",
    billing: ["credits", "legacy"],
    live: true,
    availabilityNote: "Live discovery via the Copilot chat-model API.",
    pricingLabel: "Copilot pricing: GitHub Docs",
    pricingUrl:
      "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing",
    pricingNote:
      "Benchmark results describe the tested variant, not guaranteed performance in Copilot. Pricing updates ship with extension releases.",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    eyebrow: "PARETO / OPENCODE",
    subtitle:
      "Compare benchmark quality with estimated OpenCode USD cost. Better value is toward the upper left.",
    billing: ["usd"],
    live: true,
    availabilityNote: "Live discovery via `opencode models --verbose`.",
    pricingLabel: "OpenCode pricing: Zen pricing",
    pricingUrl: "https://opencode.ai/docs/zen",
    pricingNote:
      "Benchmark results describe the tested variant, not guaranteed performance with OpenCode's configuration. USD rates come from OpenCode CLI discovery.",
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    eyebrow: "PARETO / CLAUDE CODE",
    subtitle:
      "Compare known Claude Code models with illustrative USD estimates. Better value is toward the upper left.",
    billing: ["usd"],
    live: false,
    availabilityNote:
      "Known Anthropic modelsroutable through Claude Code; not your account availability.",
    pricingLabel: "Anthropic pricing: API pricing",
    pricingUrl: "https://www.anthropic.com/pricing",
    pricingNote:
      "Known-model registry, no connection required. Costs use published API-equivalent USD rates as an illustrative estimate; subscription billing may differ.",
  },
  codex: {
    id: "codex",
    label: "Codex",
    eyebrow: "PARETO / CODEX",
    subtitle:
      "Compare known Codex models with illustrative USD estimates. Better value is toward the upper left.",
    billing: ["usd"],
    live: false,
    availabilityNote:
      "Known OpenAI models routable through Codex; not your account availability.",
    pricingLabel: "OpenAI pricing: API pricing",
    pricingUrl: "https://openai.com/api/pricing",
    pricingNote:
      "Known-model registry, no connection required. Costs use published API-equivalent USD rates as an illustrative estimate; subscription billing may differ.",
  },
  "gemini-cli": {
    id: "gemini-cli",
    label: "Gemini CLI",
    eyebrow: "PARETO / GEMINI CLI",
    subtitle:
      "Compare known Gemini CLI models with illustrative USD estimates. Better value is toward the upper left.",
    billing: ["usd"],
    live: false,
    availabilityNote:
      "Known Google models routable through Gemini CLI; not your account availability.",
    pricingLabel: "Google pricing: Gemini API pricing",
    pricingUrl: "https://ai.google.dev/pricing",
    pricingNote:
      "Known-model registry, no connection required. Costs use published API-equivalent USD rates as an illustrative estimate; subscription billing may differ.",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    eyebrow: "PARETO / CURSOR",
    subtitle:
      "Compare known Cursor models with illustrative USD estimates. Better value is toward the upper left.",
    billing: ["usd"],
    live: false,
    availabilityNote:
      "Known models available in Cursor; not your account availability.",
    pricingLabel: "Cursor pricing: pricing page",
    pricingUrl: "https://cursor.com/pricing",
    pricingNote:
      "Known-model registry, no connection required. Costs use published API-equivalent USD rates as an illustrative estimate; application billing may differ.",
  },
  windsurf: {
    id: "windsurf",
    label: "Windsurf",
    eyebrow: "PARETO / WINDSURF",
    subtitle:
      "Compare known Windsurf models with illustrative USD estimates. Better value is toward the upper left.",
    billing: ["usd"],
    live: false,
    availabilityNote:
      "Known models available in Windsurf; not your account availability.",
    pricingLabel: "Windsurf pricing: pricing page",
    pricingUrl: "https://windsurf.com/pricing",
    pricingNote:
      "Known-model registry, no connection required. Costs use published API-equivalent USD rates as an illustrative estimate; application billing may differ.",
  },
  aider: {
    id: "aider",
    label: "Aider",
    eyebrow: "PARETO / AIDER",
    subtitle:
      "Compare curated provider models usable from Aider with illustrative USD estimates. Better value is toward the upper left.",
    billing: ["usd"],
    live: false,
    availabilityNote:
      "Curated provider-model references for Aider (bring-your-own-key); not your account availability.",
    pricingLabel: "Provider pricing: API pricing",
    pricingUrl: "https://openai.com/api/pricing",
    pricingNote:
      "Curated reference registry, no connection required. Costs use published provider API USD rates as an illustrative estimate.",
  },
  "amazon-q": {
    id: "amazon-q",
    label: "Amazon Q Developer",
    eyebrow: "PARETO / AMAZON Q",
    subtitle:
      "Compare publicly identified Amazon Q models with illustrative USD estimates. Better value is toward the upper left.",
    billing: ["usd"],
    live: false,
    availabilityNote:
      "Only publicly identified backing models; proprietary or unidentified models stay unresolved.",
    pricingLabel: "AWS pricing: Amazon Q pricing",
    pricingUrl: "https://aws.amazon.com/q/developer/pricing/",
    pricingNote:
      "Known-model registry, no connection required. Costs use published API-equivalent USD rates where verifiable; otherwise rows stay unpriced.",
  },
};

export function isLiveSource(source: Source): boolean {
  return sources[source].live;
}

export function defaultBilling(source: Source): Billing {
  return source === "copilot" ? "credits" : "usd";
}

export function allowedBilling(source: Source): Billing[] {
  return sources[source].billing;
}
