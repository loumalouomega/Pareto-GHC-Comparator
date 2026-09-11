import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { BenchmarkService, ApiError, cacheTtl, validSnapshot } from "./api";
import { driftOf, selectPrevSnapshot } from "./drift";
import { catalogDate } from "./catalog";
import {
  compare,
  freeSpotlight,
  parseOptions,
  savedOptions,
  sortRowsByEfficiency,
} from "./compare";
import { discoverOpenCode, OpenCodeError } from "./opencode";
import { staticModels, staticRegistryDate } from "./staticSources";
import { buildGroups } from "./groups";
import { defaultBilling } from "./sources";
import { exportBadge, exportCsv, exportSnapshot } from "./export";
import { html } from "./html";
import { recommend } from "./recommend";
import { loadProfiles, changeProfile, profileModified } from "./profiles";
import { parseMessage } from "./messages";
import { loadByokStore } from "./byok";
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
  type StoredUsageFile,
} from "./usage";
import { readFile as readLocalFile } from "node:fs/promises";
import { basename, extname } from "node:path";
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
      "benchmarks.tmp.json",
    );
    await vscode.workspace.fs.writeFile(
      temporary,
      Buffer.from(JSON.stringify(value)),
    );
    await vscode.workspace.fs.rename(temporary, uri, { overwrite: true });
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
      usageWatchers.length ||
      typeof vscode.workspace.createFileSystemWatcher !== "function" ||
      typeof vscode.RelativePattern !== "function"
    )
      return;
    for (const root of storageCandidates()) {
      for (const pattern of ["**/chatSessions/*.jsonl", "**/chatSessions/*.json"]) {
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
    const choice = await vscode.window.showInformationMessage(
      "Scan local Copilot chat sessions for usage totals? Files stay on this machine; nothing is uploaded.",
      "Scan locally",
      "Not now",
    );
    if (choice !== "Scan locally") return false;
    await context.globalState.update("usageConsent", true);
    return true;
  };
  const runUsageScan = async () => {
    if (usageScanning) return;
    usageScanning = true;
    message = "Scanning local Copilot sessions…";
    render();
    try {
      const candidates = await discoverUsageFiles();
      const stored = await readStoredUsage();
      const index = stored?.index ?? blankUsageIndex();
      const { changed, deleted } = selectChangedFiles(candidates, index);
      const files: StoredUsageFile["files"] = { ...(stored?.files ?? {}) };
      for (const gone of deleted) delete files[gone];
      for (const candidate of changed) {
        try {
          const text = await readLocalFile(candidate.filePath, "utf8");
          const stem = basename(candidate.filePath, extname(candidate.filePath));
          const parsed = candidate.legacy
            ? parseUsageLegacyJson(text, candidate.workspaceId, stem)
            : parseUsageJsonl(text, candidate.workspaceId, stem);
          files[candidate.filePath] = {
            workspaceId: candidate.workspaceId,
            workspacePath: candidate.workspacePath,
            requests: parsed.requests,
          };
          index.files[candidate.filePath] = {
            size: candidate.size,
            mtime: candidate.mtime,
            parser: 1,
          };
        } catch {
          // Unreadable files are skipped without failing the scan.
        }
      }
      const scannedAt = Date.now();
      usage = aggregateUsage(Object.values(files), scannedAt);
      await writeSnapshotFile(usageSummaryUri, {
        version: 1,
        scannedAt,
        index,
        files,
      });
      setupUsageWatchers();
      message =
        `Local usage ready: ${usage.requestCount} requests from ${usage.fileCount} files. ` +
        "Local estimates only, not a bill.";
    } catch {
      message = "Local usage scan failed. Retry when Copilot chat sessions exist.";
    } finally {
      usageScanning = false;
      render();
    }
  };
  const loadUsage = async () => {
    const stored = await readStoredUsage();
    if (stored) {
      usage = aggregateUsage(Object.values(stored.files), stored.scannedAt);
      if (context.globalState.get("usageConsent", false)) setupUsageWatchers();
    }
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
  let discoveryGen = 0;
  let overrides = context.globalState.get<Record<string, string>>(
      "mappings",
      {},
    ),
    pins = context.globalState.get<Record<string, string[]>>("pins", {}),
    excluded = context.globalState.get<Record<string, string[]>>(
      "excluded",
      {},
    ),
    byok: ByokStore = loadByokStore(context.globalState.get("byokRates")),
    selected: string | undefined,
    loading = false,
    message = "",
    discoveryError = "",
    exportNote = "",
    hasKey = false;
  let profileStore = loadProfiles(context.globalState.get("profiles"));
  let optionsRevision = 0;
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
    // Structure rows ignore the text filter and exclusions so every thinking
    // level stays selectable (unchecked leaves remain visible).
    const structureRows = compare(
      available,
      benchmarks,
      { ...options, filter: "" },
      overrides,
      undefined,
      { pins },
    );
    lastStructureIds = new Set([
      ...available.map((a) => a.id),
      ...structureRows.map((r) => r.id),
    ]);
    const unsorted = compare(
      available,
      benchmarks,
      options,
      overrides,
      undefined,
      { pins, excluded: excludedFor(options.source), byok, usedCounts },
    );
    const rows =
      options.display.sort === "efficiency"
        ? sortRowsByEfficiency(unsorted)
        : unsorted;
    const spotlight = freeSpotlight(
      available,
      snapshot?.models ?? [],
      options,
      overrides,
      undefined,
      { pins, excluded: excludedFor(options.source), byok, usedCounts },
    );
    const comparable = rows.filter(
      (r) => r.cost !== null && r.score !== null,
    );
    const bestOverall = comparable.length
      ? [...comparable].sort((a, b) => b.score! - a.score! || a.cost! - b.cost!)[0]
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
    const groups = buildGroups(available, excludedList, rows, structureRows);
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
      message: [message, discoveryError].filter(Boolean).join(" "),
      hasKey,
      catalogDate,
      staticRegistryDate,
      checklist,
      groups,
      freeSpotlight: freeSpotlightState,
      exportNote: exportNote || undefined,
    };
    void panel?.webview.postMessage({ type: "state", state });
  };
  const discoverCopilot = async (gen: number) => {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (gen !== discoveryGen) return;
      availableBySource.copilot = models.map(
        ({ id, name, family, maxInputTokens }) => ({
          id,
          name,
          family,
          maxInputTokens,
          source: "copilot" as const,
        }),
      );
      discoveryError = availableBySource.copilot.length
        ? ""
        : "No Copilot models are exposed. Sign in to GitHub Copilot, enable Copilot Chat, and refresh.";
    } catch {
      if (gen !== discoveryGen) return;
      availableBySource.copilot = [];
      discoveryError =
        "Could not discover Copilot models. Check Copilot sign-in and refresh.";
    }
    render();
  };
  const discoverOpencode = async (gen: number) => {
    try {
      const models = await discoverOpenCode();
      if (gen !== discoveryGen) return;
      availableBySource.opencode = models;
      discoveryError = "";
    } catch (error) {
      if (gen !== discoveryGen) return;
      if (error instanceof OpenCodeError) {
        // Retain the previous listing on command/parse failures; clear only
        // when the error reports a genuinely empty or missing setup.
        if (error.kind === "missing" || error.kind === "empty")
          availableBySource.opencode = [];
        discoveryError = error.message;
      } else {
        discoveryError =
          "OpenCode discovery failed. Retry; the previous listing is retained.";
      }
    }
    render();
  };
  const discover = async () => {
    const gen = ++discoveryGen;
    if (options.source === "opencode") await discoverOpencode(gen);
    else if (options.source === "copilot") await discoverCopilot(gen);
    else {
      // Static registries need no discovery; clear stale errors.
      discoveryError = "";
      if (gen !== discoveryGen) return;
      render();
    }
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
    for (const watcher of usageWatchers) watcher.dispose();
    usageWatchers = [];
    usage = null;
    await context.globalState.update("usageConsent", false);
    try {
      await vscode.workspace.fs.delete(usageSummaryUri);
    } catch {
      // No stored scan to erase.
    }
    message =
      "Local usage data erased. Rescanning will ask for consent again.";
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
            const m = parseMessage(raw);
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
            }
            else if (m.type === "key") await setKey();
            else if (m.type === "source") {
              if (m.source !== options.source) {
                // Invalidate in-flight discovery before switching (B2).
                discoveryGen++;
                options = {
                  ...options,
                  source: m.source,
                  billing: defaultBilling(m.source),
                  freeOnly: false,
                };
                selected = undefined;
                await context.globalState.update("options", options);
                optionsRevision++;
                render();
                await discover();
              }
            } else if (m.type === "options") {
              options = parseOptions(m.options);
              await context.globalState.update("options", options);
              render();
            } else if (m.type === "profile") {
              const previousSource = options.source;
              const prevDisplay = options.display;
              const next = changeProfile(profileStore, options, m.change);
              await context.globalState.update("profiles", next.store);
              const withDisplay = { ...next.options, display: prevDisplay };
              await context.globalState.update("options", withDisplay);
              profileStore = next.store;
              options = withDisplay;
              if (m.change.action === "apply") optionsRevision++;
              if (options.source !== previousSource) {
                discoveryGen++;
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
              if (model) await vscode.env.clipboard.writeText(model.name);
            } else if (
              m.type === "mapping" &&
              typeof m.id === "string" &&
              typeof m.benchmarkId === "string" &&
              (m.benchmarkId === "" ||
                snapshot?.models.some((b) => b.id === m.benchmarkId))
            ) {
              const modelId = m.id.split("::")[0];
              if (
                availableBySource[options.source].some(
                  (a) => a.id === modelId,
                )
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
                    await context.globalState.update("mappings", overrides);
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
                    await context.globalState.update("pins", pins);
                  }
                } else {
                  overrides = { ...overrides };
                  if (m.benchmarkId) overrides[m.id] = m.benchmarkId;
                  else delete overrides[m.id];
                  await context.globalState.update("mappings", overrides);
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
                  await context.globalState.update("pins", pins);
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
                await context.globalState.update("pins", pins);
                if (selected === `${modelId}::${bench}`) selected = modelId;
                render();
              }
            } else if (m.type === "byok") {
              byok = m.rates;
              await context.globalState.update("byokRates", byok);
              message =
                Object.keys(byok).length === 0
                  ? "BYOK rates cleared."
                  : `Saved ${Object.keys(byok).length} BYOK rate${Object.keys(byok).length === 1 ? "" : "s"} for provider-billed OpenCode models.`;
              render();
            } else if (m.type === "exclude") {
              if (lastStructureIds.has(m.id)) {
                const current = new Set(excludedFor(options.source));
                if (m.excluded) current.add(m.id);
                else current.delete(m.id);
                excluded = { ...excluded, [options.source]: [...current] };
                await context.globalState.update("excluded", excluded);
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
              await context.globalState.update("excluded", excluded);
              render();
            } else if (m.type === "excludeAll") {
              excluded = {
                ...excluded,
                [options.source]: m.excluded
                  ? availableBySource[options.source].map((a) => a.id)
                  : [],
              };
              await context.globalState.update("excluded", excluded);
              render();
            } else if (
              m.type === "exportCsv" ||
              m.type === "exportSnapshot" ||
              m.type === "exportBadge"
            ) {
              try {
                const available = availableBySource[options.source];
                const unsorted = compare(
                  available,
                  snapshot?.models ?? [],
                  options,
                  overrides,
                  undefined,
                  {
                    pins,
                    excluded: excludedFor(options.source),
                    byok,
                    usedCounts: usedCountsFor(),
                  },
                );
                const rows =
                  options.display.sort === "efficiency"
                    ? sortRowsByEfficiency(unsorted)
                    : unsorted;
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
                  const payload =
                    m.type === "exportCsv"
                      ? exportCsv(rows, options, recommended)
                      : m.type === "exportSnapshot"
                        ? exportSnapshot(rows, options, recommended, {
                            source: options.source,
                            preset: options.preset,
                            billing: options.billing,
                            catalogDate,
                            staticRegistryDate,
                            version: snapshot?.version,
                            fetchedAt: snapshot?.fetchedAt,
                          })
                        : exportBadge(rows, options, {
                            source: options.source,
                            preset: options.preset,
                          });
                  await vscode.workspace.fs.writeFile(
                    uri,
                    Buffer.from(payload),
                  );
                  exportNote =
                    m.type === "exportBadge"
                      ? "Exported badge."
                      : `Exported ${rows.length} rows.`;
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
                const match =
                  /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(m.png);
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
      if (panel && options.source === "copilot") void discover();
    }),
  );
}
export function deactivate() {}
