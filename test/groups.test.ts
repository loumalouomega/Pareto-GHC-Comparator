import { test } from "vitest";
import assert from "node:assert/strict";
import {
  baseDisplayName,
  buildGroups,
  filterGroups,
  leafIdsForFamily,
  leafIdsForModel,
  thinkingOf,
} from "../src/groups";
import { parseMessage } from "../src/messages";
import { compare, pinRowId } from "../src/compare";
import { staticEntries, staticModels } from "../src/staticSources";
import { defaults, type AvailableModel, type Row } from "../src/types";

const model = (
  id: string,
  name: string,
  family: string,
  source: AvailableModel["source"] = "copilot",
): AvailableModel => ({ id, name, family, maxInputTokens: 1000000, source });

const rowFor = (id: string): Row => ({
  id,
  modelId: id,
  baseModelId: id,
  name: id,
  provider: "Test",
  cost: 1,
  score: 80,
  frontier: true,
  dominatedBy: [],
  reasons: [],
  mappingStatus: "exact",
  candidateIds: [],
});

test("openCode variants share one model with one leaf per thinking level", () => {
  const available = [
    model("opencode:openai/gpt-5.4#low", "GPT-5.4 (low)", "gpt", "opencode"),
    model("opencode:openai/gpt-5.4#high", "GPT-5.4 (high)", "gpt", "opencode"),
    model(
      "opencode:opencode-go/kimi-k2.7-code",
      "Kimi K2.7 Code",
      "kimi-k2",
      "opencode",
    ),
  ];
  assert.equal(thinkingOf(available[0]), "low");
  assert.equal(thinkingOf(available[2]), "Standard");
  const groups = buildGroups(available, [], available.map((m) => rowFor(m.id)));
  assert.equal(groups.length, 2);
  const gpt = groups.find((g) => g.id === "gpt")!;
  assert.equal(gpt.models.length, 1);
  assert.equal(gpt.models[0].leaves.length, 2);
  assert.deepEqual(
    gpt.models[0].leaves.map((l) => l.thinking).sort(),
    ["high", "low"],
  );
  assert.equal(gpt.state, "checked");
  assert.deepEqual(
    leafIdsForModel(groups, gpt.models[0].id).sort(),
    ["opencode:openai/gpt-5.4#high", "opencode:openai/gpt-5.4#low"].sort(),
  );
  assert.deepEqual(
    leafIdsForFamily(groups, "gpt").sort(),
    ["opencode:openai/gpt-5.4#high", "opencode:openai/gpt-5.4#low"].sort(),
  );
});

test("family and model states report partial selection", () => {
  const available = [
    model("a-1", "A One", "Family A"),
    model("a-2", "A Two", "Family A"),
    model("b-1", "B One", "Family B"),
  ];
  const groups = buildGroups(available, ["a-1"], []);
  const familyA = groups.find((g) => g.id === "Family A")!;
  assert.equal(familyA.state, "mixed");
  assert.equal(familyA.includedCount, 1);
  assert.equal(familyA.totalCount, 2);
  const single = familyA.models.find((m) => m.leaves.length === 1)!;
  assert.equal(single.state, single.leaves[0].included ? "checked" : "unchecked");
  const familyB = groups.find((g) => g.id === "Family B")!;
  assert.equal(familyB.state, "checked");
});

test("leaf exclusion keys still drive comparison filtering", () => {
  const available = [
    model("opencode:openai/gpt-5.4#low", "GPT-5.4 (low)", "gpt", "opencode"),
    model("opencode:openai/gpt-5.4#high", "GPT-5.4 (high)", "gpt", "opencode"),
  ];
  const options = {
    ...defaults,
    source: "opencode" as const,
    billing: "usd" as const,
  };
  const benchmarks = [
    {
      id: "b",
      slug: "b",
      name: "GPT-5.4",
      provider: "OpenAI",
      scores: { general: 80, coding: 80, agentic: 80 },
    },
  ];
  const all = compare(available, benchmarks, options);
  assert.equal(all.length, 2);
  const filtered = compare(available, benchmarks, options, {}, undefined, {
    excluded: ["opencode:openai/gpt-5.4#low"],
  });
  assert.deepEqual(
    filtered.map((r) => r.modelId),
    ["opencode:openai/gpt-5.4#high"],
  );
});

