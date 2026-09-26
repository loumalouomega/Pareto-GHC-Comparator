import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OpenCodeError,
  discoverOpenCode,
  fingerprintModelList,
  fingerprintOpenCodeOutput,
  getOpenCodeVersion,
  opencodeBenchmarkFamilies,
  parseModelList,
  parseModels,
  parseOpenCodeVersion,
} from "../src/opencode";
import { compare, estimate, parseOptions, savedOptions } from "../src/compare";
import { parseMessage } from "../src/messages";
import { recommend } from "../src/recommend";
import { defaults, type Benchmark, type CatalogEntry } from "../src/types";

const block = (header: string, body: unknown) =>
  `${header}\n${typeof body === "string" ? body : JSON.stringify(body)}`;
const model = (
  overrides: Record<string, unknown> = {},
  header = "opencode-go/kimi-k2.7-code",
) =>
  block(header, {
    id: "kimi-k2.7-code",
    providerID: "opencode-go",
    name: "Kimi K2.7 Code",
    family: "kimi-k2",
    status: "active",
    cost: { input: 0.95, output: 4, cache: { read: 0.19, write: 0 } },
    limit: { context: 262144, output: 262144 },
    variants: {},
    ...overrides,
  });
/** A 2.x `Model.Info` record: `cost` and `variants` are arrays, `id` is composed. */
const record = (overrides: Record<string, unknown> = {}) => ({
  id: "opencode-go/kimi-k2.7-code",
  modelID: "kimi-k2.7-code",
  providerID: "opencode-go",
  name: "Kimi K2.7 Code",
  family: "kimi-k2",
  variants: [],
  cost: [{ input: 0.95, output: 4, cache: { read: 0.19, write: 0 } }],
  limit: { context: 262144, output: 262144 },
  ...overrides,
});
const list = (data: unknown[]) =>
  JSON.stringify({ location: { directory: "/example" }, data });
const benchmark = (id: string, name: string): Benchmark => ({
  id,
  slug: id,
  name,
  provider: "Moonshot AI",
  scores: { general: 70, coding: 80, agentic: null },
});
const usdOptions = () => ({
  ...savedOptions(defaults),
  source: "opencode" as const,
  billing: "usd" as const,
});

test("verbose listing parses into namespaced models with live rates", () => {
  const models = parseModels(
    [
      model(),
      block("openai/gpt-5.4", {
        id: "gpt-5.4",
        providerID: "openai",
        name: "GPT-5.4",
        family: "gpt",
        status: "active",
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 1050000, input: 922000, output: 128000 },
        variants: { low: {}, high: {} },
      }),
    ].join("\n"),
  );
  assert.equal(models.length, 3);
  const kimi = models[0];
  assert.equal(kimi.id, "opencode:opencode-go/kimi-k2.7-code");
  assert.equal(kimi.source, "opencode");
  assert.deepEqual(kimi.rates, {
    input: 0.95,
    read: 0.19,
    write: null,
    output: 4,
  });
  assert.equal(kimi.maxInputTokens, 262144);
  // Zero cost on a direct provider means unpriced, with one row per variant.
  const variants = models.slice(1);
  assert.deepEqual(
    variants.map((m) => m.id),
    ["opencode:openai/gpt-5.4#low", "opencode:openai/gpt-5.4#high"],
  );
  assert.deepEqual(
    variants.map((m) => m.name),
    ["GPT-5.4 (low)", "GPT-5.4 (high)"],
  );
  assert.equal(variants[0].rates, undefined);
  assert.equal(variants[0].maxInputTokens, 922000);
});

test("identical base models under different providers cannot collide", () => {
  const models = parseModels(
    [
      block("opencode-go/gpt-5.6-luna", {
        id: "gpt-5.6-luna",
        providerID: "opencode-go",
        name: "GPT-5.6 Luna",
        family: "gpt-luna",
        status: "active",
        cost: { input: 0.2, output: 1.2, cache: { read: 0.02, write: 0.25 } },
        limit: { context: 1050000, input: 922000, output: 128000 },
        variants: {},
      }),
      block("openai/gpt-5.6-luna", {
        id: "gpt-5.6-luna",
        providerID: "openai",
        name: "GPT-5.6 Luna",
        family: "gpt-luna",
        status: "active",
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 1050000, input: 922000, output: 128000 },
        variants: {},
      }),
    ].join("\n"),
  );
  assert.deepEqual(
    models.map((m) => m.id),
    ["opencode:opencode-go/gpt-5.6-luna", "opencode:openai/gpt-5.6-luna"],
  );
  assert.ok(models[0].rates);
  assert.equal(models[1].rates, undefined);
});

