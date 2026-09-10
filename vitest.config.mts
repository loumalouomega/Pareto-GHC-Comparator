import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit and mocked host tests. The Playwright browser suite in
    // test/webview.spec.ts stays on `playwright test` (see playwright.config.ts).
    include: ["test/*.test.ts"],
    exclude: ["test/webview.spec.ts", "node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Ratcheted at measured coverage: any drop fails `npm run test:coverage`.
      thresholds: {
        lines: 65,
        functions: 75,
        branches: 73,
        statements: 63,
      },
    },
  },
});
