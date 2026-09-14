import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  testMatch: "webview.spec.ts",
  workers: 1,
  // Absorb the occasional interaction flake (e.g. a click landing before a
  // re-render settles) without masking a real, consistent failure.
  retries: process.env.CI ? 2 : 0,
  use: {
    headless: true,
    launchOptions: { executablePath: process.env.PARETO_CHROMIUM_PATH },
    viewport: { width: 1400, height: 1000 },
  },
  reporter: "list",
});