test("zero-cost Zen models are free; tiers map with fallback notes", () => {
  const models = parseModels(
    [
      block("opencode/big-pickle", {
        id: "big-pickle",
        providerID: "opencode",
        name: "Big Pickle",
        family: "big-pickle",
        status: "active",
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 200000, input: 160000, output: 32000 },
        variants: {},
      }),
      block("opencode-go/gpt-5.6-luna", {
        id: "gpt-5.6-luna",
        providerID: "opencode-go",
        name: "GPT-5.6 Luna",
        family: "gpt-luna",
        status: "active",
        cost: {
          input: 0.2,
          output: 1.2,
          cache: { read: 0.02, write: 0.25 },
          tiers: [
            {
              input: 0.4,
              output: 1.8,
              cache: { read: 0.04, write: 0.5 },
              tier: { type: "context", size: 272000 },
            },
          ],
        },
        limit: { context: 1050000, input: 922000, output: 128000 },
        variants: {},
      }),
      block("opencode-go/odd-tiers", {
        id: "odd-tiers",
        providerID: "opencode-go",
        name: "Odd Tiers",
        family: "odd",
        status: "active",
        cost: {
          input: 1,
          output: 2,
          cache: { read: 0.5, write: 0 },
          tiers: [{ nope: true }],
        },
        limit: { context: 100000, input: 50000, output: 10000 },
        variants: {},
      }),
    ].join("\n"),
  );
  assert.equal(models[0].freeTier, true);
  assert.deepEqual(models[0].rates, {
    input: 0,
    read: 0,
    write: null,
    output: 0,
  });
  assert.deepEqual(models[1].long, {
    threshold: 272000,
    rates: { input: 0.4, read: 0.04, write: 0.5, output: 1.8 },
  });
  assert.equal(models[2].long, undefined);
  assert.deepEqual(models[2].pricingNotes, [
    "Unrecognized pricing tier; using base rates.",
  ]);
});

test("malformed output fails closed and empty output parses to no models", () => {
  assert.throws(() => parseModels(42), /unrecognized model data/);
  assert.throws(
    () => parseModels("opencode-go/broken\n{not json"),
    /unrecognized model data/,
  );
  assert.deepEqual(parseModels(""), []);
  assert.deepEqual(parseModels("   \n"), []);
});

test("only whitelisted fields cross the boundary", () => {
  const models = parseModels(
    model({
      api: { key: "sk-live-secret", url: "https://example.test" },
      headers: { Authorization: "Bearer sk-live-secret" },
      options: { apiKey: "sk-live-secret" },
    }),
  );
  assert.equal(models.length, 1);
  assert.ok(!JSON.stringify(models).includes("sk-live-secret"));
});

test("2.x model.list parses into namespaced models with live rates", () => {
  const models = parseModelList(
    list([
      record(),
      record({
        id: "opencode-go/gpt-5.6-luna",
        modelID: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        cost: [
          { input: 0.2, output: 1.2, cache: { read: 0.02, write: 0.25 } },
          {
            tier: { type: "context", size: 272000 },
            input: 0.4,
            output: 1.8,
            cache: { read: 0.04, write: 0.5 },
          },
        ],
        limit: { context: 1050000, input: 922000, output: 128000 },
        variants: [{ id: "low" }, { id: "high" }],
      }),
      record({
        id: "openai/gpt-5.4",
        modelID: "gpt-5.4",
        providerID: "openai",
        name: "GPT-5.4",
        cost: [],
      }),
    ]),
  );
  assert.equal(models.length, 4);
  const kimi = models[0];
  assert.equal(kimi.id, "opencode:opencode-go/kimi-k2.7-code");
  assert.equal(kimi.source, "opencode");
  assert.deepEqual(kimi.rates, {
    input: 0.95,
    read: 0.19,
    write: null,
    output: 4,
  });
  assert.equal(kimi.maxInputTokens, 262144);
  // The base entry carries the rates; the first context tier becomes `long`.
  const luna = models[1];
  assert.deepEqual(luna.rates, {
    input: 0.2,
    read: 0.02,
    write: 0.25,
    output: 1.2,
  });
  assert.deepEqual(luna.long, {
    threshold: 272000,
    rates: { input: 0.4, read: 0.04, write: 0.5, output: 1.8 },
  });
  assert.equal(luna.maxInputTokens, 922000);
  assert.deepEqual(
    models.slice(1, 3).map((m) => m.id),
    ["opencode:opencode-go/gpt-5.6-luna#low", "opencode:opencode-go/gpt-5.6-luna#high"],
  );
  assert.equal(models[2].name, "GPT-5.6 Luna (high)");
  // An empty cost array is a real "no published rates" answer, not a failure,
  // and not a free tier: the provider bills directly.
  const byok = models[3];
  assert.equal(byok.id, "opencode:openai/gpt-5.4");
  assert.equal(byok.rates, undefined);
  assert.equal(byok.freeTier, undefined);
  assert.deepEqual(byok.pricingNotes, [
    "No published rates; supply a BYOK rate.",
  ]);
});

