import { test } from "vitest";
import assert from "node:assert/strict";
import {
  parseRetentionSetting,
  resolveSettings,
  storedChartView,
  type ConfigurationFacade,
} from "../src/settings";

const facade = (
  values: Record<string, unknown>,
  explicit: string[] = Object.keys(values),
): ConfigurationFacade => ({
  get: (key) => values[key],
  inspect: (key) => ({
    key,
    globalValue: explicit.includes(key) ? values[key] : undefined,
  }),
});

test("unconfigured settings leave every stored value in charge", () => {
  const resolved = resolveSettings(facade({}));
  assert.deepEqual(resolved, {
    watchOnScan: { configured: false, value: true },
    retentionDays: { configured: false, value: undefined },
    chartView: { configured: false, value: "task" },
  });
});

test("explicit values override, including explicit defaults", () => {
  const resolved = resolveSettings(
    facade({
      "usage.watchOnScan": false,
      "usage.retentionDays": 0,
      "chart.defaultView": "workload",
    }),
  );
  assert.deepEqual(resolved.watchOnScan, { configured: true, value: false });
  // An explicit 0 means unlimited, and still counts as configured.
  assert.deepEqual(resolved.retentionDays, {
    configured: true,
    value: undefined,
  });
  assert.deepEqual(resolved.chartView, {
    configured: true,
    value: "workload",
  });
  // Numeric strings from settings.json parse the same way.
  assert.deepEqual(
    resolveSettings(facade({ "usage.retentionDays": "30" })).retentionDays,
    { configured: true, value: 30 },
  );
});

test("explicit but invalid values fall back to stored state", () => {
  const resolved = resolveSettings(
    facade({
      "usage.watchOnScan": "yes",
      "usage.retentionDays": -5,
      "chart.defaultView": "log",
    }),
  );
  assert.deepEqual(resolved.watchOnScan, { configured: false, value: true });
  assert.deepEqual(resolved.retentionDays, {
    configured: false,
    value: undefined,
  });
  assert.deepEqual(resolved.chartView, { configured: false, value: "task" });
  // Non-scalar retention values (boolean, null, objects) are not settings.
  assert.deepEqual(
    resolveSettings(facade({ "usage.retentionDays": true })).retentionDays,
    { configured: false, value: undefined },
  );
  // Out-of-range and non-numeric retention values never parse.
  assert.equal(parseRetentionSetting(3651), undefined);
  assert.equal(parseRetentionSetting("abc"), undefined);
  assert.equal(parseRetentionSetting(""), undefined);
  assert.equal(parseRetentionSetting("30"), 30);
  assert.equal(parseRetentionSetting(45), 45);
});

test("stored chart detection only trusts explicit task/workload choices", () => {
  assert.equal(storedChartView(undefined), undefined);
  assert.equal(storedChartView({}), undefined);
  assert.equal(storedChartView({ display: {} }), undefined);
  assert.equal(storedChartView({ display: { chart: "log" } }), undefined);
  assert.equal(
    storedChartView({ display: { chart: "workload" } }),
    "workload",
  );
});
