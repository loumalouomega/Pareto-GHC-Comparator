import {
  optionResult,
  comparisonDelta,
  overlayResult,
  type ComparisonStore,
} from "../src/comparison";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { html } from "../src/html";
import { compare, freeBar, registryRateFor } from "../src/compare";
import {
  exportPairSnapshot,
  exportSnapshot,
  type PairSideInput,
} from "../src/export";
import {
  importedViewState,
  parseImportedSnapshot,
} from "../src/snapshotImport";
import { mergeByokForm, parseByokFormStore } from "../src/byok";
import {
  historyScenarioPrefill,
  planRegistryDate,
  projectScenario,
} from "../src/plans";
import { buildGroups } from "../src/groups";
import { recommend } from "../src/recommend";
import { changeProfile, profileModified } from "../src/profiles";
import { normalizeUsageModelId, suggestBudget } from "../src/usage";
import type { ProfileStore } from "../src/types";
import { defaults, type ViewState, type Benchmark } from "../src/types";
const benchmarks: Benchmark[] = [
  {
    id: "mini",
    slug: "gpt-5-mini",
    name: "GPT-5 mini",
    provider: "OpenAI",
    scores: { general: 30, coding: 40, agentic: 20 },
  },
  {
    id: "gpt",
    slug: "gpt-5-4",
    name: "GPT-5.4 (xhigh)",
    provider: "OpenAI",
    scores: { general: 48, coding: 55, agentic: 40 },
  },
  {
    id: "claude",
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    scores: { general: 35, coding: 44, agentic: 25 },
  },
  {
    id: "gemini",
    slug: "gemini-3-8-flash",
    name: "Gemini 3.8 Flash",
    provider: "Google",
    scores: { general: 42, coding: 48, agentic: 33 },
  },
  {
    id: "kimi",
    slug: "kimi-k2-7-code",
    name: "Kimi K2.7 Code",
    provider: "Moonshot AI",
    scores: { general: 45, coding: 52, agentic: 30 },
  },
  // Free-tier Zen models for the OpenCode intelligence-bar UI test: each
  // name exactly matches its model so the benchmark resolves without aliases.
  {
    id: "zen-alpha",
    slug: "zen-alpha-free",
    name: "Zen Alpha Free",
    provider: "Zen",
    scores: { general: 30, coding: 32, agentic: 22 },
  },
  {
    id: "zen-beta",
    slug: "zen-beta-free",
    name: "Zen Beta Free",
    provider: "Zen",
    scores: { general: 22, coding: 24, agentic: 18 },
  },
  // Slug-only identifier match for "unknown-model" below: no catalog alias
  // hits it, so it only ever shows up as an unverified mapping suggestion.
  {
    id: "unmapped-bench",
    slug: "unknown-model",
    name: "Some Unrelated Benchmark",
    provider: "Test",
    scores: { general: 20, coding: 20, agentic: 20 },
  },
];
const available = [
  ["gpt-5-mini", "GPT-5 mini"],
  ["gpt-5.4", "GPT-5.4"],
  ["claude-haiku-4.5", "Claude Haiku 4.5"],
  ["gemini-3.8-flash", "Gemini 3.8 Flash"],
  ["unknown-model", "Unmapped model"],
].map(([id, name]) => ({ id, name, family: id, maxInputTokens: 1000000 }));
const usageFixture = {
  completeness: { observedPairs: 1, observedZeroPairs: 0, missingPairs: 1, estimatedPairs: 1, fallbackMultipliers: 1 },
  scannedAt: Date.now(),
  fileCount: 2,
  requestCount: 3,
  promptTokens: 300,
  outputTokens: 150,
  premiumEstimate: 6.5,
  estimatedTokens: 1,
  unknownModels: ["copilot/mystery"],
  dateRange: { from: Date.parse("2026-09-01"), to: Date.parse("2026-09-03") },
  medianPrompt: 150,
  medianOutput: 75,
  diagnostics: {
    malformed: 1,
    unsupported: 1,
    unreadable: 0,
    stale: 1,
    missingTokens: 1,
    estimatedTokens: 0,
  },
  schemaFingerprints: [
    {
      files: 1,
      fingerprint: {
        format: "jsonl" as const,
        version: 1 as const,
        lines: 2,
        kinds: ["3", "session.v2"],
        anchorSessionId: false,
        anchorCreationDate: false,
        anchorSelectedModel: false,
        envelopes: { anchor: false, append: false, result: false },
      },
    },
  ],
  medianSample: 3,
  premiumP90: 2,
  creditP90: 0.5,
  creditSample: 2,
  editors: [
    {
      editor: "VS Code",
      rootId: "code",
      requests: 2,
      promptTokens: 200,
      outputTokens: 100,
      premiumEstimate: 5,
      fileCount: 1,
    },
    {
      editor: "Cursor",
      rootId: "cursor",
      requests: 1,
      promptTokens: 100,
      outputTokens: 50,
      premiumEstimate: 1.5,
      fileCount: 1,
    },
  ],
  models: [
    {
      modelId: "copilot/gpt-5-mini",
      requests: 2,
      promptTokens: 200,
      outputTokens: 100,
      premiumEstimate: 0.66,
    },
    {
      modelId: "copilot/mystery",
      completeness: { observedPairs: 1, observedZeroPairs: 0, missingPairs: 0, estimatedPairs: 0, fallbackMultipliers: 1 },
      requests: 1,
      promptTokens: 100,
      outputTokens: 50,
      premiumEstimate: 1,
    },
  ],
  days: [
    {
      date: "2026-09-03",
      requests: 3,
      promptTokens: 300,
      outputTokens: 150,
      premiumEstimate: 6.5,
    },
  ],
  workspaces: [
    {
      id: "ws1",
      path: "/home/user/myrepo",
      requests: 2,
      promptTokens: 200,
      outputTokens: 100,
      premiumEstimate: 5,
    },
    {
      id: "deadbeef",
      path: "",
      requests: 1,
      promptTokens: 100,
      outputTokens: 50,
      premiumEstimate: 1.5,
    },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `ws-extra-${i}`,
      path: `/home/user/proj${i}`,
      requests: 1,
      promptTokens: 10,
      outputTokens: 5,
      premiumEstimate: 0.1,
    })),
  ],
};
/** Claude Code's ledger: tokens only, in its own tables, never a price. */
const claudeUsageFixture = {
  scannedAt: 1,
  fileCount: 2,
  requestCount: 3,
  totals: {
    requests: 3,
    inputTokens: 1200,
    outputTokens: 340,
    cacheReadTokens: 8000,
    cacheWriteTokens: 1500,
  },
  exclusions: { sidechain: 2, missingTokens: 0 },
  diagnostics: {
    malformed: 0,
    unsupported: 0,
    unreadable: 0,
    stale: 0,
    missingTokens: 0,
    estimatedTokens: 0,
  },
  unknownModels: [],
  dateRange: null,
  models: [
    {
      modelId: "claude-sonnet-4-5-20250929",
      requests: 3,
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 8000,
      cacheWriteTokens: 1500,
    },
  ],
  days: [
    {
      date: "2026-09-04",
      requests: 3,
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 8000,
      cacheWriteTokens: 1500,
    },
  ],
  workspaces: [
    {
      id: "proj-a",
      path: "/home/user/code/api",
      requests: 3,
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 8000,
      cacheWriteTokens: 1500,
    },
  ],
};
const opencodeAvailable = [
  {
    id: "opencode:opencode-go/kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    family: "kimi-k2",
    maxInputTokens: 262144,
    source: "opencode" as const,
    rates: { input: 0.95, read: 0.19, write: null, output: 4 },
  },
  {
    id: "opencode:openai/gpt-5.4#low",
    name: "GPT-5.4 (low)",
    family: "gpt",
    maxInputTokens: 922000,
    source: "opencode" as const,
  },
  // Matches the real Codex static registry entry codex:gpt-5-6-terra by
  // identifier, for the pricing-suggestion/BYOK-apply UI tests.
  {
    id: "opencode:openai/gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    family: "gpt",
    maxInputTokens: 1050000,
    source: "opencode" as const,
  },
  // Zero-cost Zen free-tier models for the intelligence-bar UI test.
  {
    id: "opencode:zen/alpha-free",
    name: "Zen Alpha Free",
    family: "zen",
    maxInputTokens: 200000,
    source: "opencode" as const,
    freeTier: true,
  },
  {
    id: "opencode:zen/beta-free",
    name: "Zen Beta Free",
    family: "zen",
    maxInputTokens: 200000,
    source: "opencode" as const,
    freeTier: true,
  },
];
for (const theme of ["light", "dark", "high-contrast"])
  test(`chart, selection, filtering, and keyboard in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let state: ViewState = {
      source: "copilot",
      options: structuredClone(defaults),
      rows: [],
      models: structuredClone(benchmarks),
      loading: false,
      message: "Benchmark data ready.",
      hasKey: true,
      version: "4.3",
      fetchedAt: Date.now(),
      catalogDate: "2026-09-10",
      staticRegistryDate: "2026-09-11",
      planRegistryDate,
      scenario: { status: "off" },
      scenarioPrefill: null,
      drift: {},
      byok: {},
      usage: null,
      usageWatching: false,
      usagePaused: false,
      budgetSuggestion: null,
      recommendation: { modelIds: [], explanation: "" },
      profiles: [],
      profileModified: false,
      optionsRevision: 0,
      checklist: [],
      groups: [],
      freeSpotlight: { enabled: false, explanation: "" },
      freeBar: [],
      watchlistAlerts: false,
    };
    let profiles: ProfileStore = { version: 1, items: [] };
    let mappings: Record<string, string> = {};
    let excluded = new Set<string>();
    let comparison: ComparisonStore | undefined;
    let single: ViewState;
    const messages: Record<string, unknown>[] = [];
    await page.exposeBinding("hostMessage", async (_, m) => {
      messages.push(m);
      const saveActive = () => {
        if (comparison?.enabled)
          comparison.sides[comparison.active] = {
            ...comparison.sides[comparison.active],
            options: structuredClone(state.options),
            mappings: structuredClone(mappings),
            excluded: { [state.source]: [...excluded] },
            selected: state.selected,
          };
      };
      const useActive = () => {
        const s = comparison!.sides[comparison!.active];
        state.options = structuredClone(s.options);
        state.source = s.options.source;
        state.selected = s.selected;
        mappings = structuredClone(s.mappings);
        excluded = new Set(s.excluded[s.options.source] ?? []);
        state.optionsRevision++;
      };
      if (m.type === "comparison") {
        saveActive();
        if (m.enabled === true) {
          single = structuredClone(state);
          comparison ??= {
            version: 1,
            enabled: true,
            active: "A",
            normalize: false,
            view: "side-by-side",
            sides: {
              A: {
                name: "Option A",
                options: structuredClone(state.options),
                mappings: { ...mappings },
                pins: {},
                excluded: { [state.source]: [...excluded] },
              },
              B: {
                name: "Option B",
                options: structuredClone(state.options),
                mappings: { ...mappings },
                pins: {},
                excluded: { [state.source]: [...excluded] },
              },
            },
          };
          comparison.enabled = true;
          useActive();
        }
        if (m.enabled === false && comparison) {
          comparison.enabled = false;
          state = structuredClone(single);
          state.optionsRevision++;
        }
        if (comparison?.enabled && m.active) {
          comparison.active = m.active;
          useActive();
        }
        if (comparison?.enabled && m.name)
          comparison.sides[comparison.active].name = m.name;
        if (comparison?.enabled && m.normalize !== undefined)
          comparison.normalize = m.normalize;
        if (comparison?.enabled && m.view !== undefined)
          comparison.view = m.view;
      }
      if (m.type === "target" && comparison?.enabled) {
        saveActive();
        comparison.active = m.side;
        useActive();
        m = m.action;
      }

      if (m.type === "options") state.options = m.options;
      if (m.type === "source") {
        state.source = m.source;
        state.options = {
          ...state.options,
          source: m.source,
          billing: m.source === "opencode" ? "usd" : "credits",
        };
        state.optionsRevision++;
      }
      if (m.type === "profile") {
        try {
          const result = changeProfile(profiles, state.options, m.change);
          profiles = result.store;
          // Mirror the host: applying a profile preserves chart display.
          state.options = { ...result.options, display: state.options.display };
          if (m.change.action === "apply") state.optionsRevision++;
          state.message = "Profile saved.";
        } catch (error) {
          state.message = (error as Error).message;
        }
      }
      if (m.type === "select") state.selected = m.id;
      if (m.type === "mapping") {
        // Mirror the host: mappings on auto-expanded rows collapse to an
        // override keyed by the base model id; "" resets to automatic.
        if (m.id.includes("::")) {
          const [base] = m.id.split("::");
          if (m.benchmarkId) {
            mappings[base] = m.benchmarkId;
            if (state.selected === m.id) state.selected = base;
          } else delete mappings[base];
        } else if (m.benchmarkId) mappings[m.id] = m.benchmarkId;
        else delete mappings[m.id];
      }
      if (m.type === "exclude") {
        if (m.excluded) excluded.add(m.id);
        else excluded.delete(m.id);
      }
      if (m.type === "excludeMany") {
        for (const id of m.ids) {
          if (m.excluded) excluded.add(id);
          else excluded.delete(id);
        }
      }
      if (m.type === "excludeAll") {
        const listedIds = (
          state.source === "opencode" ? opencodeAvailable : available
        ).map((a) => a.id);
        if (m.excluded) for (const id of listedIds) excluded.add(id);
        else excluded.clear();
      }
      // Mirror the host: known roots with existence and consent, exactly as
      // `usageSourceViews` reports them.
      state.usageSources = [
        {
          id: "code",
          label: "GitHub Copilot in VS Code",
          purpose: "Reads Copilot chat sessions VS Code stored on this machine. Nothing is uploaded.",
          detected: true,
          included: true,
          fileCount: 1,
          requests: 2,
        },
        {
          id: "cursor",
          label: "GitHub Copilot in Cursor",
          purpose: "Reads Copilot chat sessions Cursor stored on this machine. Nothing is uploaded.",
          detected: true,
          included: true,
          fileCount: 1,
          requests: 1,
        },
        {
          id: "vscodium",
          label: "GitHub Copilot in VSCodium",
          purpose: "Reads Copilot chat sessions VSCodium stored on this machine. Nothing is uploaded.",
          detected: true,
          included: false,
        },
        {
          id: "trae",
          label: "GitHub Copilot in Trae",
          purpose: "Reads Copilot chat sessions Trae stored on this machine. Nothing is uploaded.",
          detected: false,
          included: false,
        },
      ];
      if (m.type === "usageAddRoot") {
        const found = state.usageSources?.find((x) => x.id === m.id);
        if (found) {
          found.included = true;
          state.message = `Included ${found.label}. Rescanning local usage…`;
        }
      }
      if (m.type === "usageRemoveRoot") {
        const found = state.usageSources?.find((x) => x.id === m.id);
        if (found) {
          found.included = false;
          state.message = `Stopped reading ${found.label}.`;
        }
      }
      if (m.type === "scanUsage") {
        state.usage = structuredClone(usageFixture);
        state.claudeUsage = structuredClone(claudeUsageFixture);
        state.usageWatching = true;
      }
      if (m.type === "clearUsage") {
        state.usage = null;
        state.claudeUsage = null;
        state.usageWatching = false;
        state.usagePaused = false;
      }
      if (m.type === "pauseUsage") {
        state.usagePaused = true;
        state.usageWatching = false;
      }
      if (m.type === "resumeUsage") {
        state.usagePaused = false;
        state.usageWatching = true;
      }
      if (m.type === "setUsageRetention") {
        state.usageRetentionDays = m.days === 0 ? undefined : m.days;
      }
      // Test-only branches simulating a host-driven settings change (as from
      // VS Code Settings): the open controls must follow without reload.
      if (m.type === "__settingsChange") {
        state.usageRetentionDays = m.days === 0 ? undefined : m.days;
      }
      if (m.type === "__chartDefault") {
        state.options = {
          ...state.options,
          display: { ...state.options.display, chart: m.chart },
        };
        state.optionsRevision++;
      }
      // Test-only branch for the per-row pricing-age UI test: backdate the
      // catalog so a catalog-priced row reads stale without touching code.
      if (m.type === "__catalogDate") {
        state.catalogDate = String(m.date ?? "");
      }
      // Test-only branch for the drift-noise UI test: install a previous
      // snapshot version plus one noisy and one real drift entry.
      if (m.type === "__drift") {
        state.prevVersion = "4.2";
        state.prevFetchedAt = Date.parse("2026-09-01T00:00:00Z");
        state.drift = {
          gpt: { prevScore: 47.7, delta: 0.3, noisy: true },
          mini: { prevScore: 20, delta: 10, noisy: false },
        };
      }
      if (m.type === "watchlistAlerts") state.watchlistAlerts = m.enabled;
      if (m.type === "byok") {
        state.byok = mergeByokForm(state.byok, parseByokFormStore(m.rates));
      }
      if (m.type === "byokApply") {
        const results = (m.ids as string[]).map((id) => {
          const model = opencodeAvailable.find((a) => a.id === id);
          return {
            id,
            model,
            suggestion: model ? registryRateFor(model) : undefined,
          };
        });
        const bad = results.find((r) => !r.model || !r.suggestion);
        if (bad) {
          state.message = `No verified registry rate for ${bad.model?.name ?? bad.id}; enter a manual rate instead.`;
        } else {
          const next = { ...state.byok };
          for (const { id, suggestion } of results)
            next[id] = {
              rates: suggestion!.rates,
              ...(suggestion!.long ? { long: suggestion!.long } : {}),
              source: {
                kind: "registry" as const,
                registry: suggestion!.registry,
                registryId: suggestion!.registryId,
                registryDate: suggestion!.registryDate,
              },
            };
          state.byok = next;
          state.message = `Applied Codex registry rate (${results[0].suggestion!.registryDate}) to ${results.length} model${results.length === 1 ? "" : "s"}.`;
        }
      }
      if (m.type === "byokReset") {
        const next = { ...state.byok };
        for (const id of m.ids as string[]) delete next[id];
        state.byok = next;
      }
      const listed =
        state.source === "opencode" ? opencodeAvailable : available;
      const usedCounts = new Map<string, number>();
      if (state.usage) {
        for (const stat of state.usage.models) {
          const id = normalizeUsageModelId(stat.modelId);
          if (id) usedCounts.set(id, (usedCounts.get(id) ?? 0) + stat.requests);
        }
      }
      state.rows = compare(
        listed,
        state.models,
        state.options,
        mappings,
        undefined,
        {
          excluded: [...excluded],
          usedCounts,
          byok: state.byok,
        },
      );
      state.freeBar = freeBar(listed, state.models, state.options, mappings, undefined, {
        excluded: [...excluded],
        usedCounts,
        byok: state.byok,
      });
      state.budgetSuggestion = suggestBudget(
        state.usage,
        state.options.billing,
      );
      state.checklist = listed.map((a) => ({
        id: a.id,
        name: a.name,
        provider: "Test",
        included: !excluded.has(a.id),
        rowCount: state.rows.filter((r) => r.modelId === a.id).length,
      }));
      const structure = compare(
        listed,
        state.models,
        { ...state.options, filter: "", onlyMine: false, freeOnly: false },
        mappings,
      );
      state.groups = buildGroups(
        listed as never,
        [...excluded],
        state.rows,
        structure,
      );
      state.recommendation = recommend(state.rows, state.options);
      {
        const selectedRow = state.rows.find((r) => r.id === state.selected);
        const recommendedRow = state.recommendation.modelIds[0]
          ? state.rows.find((r) => r.id === state.recommendation.modelIds[0])
          : undefined;
        const firstComparableRow = state.rows.find(
          (r) => r.cost !== null && r.score !== null,
        );
        const rowOrigin = selectedRow
          ? "selected"
          : recommendedRow
            ? "recommended"
            : "first-comparable";
        state.scenario = projectScenario({
          scenario: state.options.scenario,
          options: state.options,
          row: selectedRow ?? recommendedRow ?? firstComparableRow,
          rowOrigin,
          catalogDate: state.catalogDate,
        });
      }
      state.scenarioPrefill = historyScenarioPrefill(state.usage);
      state.profiles = profiles.items.map(({ id, name }) => ({ id, name }));
      state.activeProfileId = profiles.activeId;
      state.profileModified = profileModified(profiles, state.options);
      if (comparison?.enabled) {
        saveActive();
        for (const side of ["A", "B"] as const) {
          comparison.sides[side].options.preset = state.options.preset;
          comparison.sides[side].options.display.chart =
            state.options.display.chart;
        }
        const calc = (side: "A" | "B") =>
          optionResult(
            comparison!.sides[side],
            comparison!.sides[side].options.source === "opencode"
              ? opencodeAvailable
              : available,
            state.models,
            {},
            usedCounts,
          );
        const sides = { A: calc("A"), B: calc("B") };
        state.comparison = {
          active: comparison.active,
          normalize: comparison.normalize,
          view: comparison.view,
          sides,
          delta: comparisonDelta(sides.A, sides.B, comparison.normalize),
          overlay:
            comparison.view === "overlay"
              ? overlayResult(sides.A, sides.B)
              : undefined,
        };
      } else delete state.comparison;
      await page.evaluate(
        (s) =>
          window.dispatchEvent(
            new MessageEvent("message", { data: { type: "state", state: s } }),
          ),
        state,
      );
    });
    await page.addInitScript(
      ({ theme }) => {
        (window as any).acquireVsCodeApi = () => ({
          postMessage: (m: unknown) => (window as any).hostMessage(m),
        });
        window.addEventListener("DOMContentLoaded", () => {
          document.body.className = `vscode-${theme}`;
          const light = theme === "light";
          for (const [key, value] of Object.entries({
            "--vscode-editor-background": light ? "#ffffff" : "#181b22",
            "--vscode-editor-foreground": light ? "#222222" : "#eeeeee",
            "--vscode-descriptionForeground": light ? "#555555" : "#bbbbbb",
            "--vscode-panel-border": light ? "#dddddd" : "#626262",
            "--vscode-input-background": light ? "#ffffff" : "#282d36",
            "--vscode-input-foreground": light ? "#222222" : "#eeeeee",
            "--vscode-dropdown-background": light ? "#ffffff" : "#282d36",
            "--vscode-dropdown-foreground": light ? "#222222" : "#eeeeee",
            "--vscode-textLink-foreground": light ? "#165ca0" : "#80b6ff",
          }))
            document.body.style.setProperty(key, value);
        });
      },
      { theme },
    );
    await page.route("https://pareto.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/")
        await route.fulfill({
          contentType: "text/html",
          body: html(
            "https://pareto.test/webview.js",
            "https://pareto.test/style.css",
            "https://pareto.test",
            "testnonce",
          ),
        });
      else
        await route.fulfill({
          contentType: path.endsWith(".js")
            ? "application/javascript"
            : "text/css",
          body: await readFile(`dist${path}`),
        });
    });
    await page.goto("https://pareto.test/");
    // Secondary features live on other tabs; a control must be visible to use.
    const openTab = (name: string) =>
      page.getByRole("tab", { name, exact: true }).click();
    // Tabs follow the ARIA pattern: one panel visible, arrow/Home/End keys
    // move. Tool analysis (the single-tool view) is first in the tab order
    // and stays the tab open by default; Compare tools (opt-in comparison)
    // is second — easy to find without being the default.
    await expect(
      page.getByRole("tab", { name: "Tool analysis" }),
    ).toHaveAttribute("aria-selected", "true");
    // Emoji are icon placeholders: visible, but hidden from accessible names.
    await expect(page.locator("#tab-compare .emoji")).toHaveText("📊");
    await expect(page.locator("#tab-settings .emoji")).toHaveText("⚙️");
    await expect(page.locator("#panel-settings")).toBeHidden();
    await page.getByRole("tab", { name: "Tool analysis" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Compare tools" }),
    ).toBeFocused();
    await expect(page.locator("#panel-tools")).toBeVisible();
    await expect(page.locator("#panel-compare")).toBeHidden();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Plan & budget" }),
    ).toBeFocused();
    await expect(page.locator("#panel-plan")).toBeVisible();
    await expect(page.locator("#panel-compare")).toBeHidden();
    await page.keyboard.press("End");
    await expect(page.locator("#panel-settings")).toBeVisible();
    await page.keyboard.press("Home");
    await expect(page.locator("#panel-compare")).toBeVisible();
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    await expect(page.locator("#chart")).toBeVisible();
    // Intelligence vs. cost per task is the default chart view.
    await expect(page.locator("#chart-title")).toHaveText(
      "Intelligence vs. cost per task",
    );
    await expect(page.locator("#cost-heading")).toHaveText("AI credits / task");
    await expect(page.locator("#tokens")).toBeHidden();
    await expect(page.locator("#display-chart")).toHaveValue("task");
    await expect(page.locator("#chart")).toHaveAttribute(
      "aria-label",
      /per task/,
    );
    // The most-attractive quadrant can be toggled without breaking the chart.
    await openTab("Settings");
    await page.locator("#display-quadrant").uncheck();
    await openTab("Tool analysis");
    await expect(page.locator("#chart")).toBeVisible();
    await expect
      .poll(() =>
        messages.some(
          (m) =>
            m.type === "options" &&
            (m.options as { display: { quadrant: boolean } }).display
              .quadrant === false,
        ),
      )
      .toBeTruthy();
    await openTab("Settings");
    await page.locator("#display-quadrant").check();
    await openTab("Tool analysis");
    const model = page.getByRole("button", { name: "GPT-5.4", exact: true });
    await model.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#details")).toContainText(
      "Tested variant: GPT-5.4 (xhigh)",
    );
    await expect(model).toBeFocused();
    await page.getByRole("button", { name: "Copy model name" }).click();
    expect(
      messages.some((m) => m.type === "copy" && m.id === "gpt-5.4"),
    ).toBeTruthy();
    await expect(page.locator("#recommendation-result")).toContainText(
      "Gemini 3.8 Flash",
    );
    await page.locator("#budget").fill("0");
    await expect(page.locator("#recommendation-result")).toContainText(
      "No displayed model fits",
    );
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    await page.locator("#budget").fill("2");
    await expect(page.locator("#recommendation-result")).toContainText(
      "GPT-5.4",
    );
    await page.locator("#recommendation-mode").selectOption("nearBest");
    await page.locator("#score-gap").fill("10");
    await expect(page.locator("#recommendation-result")).toContainText(
      "Gemini 3.8 Flash",
    );
    await expect(page.locator("#recommendation-result")).toContainText(
      "at least 38",
    );

    // Multiple matching variants expand automatically into thinking rows with
    // one checkbox each, and disappearance never substitutes another variant.
    state.models.push({
      ...benchmarks[1],
      id: "gpt-medium",
      name: "GPT-5.4 (medium)",
      scores: { general: 40, coding: 49, agentic: 30 },
    });
    await page.locator("#refresh").click();
    await expect(page.locator("#count")).toHaveText("5 plotted / 6 models");
    await expect(page.locator("#checklist")).toContainText("(medium)");
    const mediumRow = page.getByRole("button", { name: /GPT-5\.4.*medium/ });
    await mediumRow.click();
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "Inferred match (unverified)",
    );
    await expect(page.locator("#details")).toContainText(
      "Tested variant: GPT-5.4 (medium)",
    );
    await expect(page.locator("#details")).toContainText(
      "once per matching benchmark variant",
    );
    const mediumLeaf = page
      .locator(".check-leaf-row", { hasText: "(medium)" })
      .locator("input");
    await openTab("Settings");
    await mediumLeaf.uncheck();
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    expect(
      messages.some(
        (m) => m.type === "exclude" && m.id === "gpt-5.4::gpt-medium",
      ),
    ).toBeTruthy();
    await mediumLeaf.check();
    await openTab("Tool analysis");
    await expect(page.locator("#count")).toHaveText("5 plotted / 6 models");
    // The benchmark dropdown stages a choice; nothing applies until the
    // explicit Apply mapping button is clicked.
    await mediumRow.click();
    // Mapping controls sit behind "More details", which then stays open.
    await expect(page.locator("#details .more-details")).not.toHaveAttribute(
      "open",
      "",
    );
    await page.locator("#details summary").click();
    await page.locator("#variant-search").fill("medium");
    await page.locator("#benchmark").focus();
    await page.locator("#benchmark").selectOption("gpt-medium");
    await expect(page.locator("#details")).toContainText(
      "Will map to GPT-5.4 (medium)",
    );
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "Inferred match (unverified)",
    );
    await page.getByRole("button", { name: "Apply mapping" }).click();
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "User selected",
    );
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    state.models = state.models.filter((b) => b.id !== "gpt-medium");
    await page.locator("#refresh").click();
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "Missing benchmark",
    );
    await expect(page.locator("#details")).toContainText(
      'Previously selected benchmark "gpt-medium" is no longer available',
    );
    // Reset to automatic is its own explicit action; it applies immediately.
    await page.getByRole("button", { name: "Reset to automatic" }).click();
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "Inferred match (unverified)",
    );
    await page.locator("#variant-search").fill("");
    await page.locator("#variant-manual").check();
    await expect(page.locator("#benchmark optgroup")).toHaveCount(2);
    await page.locator("#variant-manual").uncheck();

    await openTab("Plan & budget");
    await page.locator("#profile-name").fill("Debugging");
    await page.locator("#profile-save").click();
    await expect(page.locator("#profile-state")).toHaveText(
      "Debugging · Saved",
    );
    await page.locator("#profile-save").click();
    await expect(page.locator("#status")).toContainText("already exists");
    await openTab("Tool analysis");
    // Workload token inputs live in the workload chart view.
    await page.locator("#display-chart").selectOption("workload");
    await expect(page.locator("#chart-title")).toHaveText(
      "Quality vs. usage cost",
    );
    await expect(page.locator("#cost-heading")).toHaveText("AI credits");
    await expect(page.locator("#tokens")).toBeVisible();
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    await page.locator("#input").fill("5000");
    await page.locator("#preset").selectOption("agentic");
    await page.locator("#recommendation-mode").selectOption("budget");
    await page.locator("#billing").selectOption("legacy");
    await page.locator("#plan").selectOption("proPlus");
    await page.locator("#budget").fill("7");
    await expect(page.locator("#profile-state")).toContainText("Modified");
    await page.locator("#filter").fill("gpt");
    await openTab("Plan & budget");
    await page.locator("#profile-apply").click();
    await expect(page.locator("#profile-apply")).toBeFocused();
    await expect(page.locator("#input")).toHaveValue("1000");
    await expect(page.locator("#preset")).toHaveValue("general");
    await expect(page.locator("#billing")).toHaveValue("credits");
    await expect(page.locator("#plan")).toHaveValue("pro");
    await expect(page.locator("#recommendation-mode")).toHaveValue("nearBest");
    await expect(page.locator("#score-gap")).toHaveValue("10");
    await expect(page.locator("#budget")).toHaveValue("2");
    await expect(page.locator("#filter")).toHaveValue("gpt");
    await expect(page.locator("#profile-state")).toHaveText(
      "Debugging · Saved",
    );
    await openTab("Tool analysis");
    await page.locator("#filter").fill("");
    await page.locator("#score-gap").fill("5");
    await openTab("Plan & budget");
    await expect(page.locator("#profile-update")).toBeEnabled();
    await page.locator("#profile-update").click();
    await expect(page.locator("#profile-state")).toHaveText(
      "Debugging · Saved",
    );
    await page.locator("#profile-name").fill("Refactoring");
    await page.locator("#profile-rename").click();
    await expect(page.locator("#profile-state")).toHaveText(
      "Refactoring · Saved",
    );
    await page.locator("#profile-delete").click();
    await expect(page.locator("#profile-state")).toHaveText("Custom workload");
    await expect(page.locator("#score-gap")).toHaveValue("5");
    await openTab("Tool analysis");
    await page.screenshot({
      path: testInfo.outputPath(`${theme}.png`),
      fullPage: true,
    });
    // Source switching resets billing and relabels every cost surface.
    await page.locator("#display-chart").selectOption("task");
    await expect(page.locator("#chart-title")).toHaveText(
      "Intelligence vs. cost per task",
    );
    await page.locator("#source").selectOption("opencode");
    await expect(page.locator("#billing")).toHaveValue("usd");
    await expect(page.locator("#eyebrow")).toHaveText("PARETO / OPENCODE");
    await expect(page.locator("#cost-heading")).toHaveText("USD / task");
    await expect(page.locator("#count")).toHaveText("3 plotted / 5 models");
    await expect(page.locator("#recommendation-result")).toContainText(
      "Kimi K2.7 Code",
    );
    await expect(page.locator("#recommendation-result")).toContainText("USD");
    await expect(page.locator("#rows tr")).toHaveCount(5);
    await expect(page.locator('#billing option[value="legacy"]')).toBeHidden();
    await expect(page.locator("#chart")).toHaveAttribute("aria-label", /USD/);

    // Pricing assistance: a same-identifier static-registry rate is offered,
    // unverified, for an unpriced provider-billed model — independent of its
    // (here unresolved) benchmark mapping, and never applied automatically.
    await page
      .getByRole("button", { name: "GPT-5.6 Terra", exact: true })
      .click();
    // Copy now offers the client's own -m provider/model reference (the id
    // no client actually accepts is the display name, previously copied).
    await expect(
      page.getByRole("button", { name: "Copy model ID" }),
    ).toBeVisible();
    await expect(page.locator("#details")).toContainText(
      'openai/gpt-5.6-terra — opencode run -m <id> / "model" in opencode.json',
    );
    await page.getByRole("button", { name: "Copy model ID" }).click();
    expect(
      messages.some(
        (m) => m.type === "copy" && m.id === "opencode:openai/gpt-5.6-terra",
      ),
    ).toBeTruthy();
    await expect(page.locator("#details")).toContainText("Pricing: Unresolved");
    await expect(page.locator("#details")).toContainText(
      "Codex registry lists GPT-5.6 Terra (codex:gpt-5-6-terra)",
    );
    await expect(page.locator("#details")).toContainText("Not applied");
    // The model is already listed in the BYOK form (still editable/unresolved)
    // but has no provenance or Remove control until a rate is applied.
    await expect(page.locator("#byok-table")).toContainText("GPT-5.6 Terra");
    await expect(page.locator("#byok-table")).not.toContainText(
      "from Codex registry",
    );
    await page
      .getByRole("button", { name: "Apply rate to this model" })
      .click();
    await expect(page.locator("#details")).toContainText(
      "Pricing: User BYOK from Codex registry, 2026-09-11",
    );
    // Fixing the earlier gap: a BYOK-applied model stays visible (with its
    // provenance and a Remove control) instead of disappearing from the form.
    await expect(page.locator("#byok-table")).toContainText("GPT-5.6 Terra");
    await expect(page.locator("#byok-table")).toContainText(
      "from Codex registry, 2026-09-11",
    );
    // Removing it (from the details panel) returns the model to unresolved;
    // it stays listed in the form, now without provenance again.
    await page.getByRole("button", { name: "Remove BYOK rate" }).click();
    await expect(page.locator("#details")).toContainText("Pricing: Unresolved");
    await expect(page.locator("#byok-table")).toContainText("GPT-5.6 Terra");
    await expect(page.locator("#byok-table")).not.toContainText(
      "from Codex registry",
    );

    await page.locator("#source").selectOption("copilot");
    await expect(page.locator("#billing")).toHaveValue("credits");
    await expect(page.locator("#eyebrow")).toHaveText(
      "PARETO / GITHUB COPILOT",
    );
    await expect(page.locator("#cost-heading")).toHaveText("AI credits / task");
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    // Grouped selection: families contain models; bulk actions use one message.
    await openTab("Settings");
    await expect(page.locator("#checklist .check-family")).toHaveCount(5);
    await expect(page.getByLabel("Filter models for selection")).toBeVisible();
    await page.getByLabel("Filter models for selection").fill("gpt-5.4");
    await expect(page.locator("#checklist .check-family")).toHaveCount(1);
    await expect(page.locator("#include-all")).toContainText("Select matching");
    await page.getByLabel("Filter models for selection").fill("");
    await expect(page.locator("#include-all")).toContainText("Select all");
    const familyBox = page
      .locator(".check-family-row input[type=checkbox]")
      .first();
    await familyBox.uncheck();
    expect(
      messages.some((m) => m.type === "excludeMany" || m.type === "exclude"),
    ).toBeTruthy();
    await expect(page.locator("#count")).toHaveText("3 plotted / 4 models");
    await page.locator("#include-all").click();
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    await openTab("Tool analysis");
    // Keyboard traversal of the chart: focus it, walk the plotted points with
    // the arrow keys, and select one with Enter. Every step is announced, and
    // the announcement carries the chart's own facts.
    await page.locator("#chart").focus();
    await expect(page.locator("#chart-status")).toContainText("index points at");
    const first = await page.locator("#chart-status").textContent();
    await page.keyboard.press("ArrowRight");
    const second = await page.locator("#chart-status").textContent();
    expect(second).not.toEqual(first);
    await expect(page.locator("#chart-status")).toContainText("index points at");
    // End jumps to the last plotted model, Home back to the first.
    await page.keyboard.press("End");
    const lastStatus = await page.locator("#chart-status").textContent();
    expect(lastStatus).not.toEqual(second);
    await page.keyboard.press("Home");
    expect(await page.locator("#chart-status").textContent()).toEqual(first);
    // Enter selects the focused point exactly as a click does.
    const focusedName = (await page.locator("#chart-status").textContent())!
      .split(":")[0];
    await page.keyboard.press("Enter");
    await expect(page.locator("#details")).toContainText(focusedName);
    // The screen-reader description of the chart carries the same facts as the
    // drawing: frontier membership and the most-attractive quadrant.
    const described = await page.locator("#chart-desc").textContent();
    expect(described).toMatch(/index points at/);
    expect(described).toMatch(/Pareto frontier/);
    // The table repeats the chart's quadrant rule rather than leaving it in the
    // drawing alone — and only while the region is actually shaded, so the two
    // can never disagree.
    await expect(page.locator("#rows")).toContainText(
      "Dominated by Gemini 3.8 Flash",
    );
    await expect(page.locator("#rows")).not.toContainText(
      "Most attractive quadrant",
    );
    await openTab("Settings");
    await page.locator("#display-quadrant").check();
    await openTab("Tool analysis");
    await expect(page.locator("#rows")).toContainText(
      "Most attractive quadrant",
    );
    await expect(page.locator("#chart-desc")).toContainText(
      "most attractive quadrant",
    );
    await openTab("Settings");
    await page.locator("#display-quadrant").uncheck();
    await openTab("Tool analysis");
    await expect(page.locator("#rows")).not.toContainText(
      "Most attractive quadrant",
    );
    // The encodings are documented rather than implied.
    await expect(page.locator("#chart-hint")).toContainText(
      "ring around the point",
    );
    await expect(page.locator("#chart-hint")).toContainText(
      "colour-blind-safe palette",
    );

    await page.getByLabel("Filter models", { exact: true }).fill("unmapped");
    await expect(page.locator("#count")).toHaveText("0 plotted / 1 models");
    await expect(page.locator("#empty")).toBeVisible();
    // An unverified identifier-slug mapping suggestion, and applying it never
    // touches pricing (this model has no catalog entry, so cost stays null).
    await page
      .getByRole("button", { name: "Unmapped model", exact: true })
      .click();
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "Missing benchmark",
    );
    await expect(page.locator("#details")).toContainText(
      "Suggested (identifier match — unverified)",
    );
    await expect(page.locator(".mapping-suggestions")).toContainText(
      "Some Unrelated Benchmark",
    );
    await page
      .locator(".mapping-suggestions")
      .getByRole("button", { name: "Apply" })
      .click();
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "User selected",
    );
    await expect(page.locator("#details")).toContainText(
      "Tested variant: Some Unrelated Benchmark",
    );
    // A benchmark choice never establishes a price: cost stays unresolved.
    await expect(page.locator("#details")).toContainText(
      "— estimated AI credits",
    );
    await page.getByRole("button", { name: "Reset to automatic" }).click();
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "Missing benchmark",
    );
    await page
      .getByLabel("Filter models", { exact: true })
      .fill("no-such-model");
    await expect(page.locator("#rows tr")).toHaveCount(0);
    await page.getByLabel("Filter models", { exact: true }).fill("");
    await page.locator("#display-chart").selectOption("workload");
    await expect(page.locator("#tokens")).toBeVisible();
    await page
      .getByRole("combobox", { name: "Billing", exact: true })
      .selectOption("legacy");
    await expect(page.getByLabel("Annual plan")).toBeVisible();
    await expect(page.locator("#tokens")).toBeHidden();
    await page
      .getByRole("combobox", { name: "Billing", exact: true })
      .selectOption("credits");
    await page.getByLabel("Uncached input", { exact: true }).fill("0");
    await page.getByLabel("Output (including reasoning)").fill("0");
    await expect(
      page.locator("#rows tr").first().locator("td").nth(2),
    ).toHaveText("0");
    await expect(page.locator("#chart")).toHaveAttribute(
      "aria-label",
      /linear cost scale/,
    );
    // Local usage section: empty state, scan message, and rendered aggregates.
    await expect(page.locator("#usage-summary")).toHaveText(
      /No local scan yet/,
    );
    // Before any scan there is no Claude ledger, so its card stays hidden
    // rather than rendering an empty table.
    await expect(page.locator("#claude-usage-card")).toBeHidden();
    await openTab("Usage");
    await page.locator("#usage-scan").click();
    expect(messages.some((m) => m.type === "scanUsage")).toBeTruthy();
    await expect(page.locator("#usage-summary")).toContainText("3 requests");
    await expect(page.locator("#usage-models")).toContainText(
      "copilot/gpt-5-mini",
    );
    await expect(page.locator("#usage-days")).toContainText("2026-09-03");
    await expect(page.locator("#usage-workspaces")).toContainText("myrepo");
    await expect(page.locator("#usage-workspaces")).not.toContainText(
      "/home/user/myrepo",
    );
    // Claude Code is a separate ledger in its own card, hidden until a Claude
    // summary exists, and its figures are never folded into the Copilot tables.
    await expect(page.locator("#claude-usage-card")).toBeVisible();
    await expect(page.locator("#claude-usage-summary")).toContainText(
      "3 turns across 2 Claude Code transcripts",
    );
    await expect(page.locator("#claude-usage-summary")).toContainText(
      "8,000 cache read",
    );
    await expect(page.locator("#claude-usage-models")).toContainText(
      "claude-sonnet-4-5-20250929",
    );
    await expect(page.locator("#claude-usage-days")).toContainText("2026-09-04");
    // A workspace with no cwd names its own reason, not Copilot's.
    await expect(page.locator("#claude-usage-workspaces")).toContainText("api");
    // Subagent turns are stated, not silently dropped.
    await expect(page.locator("#claude-usage-exclusions")).toContainText(
      "2 subagent turns held out",
    );
    // No price column anywhere in the Claude tables.
    await expect(page.locator("#claude-usage-models")).not.toContainText("Premium");
    // The Copilot tables are unchanged by any of this.
    await expect(page.locator("#usage-summary")).toContainText("3 requests");
    await expect(page.locator("#usage-models")).not.toContainText("claude-");
    await expect(page.locator("#usage-workspaces")).toContainText(
      "deadbeef · unmapped workspace",
    );
    await expect(page.locator("#usage-workspaces tr")).toHaveCount(12);
    await page.locator("#usage-full-paths").check();
    await expect(page.locator("#usage-workspaces")).toContainText(
      "/home/user/myrepo",
    );
    await page.locator("#usage-full-paths").uncheck();
    await expect(page.locator("#usage-workspaces")).not.toContainText(
      "/home/user/myrepo",
    );
    await expect(page.locator("#usage-unknown")).toContainText(
      "copilot/mystery",
    );
    // Per-editor split: each included editor is named with its own totals, and
    // the caption says the merged tables span more than one of them.
    await expect(page.locator("#usage-editors")).toContainText("By editor");
    await expect(page.locator("#usage-editors")).toContainText("VS Code");
    await expect(page.locator("#usage-editors")).toContainText("Cursor");
    await expect(page.locator("#usage-editors tbody tr")).toHaveCount(2);
    await expect(page.locator("#usage-editors-note")).toContainText(
      "span 2 editors",
    );
    // Sources: what is included, what was found but not included (with its
    // stated purpose and its own Include control), and a per-source removal.
    await expect(page.locator("#usage-sources")).toContainText(
      "Included: GitHub Copilot in VS Code, GitHub Copilot in Cursor",
    );
    await expect(page.locator("#usage-sources")).toContainText(
      "Other editors found on this machine",
    );
    await expect(page.locator("#usage-sources li")).toHaveCount(1);
    await expect(page.locator("#usage-sources")).toContainText("VSCodium");
    await expect(page.locator("#usage-sources")).toContainText(
      "Nothing is uploaded",
    );
    // An editor that was not found is never offered.
    await expect(page.locator("#usage-sources")).not.toContainText("Trae");
    await page
      .getByRole("button", { name: "Include GitHub Copilot in VSCodium" })
      .click();
    expect(
      messages.some(
        (m) => m.type === "usageAddRoot" && (m as any).id === "vscodium",
      ),
    ).toBeTruthy();
    await expect(page.locator("#usage-sources li")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Stop reading GitHub Copilot in Cursor" })
      .click();
    expect(
      messages.some(
        (m) => m.type === "usageRemoveRoot" && (m as any).id === "cursor",
      ),
    ).toBeTruthy();
    await expect(page.locator("#usage-watching")).toHaveText(/Watching/);
    await expect(page.locator("#usage-pause")).toContainText("Pause watching");
    await page.locator("#usage-pause").click();
    expect(messages.some((m) => m.type === "pauseUsage")).toBeTruthy();
    await expect(page.locator("#usage-pause")).toContainText("Resume watching");
    await expect(page.locator("#usage-watching")).toHaveText(/paused/);
    await page.locator("#usage-pause").click();
    expect(messages.some((m) => m.type === "resumeUsage")).toBeTruthy();
    await expect(page.locator("#usage-pause")).toContainText("Pause watching");
    await expect(page.locator("#usage-retention")).toHaveValue("");
    await page.locator("#usage-retention").fill("30");
    // The retention input applies on change (blur), not per keystroke, since
    // applying it triggers a rescan.
    await page.locator("#usage-title").click();
    expect(
      messages.some(
        (m) => m.type === "setUsageRetention" && (m as any).days === 30,
      ),
    ).toBeTruthy();
    await page.locator("#usage-show").click();
    expect(messages.some((m) => m.type === "showUsageData")).toBeTruthy();
    await expect(page.locator("#usage-retention")).toHaveValue("30");
    await page.locator("#usage-retention").fill("");
    await page.locator("#usage-title").click();
    expect(
      messages.some(
        (m) => m.type === "setUsageRetention" && (m as any).days === 0,
      ),
    ).toBeTruthy();
    // A host-driven settings change (as from VS Code Settings) applies to
    // the open controls without reload: the inputs follow the posted state.
    await page.evaluate(() =>
      (window as any).hostMessage({ type: "__settingsChange", days: 45 }),
    );
    await expect(page.locator("#usage-retention")).toHaveValue("45");
    await page.evaluate(() =>
      (window as any).hostMessage({ type: "__chartDefault", chart: "workload" }),
    );
    await expect(page.locator("#display-chart")).toHaveValue("workload");
    await expect(page.locator("#usage-diagnostics")).toContainText(
      "1 malformed records",
    );
    await expect(page.locator("#usage-diagnostics")).toContainText(
      "1 stale contributions",
    );
    // Only-my-models filter, workload prefill, and budget suggestion.
    await expect(page.locator("#usage-diagnostics")).toContainText("0 observed zero pairs");
    await expect(page.locator("#usage-diagnostics")).toContainText("1 missing-token requests");
    await expect(page.locator("#usage-diagnostics")).toContainText("don't match any known Copilot chat schema");
    await expect(page.locator("#usage-diagnostics")).toContainText("session.v2");
    await expect(page.locator("#usage-summary")).toContainText("Unknown model — default multiplier applied");
    await expect(page.locator("#usage-models")).toContainText("Unknown model — default multiplier applied (1 requests)");
    await expect(page.locator("#usage-prefill-note")).toContainText(
      "Median 150 prompt + 75 output",
    );
    const selectionLeaves = await page
      .locator(".check-leaf-row")
      .allTextContents();
    await openTab("Settings");
    await page.locator("#only-mine").check();
    await expect(page.locator("#count")).toHaveText("1 plotted / 1 models");
    await expect(page.locator("#rows")).toContainText("2 used");
    expect(
      (await page.locator(".check-leaf-row").allTextContents()).length,
    ).toBe(selectionLeaves.length);
    await page.locator("#only-mine").uncheck();
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");

    await openTab("Tool analysis");
    // Monthly spending scenario: plan-aware what-if projection, kept
    // separate from local history and per-task/workload estimates.
    await page.getByRole("button", { name: "GPT-5.4", exact: true }).click();
    await expect(
      page.locator('#scenario-plan option[value="copilot-free"]'),
    ).toHaveJSProperty("disabled", true);
    await openTab("Plan & budget");
    await page.locator("#scenario-plan").selectOption("copilot-pro");
    await page.locator("#scenario-requests-low").fill("100");
    await page.locator("#scenario-requests-high").fill("400");
    await expect(page.locator("#scenario-result")).toContainText(
      "Plan: Copilot Pro",
    );
    await expect(page.locator("#scenario-result")).toContainText(
      "Requests / month: 100–400 · your input",
    );
    await expect(page.locator("#scenario-result")).toContainText(
      "Estimated monthly total:",
    );
    await expect(page.locator("#scenario-notes")).toContainText("not a bill");
    // A Custom plan reveals its fields immediately, without a round trip.
    await page.locator("#scenario-plan").selectOption("custom");
    await expect(page.locator("#scenario-custom")).toBeVisible();
    await expect(page.locator("#scenario-result")).toContainText(
      "Enter the custom plan",
    );
    await page.locator("#scenario-custom-fee").fill("5");
    await page.locator("#scenario-custom-allowance").fill("200");
    await page.locator("#scenario-custom-overage").fill("0.02");
    await expect(page.locator("#scenario-result")).toContainText("your input");
    // History prefill: fills the requests inputs and labels their origin;
    // editing them by hand afterward drops the history label again.
    await page.locator("#scenario-plan").selectOption("copilot-pro");
    await page.locator("#scenario-prefill").click();
    await expect(page.locator("#scenario-prefill-note")).toContainText(
      "Observed history:",
    );
    await expect(page.locator("#scenario-requests-low")).not.toHaveValue("100");
    await expect(page.locator("#scenario-result")).toContainText(
      "observed history",
    );
    await page.locator("#scenario-requests-low").fill("1");
    await expect(page.locator("#scenario-result")).toContainText(
      "· your input",
    );
    await page.locator("#scenario-plan").selectOption("none");

    await openTab("Tool analysis");
    await page.locator("#usage-prefill").click();
    await expect(page.locator("#input")).toHaveValue("150");
    await expect(page.locator("#output")).toHaveValue("75");
    await expect(page.locator("#budget-suggestion")).toContainText("0.5");
    await page.locator("#budget-apply").click();
    await expect(page.locator("#budget")).toHaveValue("0.5");
    await openTab("Usage");
    await page.locator("#usage-clear").click();
    expect(messages.some((m) => m.type === "clearUsage")).toBeTruthy();
    await expect(page.locator("#usage-summary")).toHaveText(
      /No local scan yet/,
    );
    // Compare tools has its own dedicated tab — but comparison stays off
    // until explicitly turned on, so opening it does nothing by itself.
    await openTab("Compare tools");
    await expect(page.locator(".comparison-panel")).toHaveCount(0);
    await page.locator("#comparison-enabled").check();
    await expect(page.locator(".comparison-panel")).toHaveCount(2);
    // Tool A/Tool B pick each side's source directly, from this tab, without
    // switching Editing to it first — and doing so switches Editing to that
    // side as a side effect, same as selecting a row in its panel does.
    await expect(page.locator("#comparison-source-a")).toHaveValue("copilot");
    await expect(page.locator("#comparison-source-b")).toHaveValue("copilot");
    await page.locator("#comparison-source-b").selectOption("opencode");
    await expect(page.locator("#comparison-active")).toHaveValue("B");
    await page.locator("#comparison-name").fill("Other provider");
    await page.locator("#comparison-name").press("Tab");
    await expect(page.locator(".comparison-panel").nth(1)).toContainText(
      "Other provider",
    );
    await expect(page.locator("#comparison-delta")).toContainText(
      "Different billing units",
    );
    await expect(page.locator(".comparison-panel").first()).toContainText(
      "GitHub Copilot",
    );
    // Optional USD equivalents: off by default, and only meaningful text
    // (rate, allowance treatment, native/unavailable) once toggled on.
    await expect(page.locator(".comparison-panel").first()).not.toContainText(
      "$0.01/AI credit",
    );
    await page.locator("#comparison-normalize").check();
    await expect(page.locator("#comparison-delta")).toContainText(
      "USD equivalent Δ",
    );
    await expect(page.locator(".comparison-panel").first()).toContainText(
      "$0.01/AI credit",
    );
    await expect(page.locator(".comparison-panel").nth(1)).toContainText(
      "native, no conversion",
    );
    await page.locator("#comparison-normalize").uncheck();
    await expect(page.locator(".comparison-panel").first()).not.toContainText(
      "$0.01/AI credit",
    );
    // Each comparison option carries its own spending scenario, shown per
    // panel, with a separate delta sentence that never bounds the difference.
    await expect(page.locator(".comparison-panel").first()).toContainText(
      "Spending scenario: off",
    );
    await page.locator("#comparison-active").selectOption("A");
    await openTab("Plan & budget");
    await page.locator("#scenario-plan").selectOption("copilot-pro");
    await page.locator("#scenario-requests-low").fill("10");
    await page.locator("#scenario-requests-high").fill("10");
    await openTab("Compare tools");
    await expect(page.locator(".comparison-panel").first()).toContainText(
      "Spending scenario: Copilot Pro",
    );
    await expect(page.locator("#comparison-delta")).toContainText(
      "Monthly scenario",
    );
    await expect(page.locator("#comparison-delta")).toContainText(
      "Scenario off or unavailable on at least one option.",
    );
    await openTab("Plan & budget");
    await page.locator("#scenario-plan").selectOption("none");
    await openTab("Compare tools");
    // Wait for the debounced round trip to settle (an assertion, not a raw
    // timeout) before the comparison-enabled toggle below, so a late state
    // update can't land between that click and Playwright's next sample.
    await expect(page.locator(".comparison-panel").first()).toContainText(
      "Spending scenario: off",
    );
    // Overlay view: one shared chart instead of two per-side ones. A (Copilot,
    // credits) and B (Other provider, USD) bill differently, so the axis
    // converts to a USD equivalent — the per-side info cards and tables stay.
    // The controls and the results they affect now live on the same tab.
    await page.locator("#comparison-view").selectOption("overlay");
    await expect(page.locator(".comparison-panel")).toHaveCount(2);
    await expect(page.locator(".comparison-panel canvas")).toHaveCount(0);
    await expect(page.locator("#comparison-chart-overlay")).toHaveCount(1);
    await expect(page.locator("#comparison-overlay")).toBeVisible();
    await expect(page.locator("#comparison-chart-overlay")).toBeVisible();
    await expect(page.locator("#comparison-overlay")).toContainText(
      "USD equivalent",
    );
    // The per-side tables stay in overlay view, so row selection still works.
    await page
      .locator(".comparison-panel")
      .first()
      .getByRole("button", { name: "GPT-5.4", exact: true })
      .click();
    await page.locator("#comparison-view").selectOption("side-by-side");
    await expect(page.locator("#comparison-overlay")).toBeHidden();
    await expect(page.locator(".comparison-panel canvas")).toHaveCount(2);
    await openTab("Settings");
    await page.locator("#export-png").click();
    expect(
      messages.some(
        (m) => m.type === "target" && (m.action as any)?.type === "exportPng",
      ),
    ).toBeTruthy();
    await openTab("Compare tools");
    await page.setViewportSize({ width: 700, height: 1000 });
    const a = await page.locator(".comparison-panel").first().boundingBox(),
      b = await page.locator(".comparison-panel").nth(1).boundingBox();
    expect(b!.y).toBeGreaterThan(a!.y + a!.height);
    // Side A is already active (selected above for the scenario checks);
    // re-selecting the same value here would redundantly resend a
    // "comparison" message right before the toggle below, racing its
    // render against this click (selectOption dispatches change events
    // even for a same-value reselect, unlike a real user re-picking it).
    await openTab("Tool analysis");
    await expect(page.locator("#source")).toHaveValue("copilot");
    await openTab("Compare tools");
    await page.locator("#comparison-enabled").uncheck();
    await expect(page.locator("#comparison-panels")).toBeHidden();
    await openTab("Tool analysis");
    // Free-tier intelligence bar: hidden outside OpenCode, score-descending
    // ranking below the Pareto chart once the OpenCode source is selected.
    await expect(page.locator("#free-bar-wrap")).toBeHidden();
    await page.locator("#source").selectOption("opencode");
    await expect(page.locator("#free-bar-wrap")).toBeVisible();
    await expect(page.locator("#free-bar-title")).toHaveText(
      "Best free options · General index",
    );
    await expect(page.locator("#free-bar-list li")).toHaveCount(2);
    expect(await page.locator("#free-bar-list li").allTextContents()).toEqual([
      "Zen Alpha Free: 30 points · Pareto frontier",
      "Zen Beta Free: 22 points",
    ]);
    // Clicking a bar selects that row on the host (canvas center lands on
    // the second bar of the two-row chart).
    // The bar carries the host-computed ranking (order, scores, frontier
    // flags) with an accessible list; row selection itself goes through the
    // same covered table buttons, so no pixel-targeted canvas click here.
    await expect(page.locator("#free-bar")).toHaveAttribute(
      "aria-label",
      /2 free-tier models ranked by general score/,
    );
    await page.locator("#source").selectOption("copilot");
    await expect(page.locator("#free-bar-wrap")).toBeHidden();
    // Custom comparison tray: manual picks render head-to-head on the
    // current task and cost basis; a pick that leaves the view stays listed
    // until removed, never silently swapped.
    await expect(page.locator("#custom-empty")).toHaveText(
      /No models picked yet/,
    );
    await page.locator('#rows input[type="checkbox"]').first().check();
    await expect(page.locator("#custom-rows tr")).toHaveCount(1);
    await expect(page.locator("#custom-chart-wrap")).toBeVisible();
    await expect(page.locator("#custom-empty")).toBeEmpty();
    await page.getByRole("button", { name: "GPT-5.4", exact: true }).click();
    await page
      .getByRole("button", { name: "☆ Pick for custom comparison" })
      .click();
    await expect(page.locator("#custom-rows tr")).toHaveCount(2);
    await page.locator("#filter").fill("no-such-model-xyz");
    await expect(page.locator("#custom-rows")).toContainText(
      "No longer in view",
    );
    await page.locator("#filter").fill("");
    await expect(page.locator("#custom-rows tr")).toHaveCount(2);
    await page.locator("#custom-clear").click();
    await expect(page.locator("#custom-rows tr")).toHaveCount(0);
    await expect(page.locator("#custom-empty")).toHaveText(
      /No models picked yet/,
    );
    // Per-row pricing age: a catalog-priced row shows no flag while its
    // source is fresh, then a stale notice that auto-opens More details
    // once the catalog date goes stale — independent of the footer alert.
    await page.getByRole("button", { name: "GPT-5.4", exact: true }).click();
    await expect(page.locator("#details")).toContainText(
      "Pricing: Copilot catalog (2026-09-10)",
    );
    await expect(page.locator("#details")).not.toContainText(
      "pricing source is",
    );
    await page.evaluate(() =>
      (window as any).hostMessage({ type: "__catalogDate", date: "2020-01-01" }),
    );
    await expect(page.locator("#details")).toContainText(
      "pricing source is",
    );
    await expect(page.locator("#details")).toContainText("may be stale");
    await expect(page.locator("#details .more-details")).toHaveAttribute(
      "open",
      "",
    );
    await page.evaluate(() =>
      (window as any).hostMessage({ type: "__catalogDate", date: "2026-09-10" }),
    );
    await expect(page.locator("#details")).not.toContainText(
      "pricing source is",
    );
    // Drift noise: a sub-threshold delta reads as measurement noise in the
    // table cell and details, while a larger delta stays verbatim. No
    // per-model interval is ever shown — the details say so explicitly.
    await page.evaluate(() => (window as any).hostMessage({ type: "__drift" }));
    await expect(page.locator("#rows")).toContainText("(+0.3, noise)");
    await expect(page.locator("#rows")).toContainText("(+10)");
    await expect(page.locator("#rows")).not.toContainText("(+10, noise)");
    await expect(page.locator("#details")).toContainText(
      "Within measurement noise",
    );
    await expect(page.locator("#details")).toContainText(
      "no per-model confidence interval",
    );
    // Workload sensitivity: breakpoint ranges recomputed from the current
    // tokens, labelled as a what-if sweep — never measured history.
    await page.locator("#input").fill("1000");
    await page.locator("#output").fill("1000");
    await expect(page.locator("#sensitivity-rows tr")).not.toHaveCount(0);
    await expect(page.locator("#sensitivity-note")).toContainText(
      "2,000 tokens",
    );
    await expect(page.locator("#sensitivity-card")).toContainText(
      "not measured cost",
    );
    await page.locator("#output").fill("9000");
    await expect(page.locator("#sensitivity-note")).toContainText("10,000 tokens");
    await page.locator("#filter").fill("no-such-model-xyz");
    await expect(page.locator("#sensitivity-note")).toContainText(
      "at least two comparable models",
    );
    await page.locator("#filter").fill("");
    await expect(page.locator("#sensitivity-rows tr")).not.toHaveCount(0);
    // Watchlist opt-in: the Settings checkbox posts the toggle the host
    // validates (never wrapped to a comparison side — see send()).
    await openTab("Settings");
    await expect(page.locator("#watchlist-alerts")).not.toBeChecked();
    await page.locator("#watchlist-alerts").check();
    await expect
      .poll(() =>
        messages.some(
          (m) => m.type === "watchlistAlerts" && (m as any).enabled === true,
        ),
      )
      .toBeTruthy();
    await openTab("Tool analysis");
    expect(errors).toEqual([]);
  });

test("an imported snapshot renders read-only with its own provenance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const messages: Record<string, unknown>[] = [];
  // The state the host would send: a real exported snapshot, reopened through
  // the real importer, so the browser sees exactly the shipped contract.
  const liveRows = compare(available, benchmarks, structuredClone(defaults));
  const comparable = liveRows.filter((r) => r.cost !== null && r.score !== null);
  const dominated = comparable.find((r) => !r.frontier)!;
  const single = exportSnapshot(
    comparable,
    structuredClone(defaults),
    new Set(["gpt-5.4"]),
    {
      source: "copilot",
      preset: "coding",
      billing: "credits",
      catalogDate: "2026-01-05",
      staticRegistryDate: "2026-01-06",
      planRegistryDate: "2026-01-07",
      version: "4.0",
      fetchedAt: Date.parse("2026-01-08T10:00:00Z"),
      scenario: { status: "off" },
    },
  );
  const pairSide = (over: Partial<PairSideInput>): PairSideInput => ({
    side: "A",
    name: "Copilot",
    options: structuredClone(defaults),
    rows: liveRows,
    recommendation: recommend(liveRows, structuredClone(defaults)),
    scenario: { status: "off" },
    costNormalization: { status: "off" },
    availabilityNote: "",
    pricingNote: "",
    discoveryError: "",
    ...over,
  });
  const pair = exportPairSnapshot(
    [
      pairSide({ side: "A" }),
      pairSide({ side: "B", name: "Codex" }),
    ],
    {
      catalogDate: "2026-01-05",
      staticRegistryDate: "2026-01-06",
      planRegistryDate: "2026-01-07",
      version: "4.0",
      fetchedAt: Date.parse("2026-01-08T10:00:00Z"),
      normalize: false,
      usdCostDelta: null,
    },
  );
  const importedView = (text: string, fileName: string) => {
    const parsed = parseImportedSnapshot(text);
    if (!parsed.ok) throw new Error(parsed.failure.message);
    return importedViewState(
      {
        snapshot: parsed.snapshot,
        selected: {},
        filter: "",
        display: structuredClone(defaults.display),
      },
      {
        options: structuredClone(defaults),
        hasKey: true,
        watchlistAlerts: false,
        fileName,
      },
    );
  };
  let current: ViewState | undefined;
  const post = async (state: ViewState) => {
    current = state;
    await page.evaluate(
      (s) =>
        window.dispatchEvent(
          new MessageEvent("message", { data: { type: "state", state: s } }),
        ),
      state,
    );
  };
  await page.exposeBinding("hostMessage", async (_, m) => {
    messages.push(m);
    if (m.type === "__state") await post(m.state as ViewState);
    // Mirror the host's imported-mode navigation: a row selection updates the
    // read-only view and re-renders it, touching nothing else.
    if (m.type === "select" && current?.imported)
      await post({ ...current, selected: m.id as string });
  });
  await page.addInitScript(() => {
    (window as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => (window as any).hostMessage(m),
      getState: () => undefined,
      setState: () => {},
    });
  });
  await page.route("https://pareto.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      await route.fulfill({
        contentType: "text/html",
        body: html(
          "https://pareto.test/webview.js",
          "https://pareto.test/style.css",
          "https://pareto.test",
          "testnonce",
        ),
      });
    else
      await route.fulfill({
        contentType: path.endsWith(".js")
          ? "application/javascript"
          : "text/css",
        body: await readFile(`dist${path}`),
      });
  });
  await page.goto("https://pareto.test/");
  const send = (state: unknown) =>
    page.evaluate(
      (s) => (window as any).hostMessage({ type: "__state", state: s }),
      state,
    );

  await send(importedView(single, "comparison.json"));
  // The banner names the file, its export date, and says it is not live.
  await expect(page.locator("#snapshot-banner")).toBeVisible();
  await expect(page.locator("#snapshot-detail")).toContainText(
    "comparison.json",
  );
  await expect(page.locator("#snapshot-detail")).toContainText(
    "single-option snapshot exported",
  );
  await expect(page.locator("#snapshot-detail")).toContainText(
    "This is historical data, not live results",
  );
  await expect(page.locator("#snapshot-basis")).toContainText(
    "Costs are shown in AI credits on the exported task basis",
  );
  await expect(page.locator("#snapshot-basis")).toContainText(
    "catalog 2026-01-05",
  );
  await expect(page.locator("#snapshot-limits")).toContainText("Read-only");
  // Only the tab that renders it stays, and the live header actions go.
  await expect(page.locator("#tab-compare")).toBeVisible();
  await expect(page.locator("#tab-tools")).toBeHidden();
  await expect(page.locator("#tab-plan")).toBeHidden();
  await expect(page.locator("#tab-usage")).toBeHidden();
  await expect(page.locator("#tab-settings")).toBeHidden();
  await expect(page.locator("#header-actions")).toBeHidden();
  // Live controls are disabled, the display-only ones stay usable.
  await expect(page.locator("#source")).toBeDisabled();
  await expect(page.locator("#preset")).toBeDisabled();
  await expect(page.locator("#billing")).toBeDisabled();
  await expect(page.locator("#display-chart")).toBeDisabled();
  await expect(page.locator("#display-chart")).toHaveValue("task");
  // The workload inputs are locked: a snapshot's costs were priced on its own
  // token mix, and editing them here would relabel those numbers.
  await expect(page.locator("#input")).toBeDisabled();
  await expect(page.locator("#output")).toBeDisabled();
  await expect(page.locator("#display-scale")).toBeEnabled();
  await expect(page.locator("#display-sort")).toBeEnabled();
  await expect(page.locator("#filter")).toHaveValue("", { timeout: 5000 });
  // The exported rows, dates, and version replace the live ones.
  await expect(page.locator("#count")).toContainText("plotted");
  await expect(page.locator("#catalog")).toContainText(
    "Catalog dated 2026-01-05",
  );
  await expect(page.locator("#provenance")).toContainText("Index v4.0");
  // The sensitivity card explains itself instead of sweeping a snapshot.
  await expect(page.locator("#sensitivity-note")).toContainText(
    "Unavailable for an imported snapshot",
  );
  // Row details stay read-only: no copy, no pin, no mapping controls, and the
  // dominance wording never claims a row is incomparable.
  await page.getByRole("button", { name: "GPT-5.4", exact: true }).click();
  await expect(page.locator("#details")).toContainText(
    "On the Pareto frontier when this snapshot was exported",
  );
  await expect(page.locator("#details")).not.toContainText("Copy model");
  await expect(page.locator("#details")).not.toContainText("Pin as separate");
  await expect(page.locator("#details .more-details")).toHaveCount(1);
  await page.locator("#details .more-details summary").click();
  await expect(page.locator("#details")).toContainText("Benchmark at export");
  await expect(page.locator("#details")).toContainText("Pricing at export");
  await expect(page.locator("#details")).not.toContainText("Apply mapping");
  await expect(page.locator("#details")).not.toContainText("Pin");
  await page
    .getByRole("button", { name: dominated.name, exact: true })
    .click();
  await expect(page.locator("#details")).toContainText(
    "Dominated by another exported model",
  );
  // The text filter still narrows the exported rows, and it posts a draft the
  // host treats as view-only.
  await page.locator("#filter").fill("gpt-5-mini");
  await expect
    .poll(() =>
      messages.some(
        (m) =>
          m.type === "options" &&
          (m.options as { filter: string }).filter === "gpt-5-mini",
      ),
    )
    .toBeTruthy();
  // A two-option snapshot reopens on the Compare tools tab, still read-only.
  await send(importedView(pair, "pair.json"));
  await expect(page.locator("#snapshot-detail")).toContainText("pair.json");
  await expect(page.locator("#snapshot-detail")).toContainText(
    "two-option snapshot",
  );
  await expect(page.locator("#snapshot-detail")).toContainText("A: Copilot");
  await expect(page.locator("#snapshot-basis")).toContainText("per side");
  await expect(page.locator("#tab-tools")).toBeVisible();
  await expect(page.locator("#tab-compare")).toBeHidden();
  await expect(page.locator("#panel-tools")).toBeVisible();
  await expect(page.locator("#comparison-panels")).toContainText("A: Copilot");
  await expect(page.locator("#comparison-panels")).toContainText("B: Codex");
  await expect(page.locator("#comparison-delta")).toContainText("B minus A");
  await expect(page.locator("#comparison-enabled")).toBeDisabled();
  await expect(page.locator("#comparison-name")).toBeDisabled();
  await expect(page.locator("#filter")).toBeDisabled();
  // Back to live data restores every live-only surface: the tab bar, the header
  // actions, and the controls the read-only view locked — including after the
  // extra renders a row selection caused above. A control the live view keeps
  // disabled for its own reasons (the comparison pickers, while comparison is
  // off) stays disabled, so the restore is faithful rather than blanket-enable.
  await page.locator("#snapshot-back").click();
  await expect
    .poll(() => messages.some((m) => m.type === "importExit"))
    .toBeTruthy();
  const live = structuredClone(current!) as ViewState;
  delete live.imported;
  await send(live);
  await expect(page.locator("#snapshot-banner")).toBeHidden();
  await expect(page.locator("#header-actions")).toBeVisible();
  for (const tab of ["Compare tools", "Plan & budget", "Usage", "Settings"])
    await expect(
      page.getByRole("tab", { name: tab, exact: true }),
    ).toBeVisible();
  await expect(page.locator("#source")).toBeEnabled();
  await expect(page.locator("#display-chart")).toBeEnabled();
  await expect(page.locator("#input")).toBeEnabled();
  await expect(page.locator("#filter")).toBeEnabled();
  await expect(page.locator("#comparison-name")).toBeDisabled();
  expect(errors).toEqual([]);
});
