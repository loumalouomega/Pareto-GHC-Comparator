import {
  optionResult,
  comparisonDelta,
  overlayResult,
  type ComparisonStore,
} from "../src/comparison";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { html } from "../src/html";
import { compare, registryRateFor } from "../src/compare";
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
  medianSample: 3,
  premiumP90: 2,
  creditP90: 0.5,
  creditSample: 2,
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
      if (m.type === "scanUsage") {
        state.usage = structuredClone(usageFixture);
        state.usageWatching = true;
      }
      if (m.type === "clearUsage") {
        state.usage = null;
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
    await expect(page.locator("canvas")).toBeVisible();
    // Intelligence vs. cost per task is the default chart view.
    await expect(page.locator("#chart-title")).toHaveText(
      "Intelligence vs. cost per task",
    );
    await expect(page.locator("#cost-heading")).toHaveText("AI credits / task");
    await expect(page.locator("#tokens")).toBeHidden();
    await expect(page.locator("#display-chart")).toHaveValue("task");
    await expect(page.locator("canvas")).toHaveAttribute(
      "aria-label",
      /per task/,
    );
    // The most-attractive quadrant can be toggled without breaking the chart.
    await openTab("Settings");
    await page.locator("#display-quadrant").uncheck();
    await openTab("Tool analysis");
    await expect(page.locator("canvas")).toBeVisible();
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
      "Exact match",
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
      "Exact match",
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
      "Exact match",
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
    await expect(page.locator("#count")).toHaveText("1 plotted / 3 models");
    await expect(page.locator("#recommendation-result")).toContainText(
      "Kimi K2.7 Code",
    );
    await expect(page.locator("#recommendation-result")).toContainText("USD");
    await expect(page.locator("#rows tr")).toHaveCount(3);
    await expect(page.locator('#billing option[value="legacy"]')).toBeHidden();
    await expect(page.locator("canvas")).toHaveAttribute("aria-label", /USD/);

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
    await expect(page.locator("#include-all")).toHaveText("Select matching");
    await page.getByLabel("Filter models for selection").fill("");
    await expect(page.locator("#include-all")).toHaveText("Select all");
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
    await expect(page.locator("canvas")).toHaveAttribute(
      "aria-label",
      /linear cost scale/,
    );
    // Local usage section: empty state, scan message, and rendered aggregates.
    await expect(page.locator("#usage-summary")).toHaveText(
      /No local scan yet/,
    );
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
    await expect(page.locator("#usage-watching")).toHaveText(/Watching/);
    await expect(page.locator("#usage-pause")).toHaveText("Pause watching");
    await page.locator("#usage-pause").click();
    expect(messages.some((m) => m.type === "pauseUsage")).toBeTruthy();
    await expect(page.locator("#usage-pause")).toHaveText("Resume watching");
    await expect(page.locator("#usage-watching")).toHaveText(/paused/);
    await page.locator("#usage-pause").click();
    expect(messages.some((m) => m.type === "resumeUsage")).toBeTruthy();
    await expect(page.locator("#usage-pause")).toHaveText("Pause watching");
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
    await expect(page.locator("#usage-diagnostics")).toContainText(
      "1 malformed records",
    );
    await expect(page.locator("#usage-diagnostics")).toContainText(
      "1 stale contributions",
    );
    // Only-my-models filter, workload prefill, and budget suggestion.
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
    expect(errors).toEqual([]);
  });
