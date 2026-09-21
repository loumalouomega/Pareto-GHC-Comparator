import type { ChartType } from "./types";

/**
 * VS Code `paretoGhc.*` settings (see `contributes.configuration` in
 * `package.json`). Settings mirror the stored state they override: an
 * explicitly configured value wins, otherwise the existing global-state
 * value applies unchanged. Explicit but invalid values are treated as
 * unconfigured (stored state applies) rather than failing.
 *
 * This module is pure and vscode-free: callers pass a minimal
 * `{ get, inspect }` facade over `vscode.workspace.getConfiguration`, which
 * keeps every precedence rule unit-testable without the extension host.
 */
export type SettingValue<T> = { configured: boolean; value: T };
export interface ResolvedSettings {
  /** Start watching after a consented scan. Explicit Pause/Resume always win. */
  watchOnScan: SettingValue<boolean>;
  /** Retention window in days; undefined means unlimited. */
  retentionDays: SettingValue<number | undefined>;
  /** Default chart cost basis for views without a saved chart choice. */
  chartView: SettingValue<ChartType>;
}
export interface ConfigurationFacade {
  get(key: string): unknown;
  inspect(
    key: string,
  ):
    | {
        globalValue?: unknown;
        workspaceValue?: unknown;
        workspaceFolderValue?: unknown;
      }
    | undefined;
}
export const maxSettingsRetentionDays = 3650;

const isConfigured = (facade: ConfigurationFacade, key: string): boolean => {
  const inspected = facade.inspect(key);
  return (
    inspected !== undefined &&
    (inspected.globalValue !== undefined ||
      inspected.workspaceValue !== undefined ||
      inspected.workspaceFolderValue !== undefined)
  );
};

/** Tolerant retention parse: 0/"" means unlimited; anything else invalid. */
export function parseRetentionSetting(value: unknown): number | undefined {
  const days =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : undefined;
  if (days === undefined) return undefined;
  if (
    !Number.isSafeInteger(days) ||
    days < 0 ||
    days > maxSettingsRetentionDays
  )
    return undefined;
  return days === 0 ? undefined : days;
}

const inRetentionRange = (days: number): boolean =>
  Number.isSafeInteger(days) &&
  days >= 0 &&
  days <= maxSettingsRetentionDays;
const isRetentionScalar = (value: unknown): boolean => {
  if (typeof value === "number") return inRetentionRange(value);
  if (typeof value === "string" && value.trim() !== "")
    return inRetentionRange(Number(value.trim()));
  return false;
};

/** Raw stored options carried an explicit chart choice. */
export function storedChartView(raw: unknown): ChartType | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const display = (raw as { display?: unknown }).display;
  if (!display || typeof display !== "object") return undefined;
  const chart = (display as { chart?: unknown }).chart;
  return chart === "task" || chart === "workload" ? chart : undefined;
}

export function resolveSettings(
  facade: ConfigurationFacade,
): ResolvedSettings {
  const watchRaw = facade.get("usage.watchOnScan");
  const watchExplicit =
    isConfigured(facade, "usage.watchOnScan") &&
    typeof watchRaw === "boolean";
  const retentionRaw = facade.get("usage.retentionDays");
  const retentionExplicit =
    isConfigured(facade, "usage.retentionDays") &&
    isRetentionScalar(retentionRaw);
  const chartRaw = facade.get("chart.defaultView");
  const chartExplicit =
    isConfigured(facade, "chart.defaultView") &&
    (chartRaw === "task" || chartRaw === "workload");
  return {
    watchOnScan: {
      configured: watchExplicit,
      value: watchExplicit ? (watchRaw as boolean) : true,
    },
    retentionDays: {
      configured: retentionExplicit,
      value: retentionExplicit
        ? parseRetentionSetting(retentionRaw)
        : undefined,
    },
    chartView: {
      configured: chartExplicit,
      value: chartExplicit ? (chartRaw as ChartType) : "task",
    },
  };
}
