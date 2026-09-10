import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { BenchmarkService, ApiError, cacheTtl } from "./api";
import { catalogDate } from "./catalog";
import { compare, parseOptions, savedOptions } from "./compare";
import { discoverOpenCode, OpenCodeError } from "./opencode";
import { html } from "./html";
import { recommend } from "./recommend";
import { loadProfiles, changeProfile, profileModified } from "./profiles";
import { parseMessage } from "./messages";
import type { AvailableModel, Snapshot, Source, ViewState } from "./types";
const secretName = "artificialAnalysis.apiKey";
export function activate(context: vscode.ExtensionContext) {
  const cacheUri = vscode.Uri.joinPath(
    context.globalStorageUri,
    "benchmarks.json",
  );
  const service = new BenchmarkService({
    read: async () =>
      JSON.parse(
        Buffer.from(await vscode.workspace.fs.readFile(cacheUri)).toString(),
      ),
    write: async (value) => {
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      const temporary = vscode.Uri.joinPath(
        context.globalStorageUri,
        "benchmarks.tmp.json",
      );
      await vscode.workspace.fs.writeFile(
        temporary,
        Buffer.from(JSON.stringify(value)),
      );
      await vscode.workspace.fs.rename(temporary, cacheUri, {
        overwrite: true,
      });
    },
  });
  service.retryAt = context.globalState.get<number>("retryAt", 0);
  let panel: vscode.WebviewPanel | undefined,
    snapshot: Snapshot | undefined,
    options = savedOptions(context.globalState.get("options"));
  const availableBySource: Record<Source, AvailableModel[]> = {
    copilot: [],
    opencode: [],
  };
  // Generation counter: switching sources invalidates in-flight discovery so
  // late results from the previous source can never render.
  let discoveryGen = 0;
  let overrides = context.globalState.get<Record<string, string>>(
      "mappings",
      {},
    ),
    selected: string | undefined,
    loading = false,
    message = "",
    discoveryError = "",
    hasKey = false;
  let profileStore = loadProfiles(context.globalState.get("profiles"));
  let optionsRevision = 0;
  const render = () => {
    const available = availableBySource[options.source];
    const rows = compare(available, snapshot?.models ?? [], options, overrides);
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
      loading,
      message: [message, discoveryError].filter(Boolean).join(" "),
      hasKey,
      catalogDate,
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
    else await discoverCopilot(gen);
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
  context.subscriptions.push(
    vscode.commands.registerCommand("paretoGhc.setApiKey", setKey),
    vscode.commands.registerCommand("paretoGhc.clearApiKey", async () => {
      await context.secrets.delete(secretName);
      hasKey = false;
      message = "API key removed. Cached benchmarks remain available.";
      render();
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
            } else if (m.type === "refresh") await refresh(true);
            else if (m.type === "key") await setKey();
            else if (m.type === "source") {
              if (m.source !== options.source) {
                // Invalidate in-flight discovery before switching (B2).
                discoveryGen++;
                options = {
                  ...options,
                  source: m.source,
                  billing: m.source === "opencode" ? "usd" : "credits",
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
              const next = changeProfile(profileStore, options, m.change);
              await context.globalState.update("profiles", next.store);
              await context.globalState.update("options", next.options);
              profileStore = next.store;
              options = next.options;
              if (m.change.action === "apply") optionsRevision++;
              if (options.source !== previousSource) {
                discoveryGen++;
                selected = undefined;
              } else if (
                selected &&
                !availableBySource[options.source].some(
                  (a) => a.id === selected,
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
            } else if (
              m.type === "select" &&
              typeof m.id === "string" &&
              availableBySource[options.source].some((a) => a.id === m.id)
            ) {
              selected = m.id;
              render();
            } else if (m.type === "copy" && typeof m.id === "string") {
              const model = availableBySource[options.source].find(
                (a) => a.id === m.id,
              );
              if (model) await vscode.env.clipboard.writeText(model.name);
            } else if (
              m.type === "mapping" &&
              typeof m.id === "string" &&
              availableBySource[options.source].some((a) => a.id === m.id) &&
              typeof m.benchmarkId === "string" &&
              (m.benchmarkId === "" ||
                snapshot?.models.some((b) => b.id === m.benchmarkId))
            ) {
              overrides = { ...overrides };
              if (m.benchmarkId) overrides[m.id] = m.benchmarkId;
              else delete overrides[m.id];
              await context.globalState.update("mappings", overrides);
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
