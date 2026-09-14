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
      // src/extension.ts is exercised through a bundled mocked-host test and
      // reports 0% under v8; it stays excluded as unmeasured (see docs/testing.md).
      exclude: ["src/extension.ts", "node_modules", "dist"],
      // Ratcheted at measured coverage: any drop fails `npm run test:coverage`.
      thresholds: {
        lines: 98.3,
        functions: 99.3,
        branches: 93.1,
        statements: 97.2,
      },
    },
  },
});