test("2.x zero-cost Zen models are free and unusable entries are skipped", () => {
  const models = parseModelList(
    list([
      record({
        id: "opencode/big-pickle",
        modelID: "big-pickle",
        providerID: "opencode",
        name: "Big Pickle",
        cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
      }),
      record({ providerID: "has space", name: "Bad Provider" }),
      record({ modelID: "", name: "No Id" }),
      { modelID: "no-name", providerID: "openai" },
      record({ cost: "not an array", name: "Bad Cost" }),
      { modelID: "not-an-object" },
      "not-an-object",
    ]),
  );
  assert.equal(models.length, 2);
  assert.equal(models[0].id, "opencode:opencode/big-pickle");
  assert.equal(models[0].freeTier, true);
  assert.deepEqual(models[0].rates, {
    input: 0,
    read: 0,
    write: null,
    output: 0,
  });
  assert.equal(models[1].name, "Bad Cost");
  assert.deepEqual(models[1].pricingNotes, [
    "Unrecognized cost shape; pricing unavailable.",
  ]);
  // A zero write rate is a real observed zero, so this is still the free tier
  // rather than a model that merely looks free on three of four buckets.
  const zeroWrite = parseModelList(
    list([
      record({
        providerID: "opencode",
        cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
      }),
      // …but a genuine cache-write price is not free, on any provider.
      record({
        id: "opencode/write-priced",
        modelID: "write-priced",
        providerID: "opencode",
        name: "Write Priced",
        cost: [{ input: 0, output: 0, cache: { read: 0, write: 0.5 } }],
      }),
    ]),
  );
  assert.equal(zeroWrite[0].freeTier, true);
  assert.equal(zeroWrite[1].freeTier, undefined);
  assert.deepEqual(zeroWrite[1].rates, {
    input: 0,
    read: 0,
    write: 0.5,
    output: 0,
  });
  // A family falls back to the bare model id; unusable variant keys are dropped.
  const familyless = parseModelList(
    list([record({ family: undefined, variants: [{ id: "low" }, { id: "" }, 7] })]),
  );
  assert.equal(familyless[0].family, "kimi-k2.7-code");
  assert.deepEqual(
    familyless.map((m) => m.id),
    ["opencode:opencode-go/kimi-k2.7-code#low"],
  );
  // Two records resolving to one identity collapse to a single row, and an
  // unreported context limit stays 0 rather than borrowing another model's.
  const collapsed = parseModelList(
    list([
      record(),
      record({ limit: "not an object" }),
      record({ limit: undefined }),
    ]),
  );
  assert.deepEqual(
    collapsed.map((m) => m.id),
    ["opencode:opencode-go/kimi-k2.7-code"],
  );
  assert.equal(collapsed[0].maxInputTokens, 262144);
  // The same base model under two providers stays two rows, as on 1.x.
  const split = parseModelList(
    list([
      record(),
      record({ id: "openai/kimi-k2.7-code", providerID: "openai" }),
    ]),
  );
  assert.deepEqual(
    split.map((m) => m.id),
    ["opencode:opencode-go/kimi-k2.7-code", "opencode:openai/kimi-k2.7-code"],
  );
});

