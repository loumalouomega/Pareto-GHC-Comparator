export const multiplierRebaseCutoffMs = Date.UTC(2026, 5, 1);
const pre: Record<string, number> = {
  "copilot/gpt-4.1": 0,
  "copilot/gpt-4.1-mini": 0,
  "copilot/gpt-4o": 0,
  "copilot/gpt-4o-mini": 0,
  "copilot/gpt-5-mini": 0,
  "copilot/raptor-mini": 0,
  "copilot/gpt-5.4-nano": 0.25,
  "copilot/grok-code-fast-1": 0.25,
  "copilot/claude-haiku-4.5": 0.33,
  "copilot/gemini-3-flash": 0.33,
  "copilot/gpt-5.4-mini": 0.33,
  "copilot/claude-sonnet-4": 1,
  "copilot/claude-sonnet-4.5": 1,
  "copilot/claude-sonnet-4.6": 1,
  "copilot/claude-sonnet-4-thinking": 1,
  "copilot/gemini-2.5-pro": 1,
  "copilot/gemini-3.1-pro": 1,
  "copilot/gpt-5.2": 1,
  "copilot/gpt-5.2-codex": 1,
  "copilot/gpt-5.3-codex": 1,
  "copilot/gpt-5.4": 1,
  "copilot/o4-mini": 1,
  "copilot/claude-opus-4.5": 3,
  "copilot/claude-opus-4.6": 3,
  "copilot/o3": 3,
  "copilot/gpt-5.5": 7.5,
  "copilot/claude-opus-4.7": 15,
  "copilot/claude-opus-4.6-fast": 30,
  "copilot/auto": 0,
  "copilot/gpt-4": 0,
  "copilot/gpt-3.5-turbo": 0,
  "copilot/gemini-2.5-flash": 0,
};
const post: Record<string, number> = {
  "copilot/gpt-5-mini": 0.33,
  "copilot/raptor-mini": 0.33,
  "copilot/mai-code-1-flash": 0.33,
  "copilot/claude-haiku-4.5": 0.33,
  "copilot/gemini-3-flash": 0.33,
  "copilot/gemini-2.5-pro": 1,
  "copilot/gpt-5.3-codex": 6,
  "copilot/gpt-5.4": 6,
  "copilot/gpt-5.4-mini": 6,
  "copilot/gemini-3.1-pro": 6,
  "copilot/claude-sonnet-4.5": 6,
  "copilot/claude-sonnet-4.6": 9,
  "copilot/gemini-3.5-flash": 14,
  "copilot/claude-opus-4.5": 27,
  "copilot/claude-opus-4.6": 27,
  "copilot/claude-opus-4.7": 27,
  "copilot/claude-opus-4.8": 27,
  "copilot/claude-opus-4.8-fast": 54,
  "copilot/gpt-5.5": 57,
  "copilot/auto": 0,
};
export interface UsageMultiplier {
  value: number;
  estimated: boolean;
}
export function usageMultiplier(
  modelId: string | null | undefined,
  timestampMs?: number | null,
  autoMode = false,
): UsageMultiplier {
  const table =
    timestampMs !== null &&
    timestampMs !== undefined &&
    timestampMs < multiplierRebaseCutoffMs
      ? pre
      : post;
  const found = modelId ? table[modelId] : undefined;
  const base = found === undefined ? 1 : found;
  const value = autoMode && base > 0 ? base * 0.9 : base;
  return { value, estimated: found === undefined };
}