test("excludeMany validates bulk group updates in one message", () => {
  assert.deepEqual(
    parseMessage({ type: "excludeMany", ids: ["a", "b"], excluded: true }),
    { type: "excludeMany", ids: ["a", "b"], excluded: true },
  );
  assert.deepEqual(
    parseMessage({ type: "excludeMany", ids: [], excluded: false }),
    { type: "excludeMany", ids: [], excluded: false },
  );
  for (const raw of [
    { type: "excludeMany", ids: "a", excluded: true },
    { type: "excludeMany", ids: ["a", 7], excluded: true },
    { type: "excludeMany", ids: ["a"] },
    { type: "exclude", id: "a" },
  ])
    assert.throws(() => parseMessage(raw));
});

test("group search keeps matching families, models, and thinking levels", () => {
  const available = [
    model("opencode:openai/gpt-5.4#low", "GPT-5.4 (low)", "gpt", "opencode"),
    model("opencode:openai/gpt-5.4#high", "GPT-5.4 (high)", "gpt", "opencode"),
    model("claude-code:claude-sonnet-4-6", "Claude Sonnet 4.6", "Claude Sonnet", "claude-code"),
  ];
  const groups = buildGroups(available, [], []);
  const high = filterGroups(groups, "high");
  assert.equal(high.length, 1);
  assert.equal(high[0].id, "gpt");
  assert.equal(high[0].models[0].leaves.length, 1);
  assert.equal(high[0].models[0].leaves[0].thinking, "high");
  const sonnet = filterGroups(groups, "sonnet");
  assert.ok(sonnet.some((g) => g.id === "Claude Sonnet"));
  assert.deepEqual(filterGroups(groups, "no-such-model"), []);
  assert.equal(filterGroups(groups, "  ").length, groups.length);
});

test("group helpers handle missing families, names, and ids", () => {
  assert.equal(baseDisplayName("GPT-5.4 (high)"), "GPT-5.4");
  assert.equal(baseDisplayName("(high)"), "(high)");
  assert.equal(baseDisplayName("Plain"), "Plain");
  const other = buildGroups(
    [{ id: "x", name: "X", family: "  ", maxInputTokens: 10 }],
    [],
    [],
  );
  assert.equal(other[0].id, "Other");
  assert.equal(other[0].name, "Other");
  assert.deepEqual(leafIdsForFamily(other, "missing"), []);
  assert.deepEqual(leafIdsForModel(other, "missing"), []);
  assert.deepEqual(
    leafIdsForFamily(other, "Other"),
    ["x"],
  );
  const excluded = buildGroups(
    [{ id: "x", name: "X", family: "F", maxInputTokens: 10 }],
    new Set(["x"]),
    [],
  );
  assert.equal(excluded[0].state, "unchecked");
  // Family and model hits keep all leaves with original states.
  const available = [
    model("opencode:openai/gpt-5.4#low", "GPT-5.4 (low)", "gpt", "opencode"),
    model("opencode:openai/gpt-5.4#high", "GPT-5.4 (high)", "gpt", "opencode"),
  ];
  const groups = buildGroups(available, ["opencode:openai/gpt-5.4#low"], []);
  const familyHit = filterGroups(groups, "gpt");
  assert.equal(familyHit[0].models[0].leaves.length, 2);
  assert.equal(familyHit[0].state, "mixed");
  const providerHit = filterGroups(groups, "unknown");
  assert.equal(providerHit[0].models[0].leaves.length, 2);
  const idHit = filterGroups(groups, "opencode:openai");
  assert.equal(idHit[0].models[0].leaves.length, 2);
});

