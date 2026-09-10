import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  testMatch: "webview.spec.ts",
  workers: 1,
  use: {
    headless: true,
    launchOptions: { executablePath: process.env.PARETO_CHROMIUM_PATH },
    viewport: { width: 1400, height: 1000 },
  },
  reporter: "list",
});
