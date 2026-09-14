import {
  loadComparison,
  optionResult,
  comparisonDelta,
  selectedCost,
  overlayResult,
  type ComparisonOption,
  type ComparisonStore,
  type Side,
} from "./comparison";
import { normalizeCost } from "./normalize";
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { BenchmarkService, ApiError, cacheTtl, validSnapshot } from "./api";
import { driftOf, selectPrevSnapshot } from "./drift";
import { catalogDate } from "./catalog";
import { invocableRef } from "./invocable";
import {
  compare,
  freeSpotlight,
  loadMappings,
  parseOptions,
  registryRateFor,
  savedOptions,
  sortRowsByEfficiency,
} from "./compare";
import { discoverOpenCode, OpenCodeError } from "./opencode";
import { staticModels, staticRegistryDate } from "./staticSources";
import { historyScenarioPrefill, planRegistryDate } from "./plans";
import { buildGroups } from "./groups";
import { defaultBilling, sources } from "./sources";
import {
  exportBadge,
  exportCsv,
  exportSnapshot,
  scenarioExport,
} from "./export";
import { html } from "./html";
import { recommend } from "./recommend";
import { loadProfiles, changeProfile, profileModified } from "./profiles";
import { parseMessage } from "./messages";
import { loadByokStore, mergeByokForm } from "./byok";
import {
  aggregateUsage,
  blankUsageIndex,
  discoverUsageFiles,
  normalizeUsageModelId,
  parseUsageJsonl,
  parseUsageLegacyJson,
  selectChangedFiles,
  storageCandidates,
  suggestBudget,
  validUsageFile,
  usageParserVersion,
  emptyUsageDiagnostics,
  type StoredUsageFile,
} from "./usage";
import { readFile as readLocalFile } from "node:fs/promises";
import { basename, extname, sep } from "node:path";
import type {
  AvailableModel,
  ByokStore,
  Snapshot,
  Source,
  UsageSummary,
  ViewState,
} from "./types";
const secretName = "artificialAnalysis.apiKey";
export function activate(context: vscode.ExtensionContext) {
  const cacheUri = vscode.Uri.joinPath(
    context.globalStorageUri,
    "benchmarks.json",
  );
  const prevCacheUri = vscode.Uri.joinPath(
    context.globalStorageUri,
    "benchmarks.prev.json",
  );
  const writeSnapshotFile = async (
    uri: ReturnType<typeof vscode.Uri.joinPath>,
    value: unknown,
  ) => {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const temporary = vscode.Uri.joinPath(
      context.globalStorageUri,
      `${basename(uri.path)}.${randomBytes(8).toString("hex")}.tmp.json`,
    );
    try {
      await vscode.workspace.fs.writeFile(
        temporary,
        Buffer.from(JSON.stringify(value)),
      );
      await vscode.workspace.fs.rename(temporary, uri, { overwrite: true });
    } finally {
      try {
        await vscode.workspace.fs.delete(temporary);
      } catch {
        // Successful rename already removed it; cleanup must not mask errors.
      }
    }
  };
  const service = new BenchmarkService({
    read: async () =>
      JSON.parse(
        Buffer.from(await vscode.workspace.fs.readFile(cacheUri)).toString(),
      ),
    write: async (value) => {
      // Rotate only on validated download success: the previous cache becomes
      // the drift baseline. Failures never reach this writer.
      try {
        const raw = JSON.parse(
          Buffer.from(await vscode.workspace.fs.readFile(cacheUri)).toString(),
        );
        if (validSnapshot(raw) && raw.fetchedAt !== value.fetchedAt)
          await writeSnapshotFile(prevCacheUri, raw);
      } catch {
        // No previous cache yet; nothing to retain.
      }
      await writeSnapshotFile(cacheUri, value);
    },
  });
  service.retryAt = context.globalState.get<number>("retryAt", 0);
  let panel: vscode.WebviewPanel | undefined,
    snapshot: Snapshot | undefined,
    prevSnapshot: Snapshot | undefined,
    options = savedOptions(context.globalState.get("options"));
  const readPrevSnapshot = async (): Promise<Snapshot | undefined> => {
    if (!snapshot) return undefined;
    try {
      const raw = JSON.parse(
        Buffer.from(
          await vscode.workspace.fs.readFile(prevCacheUri),
        ).toString(),
      );
      return selectPrevSnapshot(raw, snapshot);
    } catch {
      return undefined;
    }
  };
  const usageSummaryUri = vscode.Uri.joinPath(
    context.globalStorageUri,
    "usage.json",
  );
  let usage: UsageSummary | null = null,
    usageScanning = false,
    usageGeneration = 0,
    usagePending: Promise<void> | undefined,
    usageWatchers: vscode.Disposable[] = [],
    usageTimer: ReturnType<typeof setTimeout> | undefined;
  const readStoredUsage = async (): Promise<StoredUsageFile | undefined> => {
    try {
      const raw = JSON.parse(
        Buffer.from(
          await vscode.workspace.fs.readFile(usageSummaryUri),
        ).toString(),
      );
      return validUsageFile(raw) ? raw : undefined;
    } catch {
      return undefined;
    }
  };
  const setupUsageWatchers = () => {
    if (
      !context.globalState.get("usageConsent", false) ||
      usageWatchers.length ||
      typeof vscode.workspace.createFileSystemWatcher !== "function" ||
      typeof vscode.RelativePattern !== "function"
    )
      return;
    for (const root of storageCandidates()) {
      for (const pattern of [
        "**/chatSessions/*.jsonl",
        "**/chatSessions/*.json",
      ]) {
        try {
          const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(root, pattern),
          );
          const kick = () => {
            clearTimeout(usageTimer);
            usageTimer = setTimeout(() => void runUsageScan(), 1000);
          };
          watcher.onDidChange(kick);
          watcher.onDidCreate(kick);
          watcher.onDidDelete(kick);
          usageWatchers.push(watcher);
          context.subscriptions.push(watcher);
        } catch {
          // A root that cannot be watched is skipped; manual scans still work.
        }
      }
    }
  };
  const ensureUsageConsent = async (): Promise<boolean> => {
    if (context.globalState.get("usageConsent", false)) return true;
    const generation = usageGeneration;
    const choice = await vscode.window.showInformationMessage(
      "Scan local Copilot chat sessions for usage totals? Files stay on this machine; nothing is uploaded.",
      { modal: true },
      "Scan locally",
      "Not now",
    );
    if (choice !== "Scan locally" || generation !== usageGeneration)
      return false;
    await context.globalState.update("usageConsent", true);
    return true;
  };
  const runUsageScan = async () => {
    if (usageScanning || !context.globalState.get("usageConsent", false))
      return;
    const generation = usageGeneration;
    const current = () =>
      generation === usageGeneration &&
      context.globalState.get("usageConsent", false);
    usagePending = scan();
    await usagePending;
    async function scan() {
      usageScanning = true;
      message = "Scanning local Copilot sessions…";
      render();
      try {
        const unreadable: string[] = [];
        const candidates = await discoverUsageFiles(undefined, unreadable);
        if (!current()) return;
        const stored = await readStoredUsage();
        if (!current()) return;
        const index = stored?.index ?? blankUsageIndex();
        const { changed, deleted } = selectChangedFiles(candidates, index);
        const files: StoredUsageFile["files"] = { ...(stored?.files ?? {}) };
        for (const gone of new Set([
          ...deleted,
          ...Object.keys(files).filter(
            (p) => !candidates.some((c) => c.filePath === p),
          ),
        ])) {
          if (unreadable.some((p) => gone === p || gone.startsWith(p + sep))) {
            files[gone] = {
              ...files[gone],
              diagnostics: {
                ...emptyUsageDiagnostics(),
                unreadable: 1,
                stale: 1,
              },
            };
          } else delete files[gone];
          delete index.files[gone];
        }
        for (const path of unreadable) {
          if (
            !Object.keys(files).some(
              (p) => p === path || p.startsWith(path + sep),
            )
          )
            files[path] = {
              workspaceId: "unreadable",
              workspacePath: "",
              requests: [],
              diagnostics: { ...emptyUsageDiagnostics(), unreadable: 1 },
            };
        }
        for (const candidate of changed) {
          if (!current()) return;
          try {
            const text = await readLocalFile(candidate.filePath, "utf8");
            const stem = basename(
              candidate.filePath,
              extname(candidate.filePath),
            );
            const parsed = candidate.legacy
              ? parseUsageLegacyJson(text, candidate.workspaceId, stem)
              : parseUsageJsonl(text, candidate.workspaceId, stem);
            if (
              parsed.diagnostics.unsupported &&
              files[candidate.filePath]?.requests.length
            ) {
              files[candidate.filePath] = {
                ...files[candidate.filePath],
                diagnostics: { ...parsed.diagnostics, stale: 1 },
              };
              delete index.files[candidate.filePath];
              continue;
            }
            files[candidate.filePath] = {
              workspaceId: candidate.workspaceId,
              workspacePath: candidate.workspacePath,
              requests: parsed.requests,
              diagnostics: parsed.diagnostics,
            };
            index.files[candidate.filePath] = {
              size: candidate.size,
              mtime: candidate.mtime,
              parser: usageParserVersion,
            };
            if (parsed.diagnostics.unsupported || parsed.diagnostics.malformed)
              delete index.files[candidate.filePath];
          } catch {
            const previous = files[candidate.filePath];
            files[candidate.filePath] = {
              workspaceId: candidate.workspaceId,
              workspacePath: candidate.workspacePath,
              requests: previous?.requests ?? [],
              diagnostics: {
                ...emptyUsageDiagnostics(),
                unreadable: 1,
                stale: previous?.requests.length ? 1 : 0,
              },
            };
            delete index.files[candidate.filePath];
          }
        }
        if (!current()) return;
        const scannedAt = Date.now();
        usage = aggregateUsage(Object.values(files), scannedAt);
        await writeSnapshotFile(usageSummaryUri, {
          version: 2,
          scannedAt,
          index,
          files,
        });
        if (!current()) return;
        setupUsageWatchers();
        message =
          `Local usage ready: ${usage.requestCount} requests from ${usage.fileCount} files. ` +
          "Local estimates only, not a bill.";
      } catch {
        if (current())
          message =
            "Local usage scan failed. Retry when Copilot chat sessions exist.";
      } finally {
        usageScanning = false;
        render();
      }
    }
  };
  const loadUsage = async () => {
    const generation = usageGeneration;
    if (!context.globalState.get("usageConsent", false)) return;
    const stored = await readStoredUsage();
    if (
      stored &&
      Object.values(stored.index.files).some(
        (v) => v.parser !== usageParserVersion,
      )
    ) {
      await runUsageScan();
      return;
    }
    if (
      stored &&
      generation === usageGeneration &&
      context.globalState.get("usageConsent", false)
    ) {
      usage = aggregateUsage(Object.values(stored.files), stored.scannedAt);
      if (context.globalState.get("usageConsent", false)) setupUsageWatchers();
    }
    if (!stored && generation === usageGeneration) await runUsageScan();
    render();
  };
  const availableBySource: Record<Source, AvailableModel[]> = {
    copilot: [],
    opencode: [],
    "claude-code": staticModels("claude-code"),
    codex: staticModels("codex"),
    "gemini-cli": staticModels("gemini-cli"),
    cursor: staticModels("cursor"),
    windsurf: staticModels("windsurf"),
    aider: staticModels("aider"),
    "amazon-q": staticModels("amazon-q"),
  };
  // Generation counter: switching sources invalidates in-flight discovery so
  // late results from the previous source can never render.
  const discoveryGen: Partial<Record<Source, number>> = {};
  const discoveryErrors: Partial<Record<Source, string>> = {};
  const discoveryPending: Partial<Record<Source, Promise<void>>> = {};
  let overrides = loadMappings(context.globalState.get("mappings")),
    pins = context.globalState.get<Record<string, string[]>>("pins", {}),
    excluded = context.globalState.get<Record<string, string[]>>(
      "excluded",
      {},
    ),
    byok: ByokStore = loadByokStore(context.globalState.get("byokRates")),
    selected: string | undefined,
    loading = false,
    message = "",
    exportNote = "",
    hasKey = false;
  let profileStore = loadProfiles(context.globalState.get("profiles"));
  let optionsRevision = 0;
  let comparison = loadComparison(context.globalState.get("comparison"));
  const capture = (name = "Option"): ComparisonOption =>
    structuredClone({
      name,
      options,
      mappings: overrides,
      pins,
      excluded,
      selected,
    });
  let singleView = capture();
  const useOption = (value: ComparisonOption) => {
    const v = structuredClone(value);
    options = v.options;
    overrides = v.mappings;
    pins = v.pins;
    excluded = v.excluded;
    selected = v.selected;
    optionsRevision++;
  };
  const captureActive = () => {
    if (!comparison?.enabled) return;
    comparison.sides[comparison.active] = capture(
      comparison.sides[comparison.active].name,
    );
    for (const side of ["A", "B"] as const) {
      comparison.sides[side].options.preset = options.preset;
      comparison.sides[side].options.display.chart = options.display.chart;
    }
  };
  const persist = async (key: string, value: unknown) => {
    if (
      comparison?.enabled &&
      ["options", "mappings", "pins", "excluded"].includes(key)
    ) {
      captureActive();
      await context.globalState.update("comparison", comparison);
    } else await context.globalState.update(key, value);
  };
  if (comparison?.enabled) useOption(comparison.sides[comparison.active]);

  /** Row ids from the last render, for validating variant-level exclusions. */
  let lastStructureIds = new Set<string>();
  const excludedFor = (source: Source): string[] => excluded[source] ?? [];
  const usedCountsFor = () => {
    const usedCounts = new Map<string, number>();
    if (usage) {
      for (const stat of usage.models) {
        const id = normalizeUsageModelId(stat.modelId);
        if (id) usedCounts.set(id, (usedCounts.get(id) ?? 0) + stat.requests);
      }
    }
    return usedCounts;
  };
  const render = () => {
    const available = availableBySource[options.source];
    const benchmarks = snapshot?.models ?? [];
    const usedCounts = usedCountsFor();
    captureActive();
    const result = optionResult(
      capture(),
      available,
      benchmarks,
      byok,
      usedCounts,
    );
    lastStructureIds = new Set(result.structureIds);
    const rows = result.rows;
    if (comparison?.enabled) selected = result.selected;
    const spotlight = freeSpotlight(
      available,
      snapshot?.models ?? [],
      options,
      overrides,
      undefined,
      { pins, excluded: excludedFor(options.source), byok, usedCounts },
    );
    const comparable = rows.filter((r) => r.cost !== null && r.score !== null);
    const bestOverall = comparable.length
      ? [...comparable].sort(
          (a, b) => b.score! - a.score! || a.cost! - b.cost!,
        )[0]
      : undefined;
    const freeSpotlightState = options.freeOnly
      ? {
          enabled: true,
          ...spotlight,
          explanation: spotlight.bestFree
            ? `Best free: ${spotlight.bestFree.name} at ${spotlight.bestFree.score} points, trailing best overall ${spotlight.bestOverall?.name ?? ""} by ${spotlight.gapPoints ?? 0} points.`
            : "No free models with scores in the current view.",
        }
      : {
          enabled: false,
          ...spotlight,
          explanation:
            spotlight.bestFree && bestOverall
              ? `Best free ${spotlight.bestFree.name} (${spotlight.bestFree.score}) trails best overall ${spotlight.bestOverall?.name ?? bestOverall.name} by ${spotlight.gapPoints ?? 0} points.`
              : "Free-tier spotlight needs OpenCode USD data with free models.",
        };
    const rowProvider = new Map(rows.map((r) => [r.modelId, r.provider]));
    const excludedList = excludedFor(options.source);
    const checklist = available.map((m) => ({
      id: m.id,
      name: m.name,
      provider: rowProvider.get(m.id) ?? "Unknown",
      included: !excludedList.includes(m.id),
      rowCount: rows.filter((r) => r.modelId === m.id).length,
    }));
    const groups = result.groups;
    const state: ViewState = {
      source: options.source,
      options,
      rows,
      recommendation: recommend(rows, options),
      profiles: profileStore.items.map(({ id, name }) => ({ id, name })),
      activeProfileId: profileStore.activeId,
      profileModified: profileModified(profileStore, options),
      optionsRevision,
      models: snapshot?.models ?? [],
      selected,
      version: snapshot?.version,
      fetchedAt: snapshot?.fetchedAt,
      prevVersion: prevSnapshot?.version,
      prevFetchedAt: prevSnapshot?.fetchedAt,
      drift: driftOf(prevSnapshot, snapshot?.models ?? [], options.preset),
      byok,
      usage,
      usageWatching: usageWatchers.length > 0,
      budgetSuggestion: suggestBudget(usage, options.billing),
      loading,
      message: [message, discoveryErrors[options.source]]
        .filter(Boolean)
        .join(" "),
      hasKey,
      catalogDate,
      staticRegistryDate,
      planRegistryDate,
      scenario: result.scenario,
      scenarioPrefill: historyScenarioPrefill(usage),
      checklist,
      groups,
      freeSpotlight: freeSpotlightState,
      exportNote: exportNote || undefined,
    };
    if (comparison?.enabled) {
      captureActive();
      const sides = Object.fromEntries(
        (["A", "B"] as const).map((side) => {
          const option = comparison!.sides[side];
          const result = optionResult(
            option,
            availableBySource[option.options.source],
            benchmarks,
            byok,
            usedCounts,
          );
          option.selected = result.selected;
          return [
            side,
            {
              ...result,
              discoveryError: discoveryErrors[option.options.source],
            },
          ];
        }),
      ) as unknown as Record<Side, ReturnType<typeof optionResult>>;
      state.comparison = {
        active: comparison.active,
        normalize: comparison.normalize,
        view: comparison.view,
        sides,
        delta: comparisonDelta(sides.A, sides.B, comparison.normalize),
        overlay:
          comparison.view === "overlay"
            ? overlayResult(sides.A, sides.B)
            : undefined,
      };
    }
    void panel?.webview.postMessage({ type: "state", state });
  };
  const discoverCopilot = async (gen: number) => {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (gen !== discoveryGen.copilot) return;
      const discovered = models.map(({ id, name, family, maxInputTokens }) => ({
        id,
        name,
        family,
        maxInputTokens,
        source: "copilot" as const,
      }));
      if (discovered.length) availableBySource.copilot = discovered;
      discoveryErrors.copilot = discovered.length
        ? ""
        : "No Copilot models are exposed. Sign in to GitHub Copilot, enable Copilot Chat, and refresh.";
    } catch {
      if (gen !== discoveryGen.copilot) return;
      discoveryErrors.copilot =
        "Could not discover Copilot models. Check Copilot sign-in and refresh." +
        (availableBySource.copilot.length
          ? " Previous listing retained (stale)."
          : "");
    }
    render();
  };
  const discoverOpencode = async (gen: number) => {
    try {
      const models = await discoverOpenCode();
      if (gen !== discoveryGen.opencode) return;
      availableBySource.opencode = models;
      discoveryErrors.opencode = "";
    } catch (error) {
      if (gen !== discoveryGen.opencode) return;
      if (error instanceof OpenCodeError) {
        // A discovery failure does not erase a previously successful listing.
        discoveryErrors.opencode =
          error.message +
          (availableBySource.opencode.length
            ? " Previous listing retained (stale)."
            : "");
      } else {
        discoveryErrors.opencode =
          "OpenCode discovery failed. Retry; the previous listing is retained.";
      }
    }
    render();
  };
  const discoverSource = (source: Source, force = false): Promise<void> => {
    if (!force && discoveryPending[source]) return discoveryPending[source]!;
    const gen = (discoveryGen[source] ?? 0) + 1;
    discoveryGen[source] = gen;
    const pending =
      source === "copilot"
        ? discoverCopilot(gen)
        : source === "opencode"
          ? discoverOpencode(gen)
          : Promise.resolve();
    discoveryPending[source] = pending.finally(() => {
      if (discoveryGen[source] === gen) delete discoveryPending[source];
    });
    return discoveryPending[source]!;
  };
  const discover = async () => {
    const needed = comparison?.enabled
      ? [comparison.sides.A.options.source, comparison.sides.B.options.source]
      : [options.source];
    await Promise.all(
      [...new Set(needed)].map((source) => discoverSource(source)),
    );
    render();
  };
  const refresh = async (force = false) => {
    if (loading) return;
    loading = true;
    message = "Loading comparison data…";
    render();
    try {
      snapshot = await service.cached();
      render();
      await discover();
      const key = await context.secrets.get(secretName);
      hasKey = !!key;
      snapshot = await service.load(key, force);
      prevSnapshot = await readPrevSnapshot();
      message =
        Date.now() - snapshot.fetchedAt >= cacheTtl
          ? "Using a cached snapshot older than 24 hours. Refresh data to update."
          : "Benchmark data ready.";
    } catch (error) {
      message =
        error instanceof ApiError
          ? error.message
          : "Could not load or save benchmark data. Use Refresh data to retry.";
      if (snapshot) message += " Showing the last successful snapshot.";
    } finally {
      loading = false;
      await context.globalState.update("retryAt", service.retryAt);
      render();
    }
  };
  const setKey = async () => {
    const key = await vscode.window.showInputBox({
      title: "Artificial Analysis API key",
      prompt:
        "Create a Free API key at artificialanalysis.ai. Stored securely by VS Code.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "Enter an API key."),
    });
    if (key === undefined) return;
    await context.secrets.store(secretName, key.trim());
    hasKey = true;
    await refresh(true);
  };
  if (context.globalState.get("usageConsent", false)) setupUsageWatchers();
  const clearUsageData = async () => {
    usageGeneration++;
    clearTimeout(usageTimer);
    for (const watcher of usageWatchers) watcher.dispose();
    usageWatchers = [];
    usage = null;
    await context.globalState.update("usageConsent", false);
    await usagePending;
    try {
      await vscode.workspace.fs.delete(usageSummaryUri);
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "FileNotFound"
      )) {
        message =
          "Local usage watching stopped, but stored data could not be erased. Retry Erase Local Copilot Usage.";
        render();
        return;
      }
    }
    message = "Local usage data erased. Rescanning will ask for consent again.";
    render();
  };
  const openPanel = () => {
    if (panel) panel.reveal();
    else void vscode.commands.executeCommand("paretoGhc.open");
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("paretoGhc.setApiKey", setKey),
    vscode.commands.registerCommand("paretoGhc.clearApiKey", async () => {
      await context.secrets.delete(secretName);
      hasKey = false;
      message = "API key removed. Cached benchmarks remain available.";
      render();
    }),
    vscode.commands.registerCommand("paretoGhc.scanUsage", async () => {
      openPanel();
      if (await ensureUsageConsent()) await runUsageScan();
      else render();
    }),
    vscode.commands.registerCommand("paretoGhc.clearUsage", async () => {
      openPanel();
      await clearUsageData();
    }),
    vscode.commands.registerCommand("paretoGhc.open", () => {
      if (panel) {
        panel.reveal();
        return;
      }
      panel = vscode.window.createWebviewPanel(
        "paretoGhc",
        "Pareto GHC Comparator",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist"),
          ],
        },
      );
      const webview = panel.webview;
      webview.html = html(
        webview
          .asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"),
          )
          .toString(),
        webview
          .asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, "dist", "style.css"),
          )
          .toString(),
        webview.cspSource,
        randomBytes(18).toString("base64"),
      );
      let messageQueue = Promise.resolve();
      const receiver = webview.onDidReceiveMessage((raw: unknown) => {
        messageQueue = messageQueue.then(async () => {
          try {
            let m = parseMessage(raw);
            if (m.type === "comparison") {
              captureActive();
              if (m.enabled === true && !comparison?.enabled) {
                singleView = capture();
                comparison ??= {
                  version: 1,
                  enabled: false,
                  active: "A",
                  normalize: false,
                  view: "side-by-side",
                  sides: { A: capture("Option A"), B: capture("Option B") },
                };
                comparison.enabled = true;
                useOption(comparison.sides[comparison.active]);
              } else if (m.enabled === false && comparison?.enabled) {
                comparison.enabled = false;
                useOption(singleView);
              }
              if (comparison?.enabled && m.active) {
                comparison.active = m.active;
                useOption(comparison.sides[m.active]);
              }
              if (comparison?.enabled && m.name)
                comparison.sides[comparison.active].name = m.name.trim();
              if (comparison?.enabled && m.normalize !== undefined)
                comparison.normalize = m.normalize;
              if (comparison?.enabled && m.view !== undefined)
                comparison.view = m.view;
              await context.globalState.update("comparison", comparison);
              render();
              await discover();
              return;
            }
            if (m.type === "target") {
              if (!comparison?.enabled)
                throw Error("Comparison is not active.");
              captureActive();
              comparison.active = m.side;
              useOption(comparison.sides[m.side]);
              m = m.action;
              render();
            }

            if (m.type === "ready") {
              render();
              await refresh();
              await loadUsage();
            } else if (m.type === "refresh") await refresh(true);
            else if (m.type === "scanUsage") {
              if (await ensureUsageConsent()) await runUsageScan();
              else render();
            } else if (m.type === "clearUsage") {
              await clearUsageData();
            } else if (m.type === "key") await setKey();
            else if (m.type === "source") {
              if (m.source !== options.source) {
                // Invalidate in-flight discovery before switching (B2).
                /* Source-specific discovery cannot overwrite another source. */
                options = {
                  ...options,
                  source: m.source,
                  billing: defaultBilling(m.source),
                  freeOnly: false,
                };
                selected = undefined;
                await persist("options", options);
                optionsRevision++;
                render();
                await discover();
              }
            } else if (m.type === "options") {
              options = parseOptions(m.options);
              await persist("options", options);
              render();
            } else if (m.type === "profile") {
              if (comparison?.enabled && m.change.action !== "apply")
                throw Error(
                  "Load a saved workload, or leave comparison mode to manage profiles.",
                );
              const previousSource = options.source;
              const prevDisplay = options.display;
              const next = changeProfile(profileStore, options, m.change);
              if (!comparison?.enabled)
                await context.globalState.update("profiles", next.store);
              const withDisplay = { ...next.options, display: prevDisplay };
              await persist("options", withDisplay);
              if (!comparison?.enabled) profileStore = next.store;
              options = withDisplay;
              if (m.change.action === "apply") optionsRevision++;
              if (options.source !== previousSource) {
                /* Source-specific discovery cannot overwrite another source. */
                selected = undefined;
              } else if (
                selected &&
                !availableBySource[options.source].some(
                  (a) =>
                    a.id === (selected as string) ||
                    (selected as string).startsWith(`${a.id}::`),
                )
              ) {
                selected = undefined;
              }
              message =
                m.change.action === "delete"
                  ? "Profile deleted. Current workload retained."
                  : "Profile settings saved locally.";
              render();
              if (options.source !== previousSource) await discover();
            } else if (m.type === "select" && typeof m.id === "string") {
              const modelId = m.id.split("::")[0];
              if (
                availableBySource[options.source].some((a) => a.id === modelId)
              ) {
                selected = m.id;
                render();
              }
            } else if (m.type === "copy" && typeof m.id === "string") {
              const modelId = m.id.split("::")[0];
              const model = availableBySource[options.source].find(
                (a) => a.id === modelId,
              );
              if (model) {
                const invocable = invocableRef(model);
                if (invocable) {
                  await vscode.env.clipboard.writeText(invocable.ref);
                  exportNote = `Copied "${invocable.ref}" — ${invocable.usage}.`;
                } else {
                  await vscode.env.clipboard.writeText(model.name);
                  exportNote = `Copied model name "${model.name}" — no verified invocable id for this source; select it in the client's own model picker.`;
                }
                render();
              }
            } else if (
              m.type === "mapping" &&
              typeof m.id === "string" &&
              typeof m.benchmarkId === "string" &&
              (m.benchmarkId === "" ||
                snapshot?.models.some((b) => b.id === m.benchmarkId))
            ) {
              const modelId = m.id.split("::")[0];
              if (
                availableBySource[options.source].some((a) => a.id === modelId)
              ) {
                if (m.id.includes("::")) {
                  const [base, bench] = m.id.split("::");
                  if (!pins[base]?.includes(bench)) {
                    // Automatically expanded variant row: choosing a benchmark
                    // collapses the model to that single manual mapping, while
                    // "Use automatic matching" keeps every variant visible.
                    overrides = { ...overrides };
                    if (m.benchmarkId) overrides[base] = m.benchmarkId;
                    else delete overrides[base];
                    await persist("mappings", overrides);
                    if (selected === m.id)
                      selected = m.benchmarkId ? base : m.id;
                  } else {
                    const list = [...(pins[base] ?? [])];
                    if (!m.benchmarkId) {
                      const filtered = list.filter((b) => b !== bench);
                      const next = { ...pins };
                      if (filtered.length) next[base] = filtered;
                      else delete next[base];
                      pins = next;
                      if (selected === m.id) selected = base;
                    } else {
                      const idx = list.indexOf(bench);
                      if (idx >= 0) list[idx] = m.benchmarkId;
                      pins = { ...pins, [base]: list };
                      if (selected === m.id)
                        selected = `${base}::${m.benchmarkId}`;
                    }
                    await persist("pins", pins);
                  }
                } else {
                  overrides = { ...overrides };
                  if (m.benchmarkId) overrides[m.id] = m.benchmarkId;
                  else delete overrides[m.id];
                  await persist("mappings", overrides);
                }
                render();
              }
            } else if (m.type === "pin" && typeof m.benchmarkId === "string") {
              const modelId = m.id.split("::")[0];
              if (
                availableBySource[options.source].some(
                  (a) => a.id === modelId,
                ) &&
                snapshot?.models.some((b) => b.id === m.benchmarkId)
              ) {
                const list = pins[modelId] ?? [];
                if (!list.includes(m.benchmarkId)) {
                  pins = { ...pins, [modelId]: [...list, m.benchmarkId] };
                  await persist("pins", pins);
                }
                selected = `${modelId}::${m.benchmarkId}`;
                render();
              }
            } else if (m.type === "unpin") {
              const modelId = m.id.split("::")[0];
              const bench = m.benchmarkId || m.id.split("::")[1];
              if (bench && pins[modelId]?.includes(bench)) {
                const list = pins[modelId].filter((b) => b !== bench);
                const next = { ...pins };
                if (list.length) next[modelId] = list;
                else delete next[modelId];
                pins = next;
                await persist("pins", pins);
                if (selected === `${modelId}::${bench}`) selected = modelId;
                render();
              }
            } else if (m.type === "byok") {
              // Manual whole-store save from the BYOK form; the message is
              // already validated to manual-only provenance (parseByokFormStore).
              // Merging (not replacing) keeps registry provenance on entries
              // the form re-saved unchanged.
              byok = mergeByokForm(byok, m.rates);
              await context.globalState.update("byokRates", byok);
              message =
                Object.keys(byok).length === 0
                  ? "BYOK rates cleared."
                  : `Saved ${Object.keys(byok).length} BYOK rate${Object.keys(byok).length === 1 ? "" : "s"} for provider-billed OpenCode models.`;
              render();
            } else if (m.type === "byokApply") {
              // Rates and provenance are computed host-side from the verified
              // registry, never trusted from the webview.
              const results = m.ids.map((id) => {
                const model = availableBySource.opencode.find(
                  (a) => a.id === id,
                );
                return {
                  id,
                  model,
                  suggestion: model ? registryRateFor(model) : undefined,
                };
              });
              const bad = results.find((r) => !r.model || !r.suggestion);
              if (bad) {
                message = `No verified registry rate for ${bad.model?.name ?? bad.id}; enter a manual rate instead.`;
              } else {
                const next = { ...byok };
                for (const { id, suggestion } of results) {
                  next[id] = {
                    rates: suggestion!.rates,
                    ...(suggestion!.long ? { long: suggestion!.long } : {}),
                    source: {
                      kind: "registry",
                      registry: suggestion!.registry,
                      registryId: suggestion!.registryId,
                      registryDate: suggestion!.registryDate,
                    },
                  };
                }
                if (Object.keys(next).length > 1000) {
                  message =
                    "Too many BYOK entries; remove some before applying more.";
                } else {
                  byok = next;
                  await context.globalState.update("byokRates", byok);
                  const registryLabel =
                    sources[
                      results[0].suggestion!.registry as keyof typeof sources
                    ]?.label ?? results[0].suggestion!.registry;
                  message = `Applied ${registryLabel} registry rate (${results[0].suggestion!.registryDate}) to ${results.length} model${results.length === 1 ? "" : "s"}.`;
                }
              }
              render();
            } else if (m.type === "byokReset") {
              // Removing an entry is always safe, even for a model that is no
              // longer discovered, so users can clean up stale BYOK rows.
              const next = { ...byok };
              for (const id of m.ids) delete next[id];
              byok = next;
              await context.globalState.update("byokRates", byok);
              message = `Removed ${m.ids.length} BYOK rate${m.ids.length === 1 ? "" : "s"}.`;
              render();
            } else if (m.type === "exclude") {
              if (lastStructureIds.has(m.id)) {
                const current = new Set(excludedFor(options.source));
                if (m.excluded) current.add(m.id);
                else current.delete(m.id);
                excluded = { ...excluded, [options.source]: [...current] };
                await persist("excluded", excluded);
              }
              render();
            } else if (m.type === "excludeMany") {
              const valid = lastStructureIds;
              const current = new Set(excludedFor(options.source));
              for (const id of m.ids) {
                if (!valid.has(id)) continue;
                if (m.excluded) current.add(id);
                else current.delete(id);
              }
              excluded = { ...excluded, [options.source]: [...current] };
              await persist("excluded", excluded);
              render();
            } else if (m.type === "excludeAll") {
              excluded = {
                ...excluded,
                [options.source]: m.excluded
                  ? availableBySource[options.source].map((a) => a.id)
                  : [],
              };
              await persist("excluded", excluded);
              render();
            } else if (
              m.type === "exportCsv" ||
              m.type === "exportSnapshot" ||
              m.type === "exportBadge"
            ) {
              try {
                const available = availableBySource[options.source];
                const single = optionResult(
                  capture(),
                  available,
                  snapshot?.models ?? [],
                  byok,
                  usedCountsFor(),
                );
                const rows = single.rows;
                const recommended = new Set(recommend(rows, options).modelIds);
                const uri = await vscode.window.showSaveDialog(
                  m.type === "exportCsv"
                    ? {
                        filters: { "CSV files": ["csv"] },
                        saveLabel: "Export comparison CSV",
                      }
                    : {
                        filters: { "JSON files": ["json"] },
                        saveLabel:
                          m.type === "exportSnapshot"
                            ? "Export comparison snapshot"
                            : "Export comparison badge",
                      },
                );
                if (!uri) {
                  exportNote =
                    m.type === "exportCsv"
                      ? "CSV export cancelled."
                      : m.type === "exportSnapshot"
                        ? "Snapshot export cancelled."
                        : "Badge export cancelled.";
                } else {
                  let exportedRows = rows.length;
                  let payload =
                    m.type === "exportCsv"
                      ? exportCsv(rows, options, recommended)
                      : m.type === "exportSnapshot"
                        ? exportSnapshot(rows, options, recommended, {
                            source: options.source,
                            preset: options.preset,
                            billing: options.billing,
                            catalogDate,
                            staticRegistryDate,
                            planRegistryDate,
                            version: snapshot?.version,
                            fetchedAt: snapshot?.fetchedAt,
                            scenario: single.scenario,
                          })
                        : exportBadge(rows, options, {
                            source: options.source,
                            preset: options.preset,
                          });
                  if (comparison?.enabled && m.type !== "exportBadge") {
                    captureActive();
                    const pair = (["A", "B"] as const).map((side) => {
                      const option = comparison!.sides[side];
                      const result = optionResult(
                        option,
                        availableBySource[option.options.source],
                        snapshot?.models ?? [],
                        byok,
                        usedCountsFor(),
                      );
                      return {
                        side,
                        ...result,
                        costNormalization: comparison!.normalize
                          ? selectedCost(result)
                          : ({ status: "off" } as const),
                        availabilityNote:
                          sources[option.options.source].availabilityNote,
                        pricingNote: sources[option.options.source].pricingNote,
                        discoveryError:
                          discoveryErrors[option.options.source] ?? "",
                        catalogDate,
                        staticRegistryDate,
                        planRegistryDate,
                        benchmarkVersion: snapshot?.version,
                        benchmarkFetchedAt: snapshot?.fetchedAt,
                      };
                    });
                    exportedRows = pair.reduce(
                      (sum, p) => sum + p.rows.length,
                      0,
                    );
                    const usdCostDelta = comparison!.normalize
                      ? comparisonDelta(pair[0], pair[1], true).usd
                      : null;
                    payload =
                      m.type === "exportSnapshot"
                        ? JSON.stringify(
                            {
                              version: 2,
                              disclaimer:
                                "Illustrative comparison, not measured task cost or an account bill.",
                              options: pair.map((p) => ({
                                ...p,
                                scenario:
                                  p.scenario.status === "off"
                                    ? p.scenario
                                    : scenarioExport(p.scenario),
                              })),
                              usdCostDelta,
                            },
                            null,
                            2,
                          )
                        : "option,assumptions,usd_equivalent,usd_conversion," +
                          exportCsv([], options).trimEnd() +
                          "\n" +
                          (() => {
                            // Derived from the header, not hardcoded, so an
                            // empty-option row always pads to the same width
                            // as a populated one even if columns are added.
                            const dataColumns = exportCsv([], options)
                              .trimEnd()
                              .split(",").length;
                            return pair
                              .map((p) => {
                                const label = JSON.stringify({
                                  side: p.side,
                                  name: p.name,
                                  options: p.options,
                                  discoveryError: p.discoveryError,
                                  availabilityNote: p.availabilityNote,
                                  pricingNote: p.pricingNote,
                                  catalogDate,
                                  staticRegistryDate,
                                  planRegistryDate,
                                  scenario:
                                    p.scenario.status === "off"
                                      ? p.scenario
                                      : scenarioExport(p.scenario),
                                  costNormalization: p.costNormalization,
                                  usdCostDelta,
                                  benchmarkVersion: snapshot?.version,
                                  benchmarkFetchedAt: snapshot?.fetchedAt,
                                });
                                if (!p.rows.length)
                                  return `${p.side},"${label.replace(/"/g, '""')}",,,${Array(dataColumns).fill("").join(",")}\n`;
                                return p.rows
                                  .map((row) => {
                                    const n = comparison!.normalize
                                      ? normalizeCost(
                                          row.cost,
                                          p.options.billing,
                                          p.options.display.chart,
                                        )
                                      : ({ status: "off" } as const);
                                    const usdEquivalent =
                                      n.status === "native" ||
                                      n.status === "converted"
                                        ? String(n.usd)
                                        : "";
                                    const csv = exportCsv(
                                      [row],
                                      p.options,
                                      new Set(p.recommendation.modelIds),
                                    );
                                    return (
                                      `${p.side},"${label.replace(/"/g, '""')}",${usdEquivalent},${n.status},` +
                                      csv.slice(csv.indexOf("\n") + 1)
                                    );
                                  })
                                  .join("");
                              })
                              .join("");
                          })();
                  }
                  await vscode.workspace.fs.writeFile(
                    uri,
                    Buffer.from(payload),
                  );
                  exportNote =
                    m.type === "exportBadge"
                      ? "Exported badge."
                      : `Exported ${exportedRows} rows.`;
                }
              } catch {
                exportNote =
                  m.type === "exportCsv"
                    ? "CSV export failed. Retry with fewer rows."
                    : m.type === "exportSnapshot"
                      ? "Snapshot export failed. Retry with fewer rows."
                      : "Badge export failed. Retry from the current view.";
              }
              render();
            } else if (m.type === "exportPng") {
              try {
                const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(
                  m.png,
                );
                if (!match) throw new Error("Invalid PNG payload.");
                const uri = await vscode.window.showSaveDialog({
                  filters: { "PNG images": ["png"] },
                  saveLabel: "Export chart PNG",
                });
                if (!uri) {
                  exportNote = "PNG export cancelled.";
                } else {
                  await vscode.workspace.fs.writeFile(
                    uri,
                    Buffer.from(match[1], "base64"),
                  );
                  exportNote = "Exported chart.";
                }
              } catch {
                exportNote = "PNG export failed. Retry from the chart view.";
              }
              render();
            }
          } catch (error) {
            const type =
              raw && typeof raw === "object"
                ? (raw as { type?: unknown }).type
                : undefined;
            message =
              "Could not apply that change. " +
              ((type === "profile" || type === "options") &&
              error instanceof Error
                ? error.message
                : "Check input values and try again.");
            render();
          } finally {
            if (comparison?.enabled) {
              captureActive();
              await context.globalState.update("comparison", comparison);
            }
          }
        });
        return messageQueue;
      });
      panel.onDidDispose(
        () => {
          receiver.dispose();
          panel = undefined;
        },
        undefined,
        context.subscriptions,
      );
    }),
    vscode.lm.onDidChangeChatModels(() => {
      if (
        panel &&
        (options.source === "copilot" ||
          (comparison?.enabled &&
            Object.values(comparison.sides).some(
              (s) => s.options.source === "copilot",
            )))
      )
        void discoverSource("copilot", true);
    }),
  );
}
export function deactivate() {}