test("expanded benchmark variants become one thinking leaf per row", () => {
  const gpt = model("gpt-5.4", "GPT-5.4", "GPT");
  const options = { ...defaults };
  const benchmarks = [
    {
      id: "b-low",
      slug: "b-low",
      name: "GPT-5.4 (low)",
      provider: "OpenAI",
      scores: { general: 70, coding: 70, agentic: 70 },
    },
    {
      id: "b-high",
      slug: "b-high",
      name: "GPT-5.4 (high)",
      provider: "OpenAI",
      scores: { general: 80, coding: 80, agentic: 80 },
    },
  ];
  const structure = compare([gpt], benchmarks, options);
  assert.equal(structure.length, 2);
  const groups = buildGroups([gpt], [], structure, structure);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].models.length, 1);
  const leaves = groups[0].models[0].leaves;
  assert.equal(leaves.length, 2);
  assert.deepEqual(
    leaves.map((l) => l.thinking).sort(),
    ["high", "low"],
  );
  assert.ok(leaves.every((l) => l.included));
  assert.ok(leaves.every((l) => l.rowCount === 1));
  // Excluding one variant keeps the other visible and selected.
  const partial = buildGroups(
    [gpt],
    [pinRowId("gpt-5.4", "b-low")],
    structure.filter((r) => r.id !== pinRowId("gpt-5.4", "b-low")),
    structure,
  );
  const partialLeaves = partial[0].models[0].leaves;
  assert.equal(partial[0].state, "mixed");
  assert.equal(
    partialLeaves.find((l) => l.thinking === "low")?.included,
    false,
  );
  assert.equal(
    partialLeaves.find((l) => l.thinking === "low")?.rowCount,
    0,
  );
  assert.equal(
    partialLeaves.find((l) => l.thinking === "high")?.included,
    true,
  );
});

test("fable models appear in every applicable static registry", () => {
  for (const source of ["claude-code", "cursor", "windsurf", "aider"] as const) {
    const models = staticModels(source);
    const entries = staticEntries(source);
    const fable = models.filter((m) => m.family === "Claude Fable");
    assert.equal(fable.length, 2, source);
    for (const m of fable) {
      const entry = entries.find((e) => e.ids.includes(m.id))!;
      assert.ok(entry.rates, m.id);
      assert.equal(entry.rates?.input, 10);
      assert.equal(entry.rates?.output, 50);
      assert.equal(m.maxInputTokens, 1000000);
    }
    const groups = buildGroups(models, [], []);
    assert.ok(groups.some((g) => g.id === "Claude Fable"), source);
  }
  const fable51 = staticEntries("claude-code").find(
    (e) => e.ids[0] === "claude-code:claude-fable-5-1",
  )!;
  assert.equal(fable51.rates?.read, 0.25);
});

test("refreshed static registries keep namespaced identities and fix aliases", () => {
  // Gemini 3 Flash must no longer alias a different 3.5 Flash model.
  const flash = staticEntries("gemini-cli").find(
    (e) => e.ids[0] === "gemini-cli:gemini-3-flash",
  )!;
  assert.ok(!flash.benchmarkFamilies.includes("Gemini 3.5 Flash"));
  assert.ok(
    staticEntries("gemini-cli").some(
      (e) => e.ids[0] === "gemini-cli:gemini-3-5-flash",
    ),
  );
  // New workhorse models are present with verified USD rates.
  const sonnet46 = staticEntries("claude-code").find(
    (e) => e.ids[0] === "claude-code:claude-sonnet-4-6",
  )!;
  assert.deepEqual(sonnet46.rates, {
    input: 3,
    read: 0.3,
    write: 3.75,
    output: 15,
  });
  const terra = staticEntries("codex").find(
    (e) => e.ids[0] === "codex:gpt-5-6-terra",
  )!;
  assert.deepEqual(terra.rates, {
    input: 2,
    read: 0.2,
    write: 2.5,
    output: 12,
  });
  // Existing identities survive the refresh.
  for (const id of ["codex:gpt-5-5", "claude-code:claude-haiku-4-5"]) {
    const source = id.split(":")[0] as "codex" | "claude-code";
    assert.ok(
      staticModels(source).some((m) => m.id === id),
      id,
    );
  }
  // Static families group versions (e.g. Sonnet 4.5/4.6/5 share one family).
  const sonnetModels = staticModels("claude-code").filter(
    (m) => m.family === "Claude Sonnet",
  );
  assert.ok(sonnetModels.length >= 3);
  const groups = buildGroups(staticModels("claude-code"), [], []);
  const sonnet = groups.find((g) => g.id === "Claude Sonnet")!;
  assert.ok(sonnet.models.length >= 3);
});

