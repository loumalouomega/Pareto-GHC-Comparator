// Render the real webview with a validated benchmark snapshot, without accessing credentials.
// This is a catalog preview; it does not claim to discover a user's Copilot models.
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
const require = createRequire(import.meta.url);
const { html } = require("../src/html.ts");
const { validSnapshot } = require("../src/api.ts");
const { catalog, catalogDate } = require("../src/catalog.ts");
const { compare } = require("../src/compare.ts");
const { recommend } = require("../src/recommend.ts");
const { defaults } = require("../src/types.ts");
if (!process.argv[2])
  throw new Error(
    "Usage: node --import tsx scripts/capture-screenshot.mjs <snapshot.json>",
  );
const snapshot = JSON.parse(await readFile(process.argv[2], "utf8"));
if (!validSnapshot(snapshot))
  throw new Error("A validated benchmark snapshot is required.");
// Explicit illustrative selections, equivalent to using the benchmark dropdown in model details.
const selections = [
  ["gpt-5.6-luna", "GPT-5.6 Luna (max)"],
  ["gpt-5.6-terra", "GPT-5.6 Terra (max)"],
  ["gpt-5.6-sol", "GPT-5.6 Sol (max)"],
  ["gpt-6-astra", "GPT-6 Astra (max)"],
  ["claude-haiku-4.5", "Claude 4.5 Haiku (Reasoning)"],
  ["claude-sonnet-5", "Claude Sonnet 5 (Adaptive Reasoning, Max Effort)"],
  ["claude-opus-5", "Claude Opus 5 (Adaptive Reasoning, Max Effort)"],
  ["gemini-3.8-flash", "Gemini 3.8 Flash (high)"],
  ["grok-4.6", "Grok 4.6 (xhigh)"],
  ["kimi-k3", "Kimi K3 (max)"],
];
const mappings = {};
const available = selections.map(([id, name]) => {
  const entry = catalog.find((e) => e.ids.includes(id));
  const benchmark = snapshot.models.find((m) => m.name === name);
  if (!entry || !benchmark) throw new Error(`Preview model missing: ${name}`);
  mappings[id] = benchmark.id;
  return { id, name: entry.name, family: id, maxInputTokens: 0 };
});
const options = structuredClone(defaults);
const state = {
  options,
  rows: compare(available, snapshot.models, options, mappings).sort(
    (a, b) => a.cost - b.cost,
  ),
  models: snapshot.models,
  selected: "gpt-5.6-terra",
  version: snapshot.version,
  fetchedAt: snapshot.fetchedAt,
  loading: false,
  hasKey: true,
  catalogDate,
  message:
    "Live benchmark preview · 10 catalog models with explicitly selected reasoning variants. Copilot account availability has not been queried.",
};
state.recommendation = recommend(state.rows, options);
state.profiles = [];
state.profileModified = false;
state.optionsRevision = 0;
const browser = await chromium.launch({
  executablePath: process.env.PARETO_CHROMIUM_PATH,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  await page.exposeBinding("hostMessage", async () => {
    await page.evaluate(
      (s) =>
        window.dispatchEvent(
          new MessageEvent("message", { data: { type: "state", state: s } }),
        ),
      state,
    );
  });
  await page.addInitScript(() => {
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => window.hostMessage(m),
    });
    window.addEventListener("DOMContentLoaded", () => {
      document.body.className = "vscode-dark";
    });
  });
  await page.route("https://pareto.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill(
      path === "/"
        ? {
            contentType: "text/html",
            body: html(
              "https://pareto.test/webview.js",
              "https://pareto.test/style.css",
              "https://pareto.test",
              "preview",
            ),
          }
        : {
            contentType: path.endsWith(".js")
              ? "application/javascript"
              : "text/css",
            body: await readFile(new URL(`../dist${path}`, import.meta.url)),
          },
    );
  });
  await page.goto("https://pareto.test/");
  await page.getByText("10 plotted / 10 models", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await mkdir(new URL("../docs", import.meta.url), { recursive: true });
  await page.screenshot({
    path: new URL("../docs/extension-preview.png", import.meta.url).pathname,
    fullPage: true,
  });
  console.log("Saved docs/extension-preview.png using live benchmark data.");
} finally {
  await browser.close();
}
