import { test } from "vitest";
import assert from "node:assert/strict";
import { invocableRef } from "../src/invocable";
import type { AvailableModel } from "../src/types";

const model = (over: Partial<AvailableModel>): AvailableModel => ({
  id: "id",
  name: "Display Name (high)",
  family: "family",
  maxInputTokens: 100000,
  ...over,
});

test("Copilot models have no invocable id — selection has no external id surface", () => {
  assert.equal(invocableRef(model({ id: "gpt-5-mini", source: undefined })), null);
  assert.equal(
    invocableRef(model({ id: "gpt-5-mini", source: "copilot" as never })),
    null,
  );
});

test("OpenCode ref strips the opencode: prefix and keeps the #variant suffix", () => {
  const base = invocableRef(
    model({ id: "opencode:opencode-go/kimi-k2.7-code", source: "opencode" }),
  );
  assert.deepEqual(base, {
    ref: "opencode-go/kimi-k2.7-code",
    usage: 'opencode run -m <id> / "model" in opencode.json',
  });
  const variant = invocableRef(
    model({ id: "opencode:openai/gpt-5.4#high", source: "opencode" }),
  );
  assert.equal(variant?.ref, "openai/gpt-5.4#high");
});

test("static-source models need an explicit, verified invocableId — never derived from name or registry id", () => {
  // No invocableId set at all.
  assert.equal(
    invocableRef(model({ id: "codex:gpt-5-3-codex-spark", source: "codex" })),
    null,
  );
  // invocableId present but source has no documented usage surface.
  assert.equal(
    invocableRef(
      model({
        id: "cursor:cursor-gpt-5-6-terra",
        source: "cursor",
        invocableId: "gpt-5.6-terra",
      }),
    ),
    null,
  );
  // Verified: id differs from both the display name and the registry key.
  const codex = invocableRef(
    model({
      id: "codex:gpt-5-6-terra",
      name: "GPT-5.6 Terra",
      source: "codex",
      invocableId: "gpt-5.6-terra",
    }),
  );
  assert.deepEqual(codex, {
    ref: "gpt-5.6-terra",
    usage: 'codex -m <id> / "model" in config.toml',
  });
});

test("Claude Code and Gemini CLI usage labels are distinct and doc-sourced", () => {
  const claude = invocableRef(
    model({
      id: "claude-code:claude-opus-5",
      source: "claude-code",
      invocableId: "claude-opus-5",
    }),
  );
  assert.equal(claude?.usage, 'claude --model <id> / "model" in settings.json');
  const gemini = invocableRef(
    model({
      id: "gemini-cli:gemini-3-flash",
      source: "gemini-cli",
      invocableId: "gemini-3-flash-preview",
    }),
  );
  assert.deepEqual(gemini, {
    ref: "gemini-3-flash-preview",
    usage: 'gemini -m <id> / "model.name" in settings.json',
  });
});