test("2.x listing fails closed and fingerprints unknown shapes", () => {
  // An error envelope is a failure, never a silent zero-model listing.
  for (const payload of [
    JSON.stringify({ error: { type: "unknown", message: "Command cancelled" }, content: [] }),
    JSON.stringify({ data: "not an array" }),
    JSON.stringify({ models: [] }),
    "{not json",
    42,
  ]) {
    assert.throws(() => parseModelList(payload), /unrecognized model data/);
  }
  assert.deepEqual(parseModelList(list([])), []);
  assert.deepEqual(fingerprintModelList(42), {
    version: 1,
    envelope: false,
    records: 0,
    jsonFailures: 0,
    missingId: 0,
    missingProvider: 0,
    missingName: 0,
    invalidProvider: 0,
  });
  // The envelope flag separates "not our shape" from a genuine empty listing.
  assert.deepEqual(
    fingerprintModelList(
      JSON.stringify({ error: { message: "Command cancelled" } }),
    ),
    {
      version: 1,
      envelope: true,
      records: 0,
      jsonFailures: 0,
      missingId: 0,
      missingProvider: 0,
      missingName: 0,
      invalidProvider: 0,
    },
  );
  assert.deepEqual(fingerprintModelList("{not json").envelope, false);
  assert.deepEqual(
    fingerprintModelList(
      list([
        { modelID: "a" },
        { modelID: "b", providerID: "has space", name: "B" },
        { modelID: "c", providerID: "openai" },
        { providerID: "openai", name: "D" },
        "scalar",
        7,
      ]),
    ),
    {
      version: 1,
      envelope: false,
      records: 6,
      jsonFailures: 2,
      // "a" and "c" have no name, "D" has no modelID, and the second entry's
      // provider is present but unusable.
      missingId: 1,
      missingProvider: 1,
      missingName: 2,
      invalidProvider: 1,
    },
  );
  // The fingerprint is shape-only: no ids, names, or rates leak into it.
  assert.ok(!JSON.stringify(fingerprintModelList(list([record()]))).includes("kimi"));
  assert.throws(
    () =>
      parseModelList(
        JSON.stringify({ error: { type: "unknown", message: "boom" } }),
      ),
    /list schema v1 envelope=true records=0/,
  );
  assert.throws(
    () => parseModelList(JSON.stringify({ error: { message: "boom" } })),
    /file an issue/,
  );
});

test("only whitelisted fields cross the 2.x boundary", () => {
  const models = parseModelList(
    list([
      record({
        settings: { apiKey: "sk-live-secret" },
        headers: { Authorization: "Bearer sk-live-secret" },
        body: { reasoning: { effort: "high" } },
        package: "@ai-sdk/openai",
        compatibility: { reasoningEffort: true },
        api: { key: "sk-live-secret" },
      }),
    ]),
  );
  assert.equal(models.length, 1);
  assert.ok(!JSON.stringify(models).includes("sk-live-secret"));
});

test("discovery maps spawn, failure, and empty states to guidance", async () => {
  const fixture = model();
  assert.equal(
    (await discoverOpenCode(async () => ({ code: 0, stdout: fixture, stderr: "" }))).length,
    1,
  );
  await assert.rejects(
    discoverOpenCode(async () => ({ code: 1, stdout: "", stderr: "boom" })),
    (error) =>
      error instanceof OpenCodeError &&
      error.kind === "command" &&
      /exit 1/.test(error.message) &&
      /boom/.test(error.message),
  );
  await assert.rejects(
    discoverOpenCode(async () => {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    }),
    (error) => error instanceof OpenCodeError && error.kind === "missing",
  );
  await assert.rejects(
    discoverOpenCode(async () => ({ code: 0, stdout: "", stderr: "" })),
    (error) => error instanceof OpenCodeError && error.kind === "empty",
  );
  await assert.rejects(
    discoverOpenCode(async () => ({ code: 0, stdout: "garbage", stderr: "" })),
    (error) => error instanceof OpenCodeError && error.kind === "parse",
  );
});