test("codex registry tracks the current GPT-6/5.6 lineup, not retired models", () => {
  const entries = staticEntries("codex");
  const byId = (id: string) => entries.find((e) => e.ids[0] === id)!;
  assert.deepEqual(byId("codex:gpt-6-astra").rates, {
    input: 10,
    read: 1,
    write: 12.5,
    output: 50,
  });
  assert.deepEqual(byId("codex:gpt-5-6-sol").rates, {
    input: 4,
    read: 0.4,
    write: 5,
    output: 20,
  });
  assert.deepEqual(byId("codex:gpt-5-6-luna").rates, {
    input: 0.2,
    read: 0.02,
    write: 0.25,
    output: 1.2,
  });
  assert.deepEqual(byId("codex:gpt-6-astra").benchmarkFamilies, ["GPT-6 Astra"]);
  // Retired/deprecated Codex models are gone.
  for (const id of [
    "codex:gpt-5-4",
    "codex:gpt-5-4-mini",
    "codex:gpt-5-3-codex",
    "codex:gpt-5-1-codex-mini",
  ]) {
    assert.ok(!entries.some((e) => e.ids.includes(id)), id);
  }
  // The Pro-only Spark preview is listed without a verifiable rate.
  const spark = byId("codex:gpt-5-3-codex-spark");
  assert.equal(spark.rates, undefined);
  assert.ok(spark.benchmarkFamilies.includes("GPT-5.3-Codex-Spark"));
  const models = staticModels("codex");
  const families = new Set(models.map((m) => m.family));
  assert.ok(families.has("GPT-5.6"));
  assert.ok(families.has("GPT-6"));
});

test("sonnet 5 uses permanent $2/$10 pricing and opus 4.5 is retired", () => {
  const sonnet5 = staticEntries("claude-code").find(
    (e) => e.ids[0] === "claude-code:claude-sonnet-5",
  )!;
  assert.deepEqual(sonnet5.rates, {
    input: 2,
    read: 0.2,
    write: 2.5,
    output: 10,
  });
  assert.ok(
    !staticEntries("claude-code").some((e) =>
      e.ids.includes("claude-code:claude-opus-4-5"),
    ),
  );
  for (const source of ["cursor", "aider"] as const) {
    const sonnet = staticEntries(source).find((e) =>
      e.ids[0].endsWith("claude-sonnet-5"),
    )!;
    assert.deepEqual(sonnet.rates, {
      input: 2,
      read: 0.2,
      write: 2.5,
      output: 10,
    });
  }
});

test("gemini registry adds 3.8 flash and corrects 3.5 flash", () => {
  const entries = staticEntries("gemini-cli");
  const flash35 = entries.find(
    (e) => e.ids[0] === "gemini-cli:gemini-3-5-flash",
  )!;
  assert.deepEqual(flash35.rates, {
    input: 1.5,
    read: 0.15,
    write: null,
    output: 9,
  });
  const flash38 = entries.find(
    (e) => e.ids[0] === "gemini-cli:gemini-3-8-flash",
  )!;
  assert.deepEqual(flash38.rates, {
    input: 0.75,
    read: 0.075,
    write: null,
    output: 3.75,
  });
  assert.equal(flash38.expires, "2026-12-31");
});

test("cursor, windsurf, and aider track GPT-5.6 Terra", () => {
  for (const [source, id] of [
    ["cursor", "cursor-gpt-5-6-terra"],
    ["windsurf", "windsurf-gpt-5-6-terra"],
    ["aider", "aider-gpt-5-6-terra"],
  ] as const) {
    const entry = staticEntries(source).find((e) => e.ids[0] === `${source}:${id}`)!;
    assert.deepEqual(entry.rates, {
      input: 2,
      read: 0.2,
      write: 2.5,
      output: 12,
    });
    assert.deepEqual(entry.benchmarkFamilies, ["GPT-5.6 Terra"]);
  }
});
