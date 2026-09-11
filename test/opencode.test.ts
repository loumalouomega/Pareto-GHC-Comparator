import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OpenCodeError,
  discoverOpenCode,
  opencodeBenchmarkFamilies,
  parseModels,
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

test("known OpenCode families resolve without user selection", () => {
  assert.ok(opencodeBenchmarkFamilies["opencode-go/kimi-k2.7-code"]);
  const rows = compare(parseModels(model()), [benchmark("a", "Kimi K2.7 Code (Reasoning)")], usdOptions());
  assert.equal(rows[0].mappingStatus, "exact");
});
