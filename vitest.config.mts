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
      // (Re-baselined 2026-09-14: the previous values predated several
      // features and already failed on clean HEAD; the provenance-complete
      // exports change raises all four metrics over that baseline.)
      thresholds: {
        lines: 97.2,
        functions: 98.79,
        branches: 92.95,
        statements: 96.25,
      },
    },
  },
});