test("discovery falls back to the 2.x surface when 1.x cannot list", async () => {
  const verbose = model();
  const viaV1: string[] = [];
  const one = await discoverOpenCode(async (args) => {
    viaV1.push(args.join(" "));
    return { code: 0, stdout: verbose, stderr: "" };
  });
  // A working 1.x install never pays for a second surface.
  assert.equal(one.length, 1);
  assert.deepEqual(viaV1, ["models --verbose"]);

  // 2.x removed the flag; its own surface supplies the same listing instead.
  const viaV2: string[] = [];
  const two = await discoverOpenCode(async (args) => {
    viaV2.push(args.join(" "));
    if (args[0] === "--version") return { code: 0, stdout: "2.0.16\n", stderr: "" };
    if (args[0] === "models")
      return { code: 1, stdout: "", stderr: "Unrecognized flag: --verbose" };
    return { code: 0, stdout: list([record()]), stderr: "" };
  });
  assert.deepEqual(
    two.map((m) => m.id),
    ["opencode:opencode-go/kimi-k2.7-code"],
  );
  assert.ok(viaV2.includes("api model.list"));

  // Neither surface listing anything keeps the "connect a provider" guidance.
  const empty: string[] = [];
  await assert.rejects(
    discoverOpenCode(async (args) => {
      empty.push(args.join(" "));
      return args[0] === "--version"
        ? { code: 0, stdout: "2.0.16\n", stderr: "" }
        : { code: 0, stdout: "", stderr: "" };
    }),
    (error) =>
      error instanceof OpenCodeError &&
      error.kind === "empty" &&
      /Connect a provider/.test(error.message) &&
      /OpenCode CLI 2\.0\.16/.test(error.message),
  );
  assert.ok(empty.includes("api model.list"));

  // When both fail, the 1.x failure is reported and the 2.x attempt named.
  const both: string[] = [];
  await assert.rejects(
    discoverOpenCode(async (args) => {
      both.push(args.join(" "));
      if (args[0] === "--version") return { code: 0, stdout: "2.0.16\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "boom" };
    }),
    (error) =>
      error instanceof OpenCodeError &&
      error.kind === "command" &&
      /exit 1/.test(error.message) &&
      /boom/.test(error.message) &&
      /OpenCode CLI 2\.0\.16/.test(error.message) &&
      /2\.x listing surface also failed \(command\)/.test(error.message),
  );
  assert.ok(both.includes("api model.list"));
  // The version is probed once and reused across both surfaces' diagnostics.
  assert.equal(both.filter((a) => a === "--version").length, 1);
});

test("environment failures never fall back to the 2.x surface", async () => {
  for (const error of [
    Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    new OpenCodeError("OpenCode discovery timed out.", "timeout"),
  ]) {
    const calls: string[] = [];
    await assert.rejects(
      discoverOpenCode(async (args) => {
        calls.push(args.join(" "));
        throw error;
      }),
      (e) => e instanceof OpenCodeError,
    );
    // A missing binary or a timeout is not a shape change: one attempt only,
    // so a fallback could not double a 20-second wait for nothing.
    assert.deepEqual(calls, ["models --verbose"]);
  }
  // A binary that disappears between the two surfaces reports the 1.x failure
  // it caused, with the 2.x attempt named rather than replacing the diagnosis.
  await assert.rejects(
    discoverOpenCode(async (args) => {
      if (args[0] === "models")
        return { code: 1, stdout: "", stderr: "Unrecognized flag: --verbose" };
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    }),
    (error) =>
      error instanceof OpenCodeError &&
      error.kind === "command" &&
      /Unrecognized flag/.test(error.message) &&
      /2\.x listing surface also failed \(missing\)/.test(error.message),
  );
});

test("a cold 2.x service is retried once, and stays a failure when not", async () => {
  const cold = JSON.stringify({
    error: { type: "unknown", message: "Command cancelled" },
    content: [],
  });
  const cli = async (args: string[]) => {
    if (args[0] === "--version") return { code: 0, stdout: "2.0.16\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "Unrecognized flag: --verbose" };
  };
  const served = async (args: string[]) => {
    if (args[0] === "--version") return { code: 0, stdout: "2.0.16\n", stderr: "" };
    if (args[0] === "models") return cli(args);
    return { code: 0, stdout: list([record()]), stderr: "" };
  };
  // A background service that had not finished starting answers with an error
  // envelope; one retry separates that from real drift.
  let attempts = 0;
  const retried = await discoverOpenCode(
    async (args) => {
      if (args[0] === "api") attempts++;
      return served(args);
    },
    { retryDelayMs: 1 },
  );
  assert.equal(attempts, 1);

  attempts = 0;
  const models = await discoverOpenCode(
    async (args) => {
      if (args[0] === "api") {
        attempts++;
        return attempts === 1
          ? { code: 0, stdout: cold, stderr: "" }
          : { code: 0, stdout: list([record()]), stderr: "" };
      }
      return served(args);
    },
    { retryDelayMs: 1 },
  );
  assert.equal(attempts, 2);
  assert.deepEqual(
    models.map((m) => m.id),
    ["opencode:opencode-go/kimi-k2.7-code"],
  );

  // With no opt-in there is no retry, so the envelope surfaces as a parse
  // failure naming both surfaces rather than a silent empty listing.
  await assert.rejects(
    discoverOpenCode(async (args) =>
      args[0] === "api" ? { code: 0, stdout: cold, stderr: "" } : cli(args),
    ),
    (error) =>
      error instanceof OpenCodeError &&
      error.kind === "command" &&
      /2\.x listing surface also failed \(parse\)/.test(error.message),
  );
});

test("USD estimates use per-million rates, free tiers, and provider billing", () => {
  const options = usdOptions();
  const priced = estimate(
    {
      ids: ["opencode:opencode-go/kimi-k2.7-code"],
      name: "Kimi K2.7 Code",
      provider: "opencode-go",
      benchmarkFamilies: ["Kimi K2.7 Code"],
      rates: { input: 0.95, read: 0.19, write: null, output: 4 },
    },
    options,
  );
  assert.equal(priced.cost, (1000 * 0.95 + 1000 * 4) / 1000000);
  assert.equal(priced.tier, "Default context");
  assert.equal(
    estimate(
      {
        ids: ["x"],
        name: "Free",
        provider: "opencode",
        benchmarkFamilies: ["Free"],
        freeTier: true,
      },
      options,
    ).cost,
    0,
  );
  assert.match(
    estimate(
      {
        ids: ["opencode:openai/gpt-5.4#low"],
        name: "GPT-5.4 (low)",
        provider: "openai",
        benchmarkFamilies: ["GPT-5.4"],
      },
      options,
    ).reason!,
    /Billed by provider/,
  );
});

test("long-context tiers apply to the whole workload past the threshold", () => {
  const base: CatalogEntry = {
    ids: ["opencode:opencode-go/gpt-5.6-luna"],
    name: "GPT-5.6 Luna",
    provider: "opencode-go",
    benchmarkFamilies: ["GPT-5.6 Luna"],
    rates: { input: 0.2, read: 0.02, write: 0.25, output: 1.2 },
    long: {
      threshold: 272000,
      rates: { input: 0.4, read: 0.04, write: 0.5, output: 1.8 },
    },
  };
  const at = estimate(base, {
    ...usdOptions(),
    tokens: { input: 270000, read: 1000, write: 1000, output: 0 },
  });
  assert.equal(at.tier, "Default context");
  const over = estimate(base, {
    ...usdOptions(),
    tokens: { input: 270001, read: 1000, write: 1000, output: 1000 },
  });
  assert.equal(
    over.cost,
    (270001 * 0.4 + 1000 * 0.04 + 1000 * 0.5 + 1000 * 1.8) / 1000000,
  );
  assert.equal(over.tier, "Long context");
});

test("comparison prices OpenCode rows in USD and never mixes cost units", () => {
  const kimi = parseModels(model())[0];
  const rows = compare(
    [kimi],
    [benchmark("a", "Kimi K2.7 Code")],
    usdOptions(),
  );
  assert.equal(rows[0].mappingStatus, "exact");
  assert.equal(rows[0].provider, "opencode-go");
  assert.equal(
    rows[0].cost,
    (1000 * 0.95 + 1000 * 4) / 1000000,
  );
  const creditsRows = compare(
    [kimi],
    [benchmark("a", "Kimi K2.7 Code")],
    { ...usdOptions(), billing: "credits" },
  );
  assert.equal(creditsRows[0].cost, null);
  assert.match(creditsRows[0].reasons.join(" "), /USD billing/);
  const copilotRows = compare(
    [
      {
        id: "gpt-5-mini",
        name: "GPT-5 mini",
        family: "gpt-5-mini",
        maxInputTokens: 1000000,
        source: "copilot",
      },
    ],
    [benchmark("b", "GPT-5 mini")],
    usdOptions(),
  );
  assert.equal(copilotRows[0].cost, null);
  assert.match(copilotRows[0].reasons.join(" "), /AI credits or legacy/);
});

test("variant rows share the base benchmark family and USD context limits apply", () => {
  const models = parseModels(
    block("openai/gpt-5.4", {
      id: "gpt-5.4",
      providerID: "openai",
      name: "GPT-5.4",
      family: "gpt",
      status: "active",
      cost: { input: 1, output: 2, cache: { read: 0.5, write: 0 } },
      limit: { context: 1000, input: 1000, output: 1000 },
      variants: { low: {}, high: {} },
    }),
  );
  const rows = compare(models, [benchmark("a", "GPT-5.4 (low)")], {
    ...usdOptions(),
    display: { ...usdOptions().display, chart: "workload" },
    tokens: { input: 900, read: 200, write: 0, output: 10 },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cost, null);
  assert.match(rows[0].reasons.join(" "), /context limit/);
});

test("saved options migrate to Copilot defaults with a USD budget", () => {
  const migrated = savedOptions({ preset: "coding" });
  assert.equal(migrated.source, "copilot");
  assert.equal(migrated.recommendation.budgets.usd, 1);
  assert.equal(migrated.billing, "credits");
  const legacy = savedOptions({
    ...defaults,
    recommendation: undefined,
  });
  assert.deepEqual(legacy.recommendation, defaults.recommendation);
  const parsed = parseOptions({
    ...defaults,
    source: "opencode",
    billing: "usd",
  });
  assert.equal(parsed.source, "opencode");
  assert.throws(() => parseOptions({ ...defaults, source: "other" }));
  assert.throws(() =>
    parseOptions({
      ...defaults,
      recommendation: { ...defaults.recommendation, budgets: { credits: 1, legacy: 1 } },
    }),
  );
});

test("source and USD recommendation messages validate", () => {
  assert.deepEqual(parseMessage({ type: "source", source: "opencode" }), {
    type: "source",
    source: "opencode",
  });
  assert.throws(() => parseMessage({ type: "source", source: "other" }));
  assert.deepEqual(
    recommend(
      [
        {
          id: "a",
          modelId: "a",
          baseModelId: "a",
          name: "a",
          provider: "opencode-go",
          cost: 0.5,
          score: 80,
          frontier: true,
          reasons: [],
          dominatedBy: [],
          mappingStatus: "exact",
          candidateIds: [],
        },
      ],
      usdOptions(),
    ).explanation,
    "a: 80 index points at 0.5 USD. Highest score within 1 USD; lower cost breaks score ties.",
  );
});

test("default runner spawns the CLI directly without a shell", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-test-"));
  const fixtureFile = path.join(dir, "models.txt");
  await writeFile(fixtureFile, model());
  await writeFile(
    path.join(dir, "opencode"),
    '#!/bin/sh\ncat "$OPENCODE_FIXTURE_FILE"\n',
  );
  await chmod(path.join(dir, "opencode"), 0o755);
  const pathBefore = process.env.PATH;
  const fixtureBefore = process.env.OPENCODE_FIXTURE_FILE;
  process.env.PATH = `${dir}${path.delimiter}${pathBefore}`;
  process.env.OPENCODE_FIXTURE_FILE = fixtureFile;
  try {
    const models = await discoverOpenCode();
    assert.equal(models.length, 1);
    assert.equal(models[0].id, "opencode:opencode-go/kimi-k2.7-code");
  } finally {
    process.env.PATH = pathBefore;
    if (fixtureBefore === undefined) delete process.env.OPENCODE_FIXTURE_FILE;
    else process.env.OPENCODE_FIXTURE_FILE = fixtureBefore;
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI version parsing and drifted output fingerprint fail closed", async () => {
  const { readFile } = await import("node:fs/promises");
  assert.equal(parseOpenCodeVersion("1.18.30\n"), "1.18.30");
  assert.equal(parseOpenCodeVersion("v1.18.30"), "1.18.30");
  assert.equal(parseOpenCodeVersion("1.18.30+exp.sha.5114f84"), "1.18.30+exp.sha.5114f84");
  assert.equal(parseOpenCodeVersion("1.18.30 (extra words)"), "1.18.30");
  assert.equal(parseOpenCodeVersion(`1.18.30-${"x".repeat(60)}`), undefined);
  assert.equal(parseOpenCodeVersion("garbage"), undefined);
  assert.equal(parseOpenCodeVersion(""), undefined);
  assert.equal(parseOpenCodeVersion(42), undefined);
  // 2.x prefixes the version with the binary name; a v2 diagnostic must still
  // name the version that produced it rather than reporting it unavailable.
  assert.equal(parseOpenCodeVersion("opencode v2.0.16\n"), "2.0.16");
  assert.equal(parseOpenCodeVersion("opencode v2.0.16+build.7"), "2.0.16+build.7");
  // A long or unbounded banner never yields an unbounded version string.
  assert.equal(parseOpenCodeVersion(`${"banner ".repeat(20)}9.9.9`), undefined);
  assert.equal(
    await getOpenCodeVersion(async () => ({
      code: 0,
      stdout: "1.18.30\n",
      stderr: "",
    })),
    "1.18.30",
  );
  assert.equal(
    await getOpenCodeVersion(async () => ({ code: 1, stdout: "", stderr: "" })),
    undefined,
  );
  assert.equal(
    await getOpenCodeVersion(async () => {
      throw new Error("spawn failed");
    }),
    undefined,
  );
  const known = await readFile(
    "test/fixtures/opencode/verbose-1.18.30.txt",
    "utf8",
  );
  assert.equal(parseModels(known).length, 2);
  // The dated 2.x representative stays parseable alongside the 1.x contract.
  const knownV2 = await readFile(
    "test/fixtures/opencode/model-list-2.0.16.json",
    "utf8",
  );
  assert.equal(parseModelList(knownV2).length, 6);
  const drifted = await readFile("test/fixtures/opencode/drifted.txt", "utf8");
  assert.deepEqual(fingerprintOpenCodeOutput(drifted), {
    version: 1,
    blocks: 0,
    jsonFailures: 0,
    missingId: 0,
    missingProvider: 0,
    missingName: 0,
    invalidProvider: 0,
  });
  // The fingerprint is shape-only: no ids, names, or rates leak into it.
  assert.ok(!JSON.stringify(fingerprintOpenCodeOutput(model())).includes("kimi"));
  assert.deepEqual(fingerprintOpenCodeOutput(42), {
    version: 1,
    blocks: 0,
    jsonFailures: 0,
    missingId: 0,
    missingProvider: 0,
    missingName: 0,
    invalidProvider: 0,
  });
  assert.deepEqual(
    fingerprintOpenCodeOutput(
      [
        block("good/a", {
          id: "a",
          providerID: "good",
          name: "A",
          cost: { input: 1, output: 1, cache: { read: 1, write: 1 } },
          limit: { context: 10 },
          variants: {},
        }),
        "stray/garbage\n{not valid json}",
        block("empty/b", {}),
        block("weird/c", { id: "c", providerID: "has space", name: "C" }),
        "array/d\n[1, {\"a\": 1}]",
      ].join("\n"),
    ),
    {
      version: 1,
      blocks: 5,
      jsonFailures: 2,
      missingId: 1,
      missingProvider: 1,
      missingName: 1,
      invalidProvider: 1,
    },
  );
  assert.throws(() => parseModels(drifted), /schema v1 blocks=0/);
  assert.throws(() => parseModels(drifted), /file an issue/);
  // Discovery attaches the probed CLI version to parse failures.
  await assert.rejects(
    discoverOpenCode(async (args) =>
      args[0] === "--version"
        ? { code: 0, stdout: "1.18.30\n", stderr: "" }
        : { code: 0, stdout: drifted, stderr: "" },
    ),
    (error) =>
      error instanceof OpenCodeError &&
      error.kind === "parse" &&
      /OpenCode CLI 1\.18\.30/.test(error.message) &&
      /schema v1/.test(error.message),
  );
  // A failed version probe degrades to "version unavailable", never a block.
  await assert.rejects(
    discoverOpenCode(async (args) =>
      args[0] === "--version"
        ? { code: 1, stdout: "", stderr: "" }
        : { code: 0, stdout: drifted, stderr: "" },
    ),
    (error) =>
      error instanceof OpenCodeError && /version unavailable/.test(error.message),
  );
  await assert.rejects(
    discoverOpenCode(async (args) =>
      args[0] === "--version"
        ? { code: 0, stdout: "9.9.9", stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
    ),
    (error) =>
      error instanceof OpenCodeError &&
      error.kind === "empty" &&
      /9\.9\.9/.test(error.message),
  );
});
test("known OpenCode families resolve without user selection", () => {
  assert.ok(opencodeBenchmarkFamilies["opencode-go/kimi-k2.7-code"]);
  const rows = compare(parseModels(model()), [benchmark("a", "Kimi K2.7 Code (Reasoning)")], usdOptions());
  assert.equal(rows[0].mappingStatus, "exact");
});
