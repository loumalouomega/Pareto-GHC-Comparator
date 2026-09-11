import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { html } from "../src/html";
import { compare } from "../src/compare";
import { buildGroups } from "../src/groups";
import { recommend } from "../src/recommend";
import { changeProfile, profileModified } from "../src/profiles";
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
];
const available = [
  ["gpt-5-mini", "GPT-5 mini"],
  ["gpt-5.4", "GPT-5.4"],
  ["claude-haiku-4.5", "Claude Haiku 4.5"],
  ["gemini-3.8-flash", "Gemini 3.8 Flash"],
  ["unknown-model", "Unmapped model"],
].map(([id, name]) => ({ id, name, family: id, maxInputTokens: 1000000 }));
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
      recommendation: { modelIds: [], explanation: "" },
      profiles: [],
      profileModified: false,
      optionsRevision: 0,
      checklist: [],
      groups: [],
      freeSpotlight: { enabled: false, explanation: "" },
    };
    let profiles: ProfileStore = { version: 1, items: [] };
    const mappings: Record<string, string> = {};
    const excluded = new Set<string>();
    const messages: Record<string, unknown>[] = [];
    await page.exposeBinding("hostMessage", async (_, m) => {
      messages.push(m);
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
      const listed = state.source === "opencode" ? opencodeAvailable : available;
      state.rows = compare(listed, state.models, state.options, mappings, undefined, {
        excluded: [...excluded],
      });
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
        { ...state.options, filter: "" },
        mappings,
      );
      state.groups = buildGroups(listed as never, [...excluded], state.rows, structure);
      state.recommendation = recommend(state.rows, state.options);
      state.profiles = profiles.items.map(({ id, name }) => ({ id, name }));
      state.activeProfileId = profiles.activeId;
      state.profileModified = profileModified(profiles, state.options);
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
    await page.locator("#display-quadrant").uncheck();
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
    await page.locator("#display-quadrant").check();
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
    await mediumLeaf.uncheck();
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    expect(
      messages.some(
        (m) => m.type === "exclude" && m.id === "gpt-5.4::gpt-medium",
      ),
    ).toBeTruthy();
    await mediumLeaf.check();
    await expect(page.locator("#count")).toHaveText("5 plotted / 6 models");
    // The benchmark dropdown collapses the model to one manual choice.
    await mediumRow.click();
    await page.locator("#variant-search").fill("medium");
    await page.locator("#benchmark").focus();
    await page.locator("#benchmark").selectOption("gpt-medium");
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "User selected",
    );
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    await expect(page.locator("#benchmark")).toBeFocused();
    state.models = state.models.filter((b) => b.id !== "gpt-medium");
    await page.locator("#refresh").click();
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "Missing benchmark",
    );
    await page.locator("#benchmark").selectOption("");
    await expect(page.locator("#details .mapping-status")).toHaveText(
      "Exact match",
    );
    await page.locator("#variant-search").fill("");
    await page.locator("#variant-manual").check();
    await expect(page.locator("#benchmark optgroup")).toHaveCount(2);
    await page.locator("#variant-manual").uncheck();

    await page.locator("#profile-name").fill("Debugging");
    await page.locator("#profile-save").click();
    await expect(page.locator("#profile-state")).toHaveText(
      "Debugging · Saved",
    );
    await page.locator("#profile-save").click();
    await expect(page.locator("#status")).toContainText("already exists");
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
    await page.locator("#filter").fill("");
    await page.locator("#score-gap").fill("5");
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
    await expect(page.locator("#count")).toHaveText("1 plotted / 2 models");
    await expect(page.locator("#recommendation-result")).toContainText(
      "Kimi K2.7 Code",
    );
    await expect(page.locator("#recommendation-result")).toContainText("USD");
    await expect(page.locator("#rows tr")).toHaveCount(2);
    await expect(
      page.locator('#billing option[value="legacy"]'),
    ).toBeHidden();
    await expect(page.locator("canvas")).toHaveAttribute(
      "aria-label",
      /USD/,
    );
    await page.locator("#source").selectOption("copilot");
    await expect(page.locator("#billing")).toHaveValue("credits");
    await expect(page.locator("#eyebrow")).toHaveText(
      "PARETO / GITHUB COPILOT",
    );
    await expect(page.locator("#cost-heading")).toHaveText("AI credits / task");
    await expect(page.locator("#count")).toHaveText("4 plotted / 5 models");
    // Grouped selection: families contain models; bulk actions use one message.
    await expect(page.locator("#checklist .check-family")).toHaveCount(5);
    await expect(
      page.getByLabel("Filter models for selection"),
    ).toBeVisible();
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
    await page.getByLabel("Filter models", { exact: true }).fill("unmapped");
    await expect(page.locator("#count")).toHaveText("0 plotted / 1 models");
    await expect(page.locator("#empty")).toBeVisible();
    await page.getByLabel("Filter models", { exact: true }).fill("no-such-model");
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
    expect(errors).toEqual([]);
  });
