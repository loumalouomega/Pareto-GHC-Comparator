import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { html } from "../src/html";
import { compare } from "../src/compare";
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
];
const available = [
  ["gpt-5-mini", "GPT-5 mini"],
  ["gpt-5.4", "GPT-5.4"],
  ["claude-haiku-4.5", "Claude Haiku 4.5"],
  ["gemini-3.8-flash", "Gemini 3.8 Flash"],
  ["unknown-model", "Unmapped model"],
].map(([id, name]) => ({ id, name, family: id, maxInputTokens: 1000000 }));
for (const theme of ["light", "dark", "high-contrast"])
  test(`chart, selection, filtering, and keyboard in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let state: ViewState = {
      options: structuredClone(defaults),
      rows: [],
      models: benchmarks,
      loading: false,
      message: "Benchmark data ready.",
      hasKey: true,
      version: "4.3",
      fetchedAt: Date.now(),
      catalogDate: "2026-09-10",
    };
    const mappings: Record<string, string> = {};
    const messages: Record<string, unknown>[] = [];
    await page.exposeBinding("hostMessage", async (_, m) => {
      messages.push(m);
      if (m.type === "options") state.options = m.options;
      if (m.type === "select") state.selected = m.id;
      if (m.type === "mapping") mappings[m.id] = m.benchmarkId;
      state.rows = compare(available, benchmarks, state.options, mappings);
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
    await page.screenshot({
      path: testInfo.outputPath(`${theme}.png`),
      fullPage: true,
    });
    await page.getByLabel("Filter models").fill("unmapped");
    await expect(page.locator("#count")).toHaveText("0 plotted / 1 models");
    await expect(page.locator("#empty")).toBeVisible();
    await page.getByLabel("Filter models").fill("no-such-model");
    await expect(page.locator("#rows tr")).toHaveCount(0);
    await page.getByLabel("Filter models").fill("");
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
