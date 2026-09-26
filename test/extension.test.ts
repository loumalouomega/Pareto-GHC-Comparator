import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { validSnapshot } from "../src/api";
import {
  exportPairSnapshot,
  exportSnapshot,
  snapshotRow,
  type PairSideInput,
} from "../src/export";
import { planRegistryDate } from "../src/plans";
import { defaults, type Row } from "../src/types";

/** Minimal RFC4180-style splitter (handles quoted fields with "" escapes),
 * for asserting a CSV row's actual column count regardless of embedded commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "",
    inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

test("extension discovers Copilot models, serves cached data, validates messages, and keeps secrets host-side", async () => {
  const commands = new Map<string, () => unknown>();
  const messages: unknown[] = [];
  const copied: string[] = [];
  const kicks: (() => void)[] = [];
  const writes: string[] = [];
  const exports: string[] = [];
  const textProviders = new Map<
    string,
    { provideTextDocumentContent: (uri: unknown) => Promise<string> | string }
  >();
  const shownDocs: { content: string }[] = [];
  const storageFiles = new Map<string, Uint8Array>();
  let pauseWrite: (() => Promise<void>) | undefined;
  let deleted = false;
  let deleteError = false;
  const statusItems: {
    text: string;
    tooltip: string;
    command: string;
    shown: boolean;
  }[] = [];
  let receiver: (m: unknown) => Promise<void> = async () => {},
    discoveryChanged = () => {};
  let configListener:
    | ((e: { affectsConfiguration(scope: string): boolean }) => void)
    | undefined;
  const configDefaults: Record<string, unknown> = {
    "usage.watchOnScan": true,
    "usage.retentionDays": 0,
    "chart.defaultView": "task",
  };
  const configValues: Record<string, unknown> = {};
  let discoveredVendor = "",
    secret = "DO_NOT_LEAK_API_KEY";
  const state = new Map<string, unknown>();
  const disposable = { dispose() {} };
  const cache = {
    version: "4.3",
    fetchedAt: Date.now(),
    models: [
      {
        id: "aa",
        slug: "gpt-5-mini",
        name: "GPT-5 mini",
        provider: "OpenAI",
        scores: { general: 30, coding: 40, agentic: 20 },
      },
    ],
  };
  cache.models.push({
    ...cache.models[0],
    id: "other",
    slug: "other",
    name: "Other (high)",
  });
  assert.ok(validSnapshot(cache));
  const prevCache = {
    version: "4.2",
    fetchedAt: cache.fetchedAt - 100000,
    models: [
      {
        id: "aa",
        slug: "gpt-5-mini",
        name: "GPT-5 mini",
        provider: "OpenAI",
        scores: { general: 28, coding: 40, agentic: 20 },
      },
    ],
  };
  assert.ok(validSnapshot(prevCache));
  const mock = {
    commands: {
      registerCommand: (id: string, fn: () => unknown) => {
        commands.set(id, fn);
        return disposable;
      },
    },
    Uri: {
      joinPath: (root: { path: string }, ...parts: string[]) => ({
        path: [root.path, ...parts].join("/"),
        toString() {
          return this.path;
        },
      }),
      parse: (value: string) => ({
        path: value,
        toString() {
          return value;
        },
      }),
    },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    window: {
      createWebviewPanel: () => ({
        webview: {
          cspSource: "https://resources.test",
          asWebviewUri: (u: unknown) => u,
          html: "",
          postMessage: (m: unknown) => messages.push(m),
          onDidReceiveMessage: (fn: typeof receiver) => {
            receiver = fn;
            return disposable;
          },
        },
        onDidDispose: () => disposable,
        reveal() {},
      }),
      showInputBox: async () => secret,
      showSaveDialog: async () => ({ path: "/exports/data" }),
      showInformationMessage: async () => "Scan locally",
      showTextDocument: async (doc: { content: string }) => {
        shownDocs.push(doc);
        return doc;
      },
      createStatusBarItem: () => {
        const item = {
          text: "",
          tooltip: "",
          command: "",
          shown: false,
          show() {
            item.shown = true;
          },
          hide() {
            item.shown = false;
          },
          dispose() {},
        };
        statusItems.push(item);
        return item;
      },
    },
    workspace: {
      getConfiguration: (section: string) => ({
        get: (key: string) =>
          section === "paretoGhc"
            ? (configValues[key] ?? configDefaults[key])
            : undefined,
        inspect: (key: string) => ({
          key: `${section}.${key}`,
          globalValue:
            section === "paretoGhc" ? configValues[key] : undefined,
        }),
        update: async (key: string, value: unknown) => {
          if (section === "paretoGhc") {
            if (value === undefined) delete configValues[key];
            else configValues[key] = value;
          }
          configListener?.({
            affectsConfiguration: (scope: string) =>
              section === scope ||
              (section ?? "").startsWith(`${scope}.`) ||
              scope.startsWith(`${section}.`),
          });
        },
      }),
      onDidChangeConfiguration: (
        fn: (e: { affectsConfiguration(scope: string): boolean }) => void,
      ) => {
        configListener = fn;
        return disposable;
      },
      registerTextDocumentContentProvider: (
        scheme: string,
        provider: {
          provideTextDocumentContent: (uri: unknown) => Promise<string> | string;
        },
      ) => {
        textProviders.set(scheme, provider);
        return disposable;
      },
      openTextDocument: async (uri: { path: string }) => {
        const provider = textProviders.get(String(uri.path).split(":")[0]);
        if (!provider) throw new Error("No text provider");
        return { uri, content: await provider.provideTextDocumentContent(uri) };
      },
      createFileSystemWatcher: () => ({
        onDidChange: (fn: () => void) => {
          kicks.push(fn);
        },
        onDidCreate() {},
        onDidDelete: (fn: () => void) => {
          kicks.push(fn);
        },
        dispose() {},
      }),
      fs: {
        readFile: async (uri: { path: string }) =>
          storageFiles.get(uri.path) ??
          Buffer.from(
            JSON.stringify(uri.path.includes("prev") ? prevCache : cache),
          ),
        createDirectory: async () => {},
        writeFile: async (uri: { path: string }, data: Uint8Array) => {
          if (uri.path === "/exports/data")
            exports.push(Buffer.from(data).toString());
          writes.push(uri.path);
          storageFiles.set(uri.path, data);
          await pauseWrite?.();
        },
        delete: async (uri: { path: string }) => {
          if (uri.path.endsWith("/usage.json")) {
            if (deleteError) throw new Error("write denied");
            deleted = true;
          }
          storageFiles.delete(uri.path);
        },
        rename: async (from: { path: string }, to: { path: string }) => {
          storageFiles.set(to.path, storageFiles.get(from.path)!);
          storageFiles.delete(from.path);
        },
      },
    },
    lm: {
      selectChatModels: async ({ vendor }: { vendor: string }) => {
        discoveredVendor = vendor;
        return [
          {
            id: "gpt-5-mini",
            name: "GPT-5 mini",
            family: "gpt-5-mini",
            maxInputTokens: 1000000,
            sendRequest: () => {
              throw new Error("Inference must never be called");
            },
          },
        ];
      },
      onDidChangeChatModels: (fn: () => void) => {
        discoveryChanged = fn;
        return disposable;
      },
    },
    env: {
      clipboard: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    },
  };
  (globalThis as any).__paretoVscodeMock = mock;
  // Watchlist tests below drive manual refreshes through the real download
  // path. BenchmarkService captures fetch at construction, so the stub must
  // precede activate; per-refresh scores come from the mutable apiGeneral.
  const apiModel = (id: string, slug: string, name: string, general: number) => ({
    id,
    slug,
    name,
    model_creator: { name: "OpenAI" },
    evaluations: {
      artificial_analysis_intelligence_index: general,
      artificial_analysis_coding_index: 40,
      artificial_analysis_agentic_index: 20,
    },
  });
  let apiGeneral = 32;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      pagination: { page: 1, has_more: false },
      intelligence_index_version: "4.4",
      data: [
        apiModel("aa", "gpt-5-mini", "GPT-5 mini", apiGeneral),
        apiModel("other", "other", "Other (high)", 30),
      ],
    }),
  })) as unknown as typeof fetch;
  const bundle = await build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "mock-vscode",
        setup(b) {
          b.onResolve({ filter: /^vscode$/ }, () => ({
            path: "vscode",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents:
              "const mock=globalThis.__paretoVscodeMock; export const {commands,Uri,ViewColumn,window,workspace,lm,env,RelativePattern,StatusBarAlignment}=mock;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const extension = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
  extension.activate({
    extensionUri: { path: "/extension" },
    globalStorageUri: { path: "/cache" },
    subscriptions: [],
    globalState: {
      get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
    },
    secrets: {
      get: async () => secret,
      store: async (_: string, value: string) => {
        secret = value;
      },
      delete: async () => {
        secret = "";
      },
    },
  });
  commands.get("paretoGhc.open")!();
  await receiver({ type: "ready" });
  assert.equal(discoveredVendor, "copilot");
  const last = () => (messages.at(-1) as any).state;
  assert.equal(last().rows[0].score, 30);
  assert.equal(last().rows[0].frontier, true);
  assert.equal(last().prevVersion, "4.2");
  assert.equal(last().drift.aa.delta, 2);
  assert.equal(last().drift.aa.prevScore, 28);
  await receiver({ type: "copy", id: "gpt-5-mini" });
  await receiver({ type: "copy", id: "fake" });
  assert.deepEqual(copied, ["GPT-5 mini"]);
  // Copilot has no verified invocable id: copy falls back to the display
  // name, with feedback saying so rather than claiming it's pasteable.
  assert.match(last().exportNote, /Copied model name "GPT-5 mini"/);
  assert.match(last().exportNote, /no verified invocable id/);
  await receiver({ type: "options", options: { preset: "bad" } });
  assert.match(last().message, /Could not apply/);
  await receiver({ type: "pin", id: "gpt-5-mini", benchmarkId: "aa" });
  await receiver({ type: "pin", id: "gpt-5-mini", benchmarkId: "other" });
  // Watchlist change alerts: the opt-in persists and surfaces in ViewState;
  // a manual refresh that downloads a new snapshot notifies once about the
  // pinned model's score change, citing both snapshot versions.
  await receiver({ type: "watchlistAlerts", enabled: true });
  assert.equal(state.get("watchlistAlerts"), true);
  assert.equal(last().watchlistAlerts, true);
  const infos: unknown[][] = [];
  const infoMessage = mock.window.showInformationMessage;
  mock.window.showInformationMessage = async (...args: unknown[]) => {
    infos.push(args);
    return "Scan locally";
  };
  await receiver({ type: "refresh" });
  assert.ok(
    infos.some(
      (a) =>
        String(a[0]).includes("Watchlist changes") &&
        String(a[0]).includes("v4.3 → v4.4") &&
        String(a[0]).includes("GPT-5 mini"),
    ),
  );
  // Opting out silences further refreshes; re-enabling with an unchanged
  // snapshot stays silent too (same scores, only a new retrieval timestamp).
  await receiver({ type: "watchlistAlerts", enabled: false });
  assert.equal(last().watchlistAlerts, false);
  // Scores move again on the next download, but the disabled flag silences it.
  apiGeneral = 33;
  await receiver({ type: "refresh" });
  const watchInfos = () =>
    infos.filter((a) => String(a[0]).includes("Watchlist changes"));
  assert.equal(watchInfos().length, 1);
  await receiver({ type: "watchlistAlerts", enabled: true });
  await receiver({ type: "refresh" });
  assert.equal(watchInfos().length, 1);
  globalThis.fetch = realFetch;
  mock.window.showInformationMessage = infoMessage;
  const leaves = () =>
    last().groups.flatMap((g: any) => g.models.flatMap((m: any) => m.leaves));
  const variantIds = leaves().map((leaf: any) => leaf.id);
  assert.equal(variantIds.length, 2);
  await receiver({
    type: "options",
    options: { ...last().options, onlyMine: true },
  });
  assert.equal(last().rows.length, 0);
  assert.deepEqual(
    leaves().map((leaf: any) => leaf.id),
    variantIds,
  );
  await receiver({ type: "excludeMany", ids: variantIds, excluded: true });
  assert.deepEqual((state.get("excluded") as any).copilot, variantIds);
  await receiver({ type: "excludeMany", ids: variantIds, excluded: false });
  await receiver({
    type: "options",
    options: { ...last().options, onlyMine: false },
  });
  await receiver({ type: "unpin", id: "gpt-5-mini", benchmarkId: "aa" });
  await receiver({ type: "unpin", id: "gpt-5-mini", benchmarkId: "other" });
  await receiver({ type: "mapping", id: "gpt-5-mini", benchmarkId: "aa" });
  assert.deepEqual(state.get("mappings"), { "gpt-5-mini": "aa" });
  // Plan-aware spending scenario: an "options" message with a scenario
  // persists and the served state carries scenario/scenarioPrefill/
  // planRegistryDate; scenarioPrefill is null without a usage scan.
  assert.equal(last().planRegistryDate, planRegistryDate);
  assert.equal(last().scenario.status, "off");
  assert.equal(last().scenarioPrefill, null);
  await receiver({
    type: "options",
    options: {
      ...last().options,
      scenario: { ...last().options.scenario, planId: "copilot-pro", requestsLow: 5, requestsHigh: 5 },
    },
  });
  assert.equal(last().options.scenario.planId, "copilot-pro");
  assert.equal(last().scenario.status, "projected");
  assert.equal((state.get("options") as any)?.scenario.planId, "copilot-pro");
  const byokRates = {
    "opencode:openai/gpt-5.4": {
      rates: { input: 1, read: 1, write: null, output: 1 },
    },
  };
  const byokStored = {
    "opencode:openai/gpt-5.4": {
      rates: { input: 1, read: 1, write: null, output: 1 },
      source: { kind: "manual" },
    },
  };
  await receiver({ type: "byok", rates: byokRates });
  assert.deepEqual(state.get("byokRates"), byokStored);
  assert.deepEqual(last().byok, byokStored);
  assert.match(last().message, /BYOK rate/);
  await receiver({ type: "byok", rates: { "bad id": {} } });
  assert.match(last().message, /Could not apply/);
  await receiver({
    type: "profile",
    change: { action: "saveAs", name: "Debugging" },
  });
  const profileId = last().activeProfileId;
  assert.equal(last().profiles[0].name, "Debugging");
  assert.ok(!("filter" in (state.get("profiles") as any).items[0].workload));
  await receiver({
    type: "options",
    options: {
      ...last().options,
      tokens: { input: 4000, read: 0, write: 0, output: 1000 },
      filter: "mini",
    },
  });
  assert.equal(last().profileModified, true);
  await receiver({
    type: "profile",
    change: { action: "apply", id: profileId },
  });
  assert.equal(last().options.tokens.input, 1000);
  assert.equal(last().options.filter, "mini");
  assert.equal(last().optionsRevision, 1);
  assert.equal(last().rows[0].mappingStatus, "user");
  assert.deepEqual(last().recommendation.modelIds, ["gpt-5-mini"]);
  await receiver({
    type: "profile",
    change: { action: "saveAs", name: " debugging " },
  });
  assert.match(last().message, /already exists/);
  discoveryChanged();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!JSON.stringify(messages).includes(secret));
  await commands.get("paretoGhc.clearApiKey")!();
  assert.equal(last().hasKey, false);
  const originalOptions = structuredClone(last().options);
  const originalProfile = structuredClone(state.get("profiles"));
  await receiver({ type: "comparison", enabled: true });
  assert.equal(last().comparison.active, "A");
  assert.equal(last().comparison.view, "side-by-side");
  assert.equal(last().comparison.overlay, undefined);
  await receiver({
    type: "target",
    side: "A",
    action: { type: "pin", id: "gpt-5-mini", benchmarkId: "other" },
  });
  assert.equal(last().comparison.sides.A.rows[0].benchmark.id, "other");
  assert.equal(last().comparison.sides.B.rows[0].benchmark.id, "aa");
  await receiver({
    type: "target",
    side: "A",
    action: { type: "unpin", id: "gpt-5-mini", benchmarkId: "other" },
  });

  await receiver({ type: "comparison", active: "B", name: "Alternative" });
  await receiver({
    type: "target",
    side: "B",
    action: { type: "source", source: "codex" },
  });
  assert.equal(last().comparison.sides.A.options.source, "copilot");
  assert.equal(last().comparison.sides.B.options.source, "codex");
  await receiver({
    type: "target",
    side: "B",
    action: {
      type: "options",
      options: { ...last().options, filter: "", preset: "coding" },
    },
  });
  assert.equal(last().comparison.sides.A.options.preset, "coding");
  assert.deepEqual(state.get("options"), originalOptions);
  await receiver({
    type: "target",
    side: "A",
    action: { type: "excludeAll", excluded: true },
  });
  assert.equal(last().comparison.sides.A.rows.length, 0);
  assert.ok(last().comparison.sides.B.rows.length > 0);
  await receiver({
    type: "target",
    side: "B",
    action: { type: "exportSnapshot" },
  });
  const snapshotExport = JSON.parse(exports.at(-1)!);
  assert.equal(snapshotExport.version, 3);
  assert.equal(snapshotExport.kind, "comparison");
  assert.equal(snapshotExport.options.length, 2);
  // Pair rows share the single-snapshot projection (tested variant, mapping
  // status/reasons, pricing source/issue/provenance), plus per-option unit
  // and cost basis.
  assert.deepEqual(
    snapshotExport.options[1].rows,
    last().comparison.sides.B.rows.map((r: Row) =>
      snapshotRow(
        r,
        new Set(last().comparison.sides.B.recommendation.modelIds),
      ),
    ),
  );
  assert.equal(snapshotExport.options[1].unit, "USD");
  assert.equal(snapshotExport.options[1].costBasis.basis, "task");
  assert.deepEqual(snapshotExport.options[1].costBasis.effectiveTokens, {
    input: 1000,
    read: 0,
    write: 0,
    output: 1000,
  });
  // Side B carries its own scenario in the pair snapshot; switching it to
  // codex (USD billing) makes the copied "copilot-pro" scenario unavailable
  // rather than silently approximated for a different source.
  assert.equal(snapshotExport.options[1].planRegistryDate, planRegistryDate);
  assert.equal(snapshotExport.options[1].scenario.status, "unavailable");
  assert.match(snapshotExport.options[1].scenario.reason, /Copilot only/);
  await receiver({ type: "target", side: "B", action: { type: "exportCsv" } });
  assert.match(exports.at(-1)!, /option,assumptions/);
  assert.match(exports.at(-1)!, /\nA,/);
  assert.match(exports.at(-1)!, /\nB,/);
  // The empty-option row (side A has 0 rows here) must pad to the same
  // column count as a populated row (side B), not a stale hardcoded width.
  {
    const csvLines = exports.at(-1)!.trim().split("\n");
    const header = splitCsvLine(csvLines[0]);
    const rowA = splitCsvLine(csvLines.find((l) => l.startsWith("A,"))!);
    const rowB = splitCsvLine(csvLines.find((l) => l.startsWith("B,"))!);
    assert.equal(rowA.length, header.length);
    assert.equal(rowB.length, header.length);
  }
  // USD-equivalent normalization: off by default, and once toggled on, each
  // side's selected cost and a comparison-wide delta appear in both exports.
  // Side A has 0 rows (excludeAll above), side B is priced in USD (codex).
  assert.equal(last().comparison.normalize, false);
  await receiver({ type: "comparison", normalize: true });
  assert.equal(last().comparison.normalize, true);
  await receiver({
    type: "target",
    side: "B",
    action: { type: "exportSnapshot" },
  });
  const normalizedSnapshot = JSON.parse(exports.at(-1)!);
  // Side A has no rows (excludeAll) and side B's rows have no benchmark
  // mapping in this fixture, so neither side has a *selected* row; the
  // selected-cost normalization is unavailable on both, but individual rows
  // (asserted via CSV below) still convert independently of selection.
  assert.equal(normalizedSnapshot.options[0].costNormalization.status, "unavailable");
  assert.equal(normalizedSnapshot.options[1].costNormalization.status, "unavailable");
  assert.match(
    normalizedSnapshot.usdCostDelta.reason,
    /A not converted: Cost unavailable/,
  );
  assert.equal(normalizedSnapshot.usdCostDelta.delta, null);
  await receiver({ type: "target", side: "B", action: { type: "exportCsv" } });
  const normalizedCsv = exports.at(-1)!;
  assert.match(normalizedCsv, /^option,assumptions,usd_equivalent,usd_conversion,/);
  {
    const csvLines = normalizedCsv.trim().split("\n");
    const header = splitCsvLine(csvLines[0]);
    const rowA = splitCsvLine(csvLines.find((l) => l.startsWith("A,"))!);
    const rowB = splitCsvLine(csvLines.find((l) => l.startsWith("B,"))!);
    assert.equal(rowA.length, header.length);
    assert.equal(rowB.length, header.length);
    assert.equal(rowB[3], "native");
  }
  await receiver({ type: "comparison", normalize: false });
  await receiver({ type: "target", side: "B", action: { type: "exportCsv" } });
  {
    const csvLines = exports.at(-1)!.trim().split("\n");
    const rowB = splitCsvLine(csvLines.find((l) => l.startsWith("B,"))!);
    assert.equal(rowB[3], "off");
  }
  await receiver({
    type: "target",
    side: "B",
    action: { type: "profile", change: { action: "apply", id: profileId } },
  });
  assert.equal(last().comparison.sides.B.options.source, "copilot");
  assert.deepEqual(state.get("profiles"), originalProfile);
  await receiver({ type: "comparison", enabled: false });
  assert.deepEqual(last().options, originalOptions);
  assert.equal(last().comparison, undefined);
  await receiver({ type: "comparison", enabled: true });
  assert.equal(last().comparison.sides.B.name, "Alternative");
  assert.equal(last().comparison.sides.A.rows.length, 0);
  // Overlay view: the host computes and attaches one merged result instead
  // of two independent ones; switching back drops it.
  await receiver({ type: "comparison", view: "overlay" });
  assert.equal(last().comparison.view, "overlay");
  const overlay = last().comparison.overlay;
  assert.ok(overlay);
  assert.equal(typeof overlay.unit, "string");
  assert.deepEqual(Object.keys(overlay.excluded).sort(), ["A", "B"]);
  assert.ok(Array.isArray(overlay.rows));
  assert.ok(Array.isArray(overlay.notices));
  assert.ok(
    overlay.rows.every(
      (r: { side: string }) => r.side === "A" || r.side === "B",
    ),
  );
  await receiver({ type: "comparison", view: "side-by-side" });
  assert.equal(last().comparison.view, "side-by-side");
  assert.equal(last().comparison.overlay, undefined);
  await receiver({ type: "comparison", enabled: false });
  writes.length = 0;
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  const appdata = process.env.APPDATA;
  const empty = mkdtempSync(join(tmpdir(), "pareto-usage-"));
  process.env.HOME = empty;
  process.env.XDG_CONFIG_HOME = join(empty, "xdg");
  process.env.APPDATA = join(empty, "appdata");
  try {
    await receiver({ type: "scanUsage" });
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);
    assert.equal(last().usage.requestCount, 0);
    assert.equal(last().usage.fileCount, 0);
    assert.match(last().message, /Local usage ready/);
    assert.equal(last().usageWatching, true);
    const sessionDir = join(
      empty,
      "xdg",
      "Code",
      "User",
      "workspaceStorage",
      "ws",
      "chatSessions",
    );
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = join(sessionDir, "fixture.jsonl");
    const session = JSON.stringify({
      kind: 1,
      k: ["requests", 0, "result"],
      v: {
        metadata: {
          modelId: "copilot/gpt-5-mini",
          promptTokens: 0,
          outputTokens: 12,
        },
      },
    });
    writeFileSync(sessionPath, session);
    await receiver({ type: "scanUsage" });
    assert.equal(last().usage.requestCount, 1);
    assert.equal(last().usage.medianSample, 1);
    writeFileSync(sessionPath, '{"unsupported":true}');
    await receiver({ type: "scanUsage" });
    assert.equal(last().usage.requestCount, 1);
    assert.equal(last().usage.diagnostics.stale, 1);
    assert.equal(last().usage.diagnostics.unsupported, 1);
    writeFileSync(sessionPath, session + "\n{truncated");
    await receiver({ type: "scanUsage" });
    assert.equal(last().usage.requestCount, 1);
    assert.equal(last().usage.diagnostics.malformed, 1);
    unlinkSync(sessionPath);
    await receiver({ type: "scanUsage" });
    assert.equal(last().usage.requestCount, 0);
    assert.equal(last().usage.diagnostics.stale, 0);
    assert.equal(last().usage.diagnostics.malformed, 0);

    // Pause stops the watcher without revoking consent or deleting data.
    assert.equal(statusItems.length, 1);
    assert.equal(statusItems[0].shown, true);
    assert.match(statusItems[0].text, /watching/);
    assert.ok(commands.has("paretoGhc.pauseUsage"));
    assert.ok(commands.has("paretoGhc.resumeUsage"));
    const kicksBeforePause = kicks.length;
    await receiver({ type: "pauseUsage" });
    assert.equal(state.get("usagePaused"), true);
    assert.equal(last().usagePaused, true);
    assert.equal(last().usageWatching, false);
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);
    assert.notEqual(last().usage, null);
    assert.match(last().message, /paused/);
    assert.match(statusItems[0].text, /paused/);
    assert.equal(statusItems[0].command, "paretoGhc.resumeUsage");
    // A debounced watcher kick pending at pause time never scans.
    vi.useFakeTimers();
    kicks[0]();
    await receiver({ type: "pauseUsage" });
    const pausedWrites = writes.length;
    await vi.advanceTimersByTimeAsync(1100);
    assert.equal(writes.length, pausedWrites);
    vi.useRealTimers();
    await receiver({ type: "resumeUsage" });
    assert.equal(state.get("usagePaused"), false);
    assert.equal(last().usagePaused, false);
    assert.equal(last().usageWatching, true);
    assert.ok(kicks.length > kicksBeforePause);
    assert.match(last().message, /Watching/);
    assert.match(statusItems[0].text, /watching/);
    assert.equal(statusItems[0].command, "paretoGhc.pauseUsage");
    // Pausing via the registered command keeps stored data too.
    await (commands.get("paretoGhc.pauseUsage")!() as Promise<void>);
    assert.equal(state.get("usagePaused"), true);
    assert.notEqual(last().usage, null);
    await (commands.get("paretoGhc.resumeUsage")!() as Promise<void>);
    assert.equal(state.get("usagePaused"), false);
    assert.equal(last().usageWatching, true);

    // Retention is unlimited by default: stored history survives scans untouched.
    assert.equal(last().usageRetentionDays, undefined);
    const oldPath = join(sessionDir, "old.jsonl");
    const recentPath = join(sessionDir, "recent.jsonl");
    const resultLine = (index: number) =>
      JSON.stringify({
        kind: 1,
        k: ["requests", index, "result"],
        v: {
          metadata: {
            modelId: "copilot/gpt-5-mini",
            promptTokens: 5,
            outputTokens: 5,
          },
        },
      });
    writeFileSync(
      oldPath,
      [
        JSON.stringify({
          kind: 0,
          v: {
            sessionId: "old",
            creationDate: Date.now() - 60 * 86400000,
          },
        }),
        resultLine(0),
      ].join("\n"),
    );
    writeFileSync(
      recentPath,
      [
        JSON.stringify({
          kind: 0,
          v: { sessionId: "recent", creationDate: Date.now() },
        }),
        resultLine(0),
      ].join("\n"),
    );
    await receiver({ type: "setUsageRetention", days: 30 });
    assert.equal(state.get("usageRetentionDays"), 30);
    assert.equal(last().usageRetentionDays, 30);
    assert.equal(last().usage.requestCount, 1);
    assert.equal(last().usage.fileCount, 1);
    assert.match(
      last().message,
      /Retention \(30 days\): purged 1 requests from 1 sessions/,
    );
    // The stored snapshot served to the inspection view reflects the purge.
    assert.ok(commands.has("paretoGhc.showUsageData"));
    await (commands.get("paretoGhc.showUsageData")!() as Promise<void>);
    assert.equal(shownDocs.length, 1);
    const stored = JSON.parse(shownDocs[0].content);
    assert.equal(stored.version, 2);
    assert.ok(
      Object.keys(stored.files).some((p: string) => p.endsWith("recent.jsonl")),
    );
    assert.ok(
      Object.keys(stored.files).every((p: string) => !p.endsWith("old.jsonl")),
    );
    await receiver({ type: "showUsageData" });
    assert.equal(shownDocs.length, 2);
    // Back to unlimited: the purge stops applying on the next scan.
    unlinkSync(oldPath);
    await receiver({ type: "setUsageRetention", days: 0 });
    assert.equal(state.get("usageRetentionDays"), undefined);
    assert.equal(last().usageRetentionDays, undefined);
    assert.equal(last().usage.requestCount, 1);
    assert.doesNotMatch(last().message, /Retention/);
    // Invalid retention values are rejected without changing stored state.
    await receiver({ type: "setUsageRetention", days: -3 });
    assert.match(last().message, /Could not apply/);
    assert.equal(state.get("usageRetentionDays"), undefined);
    unlinkSync(recentPath);

    assert.ok(
      writes.every((path) => /usage.json\.[a-f0-9]+\.tmp.json$/.test(path)),
    );
    vi.useFakeTimers();
    kicks[0]();
    await receiver({ type: "clearUsage" });
    const writeCount = writes.length;
    await vi.advanceTimersByTimeAsync(1100);
    assert.equal(writes.length, writeCount);
    assert.equal(last().usageWatching, false);
    vi.useRealTimers();

    // Clearing while a scan is writing waits for it, then deletes its result.
    let release!: () => void;
    let writing!: () => void;
    const started = new Promise<void>((resolve) => {
      writing = resolve;
    });
    pauseWrite = () =>
      new Promise<void>((resolve) => {
        release = resolve;
        writing();
      });
    const scanning = commands.get("paretoGhc.scanUsage")!() as Promise<void>;
    await started;
    deleted = false;
    const clearing = commands.get("paretoGhc.clearUsage")!() as Promise<void>;
    await Promise.resolve();
    assert.equal(deleted, false);
    release();
    await Promise.all([scanning, clearing]);
    assert.equal(deleted, true);
    assert.equal(last().usageWatching, false);
    assert.equal(last().usage, null);
    assert.deepEqual(state.get("usageRoots"), []);
    assert.equal(state.get("usagePaused"), false);
    assert.equal(statusItems[0].shown, false);
    assert.match(last().message, /erased/);
    deleteError = true;
    await receiver({ type: "clearUsage" });
    assert.match(last().message, /could not be erased/);
    assert.deepEqual(state.get("usageRoots"), []);
    // With no stored snapshot, the inspection view explains instead of failing.
    storageFiles.delete("/cache/usage.json");
    await (commands.get("paretoGhc.showUsageData")!() as Promise<void>);
    assert.match(shownDocs.at(-1)!.content, /No stored Copilot usage data/);
  } finally {
    vi.useRealTimers();
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    if (xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = xdg;
    if (appdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = appdata;
  }
  delete (globalThis as any).__paretoVscodeMock;
});

test("extension settings mirror stored state and apply without reload", async () => {
  const commands = new Map<string, () => unknown>();
  const messages: unknown[] = [];
  const disposable = { dispose() {} };
  const cache = {
    version: "4.3",
    fetchedAt: Date.now(),
    models: [
      {
        id: "aa",
        slug: "gpt-5-mini",
        name: "GPT-5 mini",
        provider: "OpenAI",
        scores: { general: 30, coding: 40, agentic: 20 },
      },
    ],
  };
  const state = new Map<string, unknown>();
  const storageFiles = new Map<string, Uint8Array>([
    ["/cache/benchmarks.json", Buffer.from(JSON.stringify(cache))],
  ]);
  let receiver: (m: unknown) => Promise<void> = async () => {};
  let configListener:
    | ((e: { affectsConfiguration(scope: string): boolean }) => void)
    | undefined;
  const configDefaults: Record<string, unknown> = {
    "usage.watchOnScan": true,
    "usage.retentionDays": 0,
    "chart.defaultView": "task",
  };
  const configValues: Record<string, unknown> = {
    // A fresh install starts from the configured chart default.
    "chart.defaultView": "workload",
  };
  const fireConfig = () =>
    configListener?.({
      affectsConfiguration: (scope: string) =>
        scope === "paretoGhc" || "paretoGhc.".startsWith(`${scope}.`),
    });
  const mock = {
    commands: {
      registerCommand: (id: string, fn: () => unknown) => {
        commands.set(id, fn);
        return disposable;
      },
    },
    Uri: {
      joinPath: (root: { path: string }, ...parts: string[]) => ({
        path: [root.path, ...parts].join("/"),
        toString() {
          return this.path;
        },
      }),
      parse: (value: string) => ({
        path: value,
        toString() {
          return value;
        },
      }),
    },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    window: {
      createWebviewPanel: () => ({
        webview: {
          cspSource: "https://resources.test",
          asWebviewUri: (u: unknown) => u,
          html: "",
          postMessage: (m: unknown) => messages.push(m),
          onDidReceiveMessage: (fn: typeof receiver) => {
            receiver = fn;
            return disposable;
          },
        },
        onDidDispose: () => disposable,
        reveal() {},
      }),
      showInformationMessage: async () => "Scan locally",
      createStatusBarItem: () => ({
        text: "",
        tooltip: "",
        command: "",
        shown: false,
        show() {},
        hide() {},
        dispose() {},
      }),
    },
    workspace: {
      getConfiguration: (section: string) => ({
        get: (key: string) =>
          section === "paretoGhc"
            ? (configValues[key] ?? configDefaults[key])
            : undefined,
        inspect: (key: string) => ({
          key: `${section}.${key}`,
          globalValue:
            section === "paretoGhc" ? configValues[key] : undefined,
        }),
        update: async (key: string, value: unknown) => {
          if (section === "paretoGhc") {
            if (value === undefined) delete configValues[key];
            else configValues[key] = value;
          }
          fireConfig();
        },
      }),
      onDidChangeConfiguration: (
        fn: (e: { affectsConfiguration(scope: string): boolean }) => void,
      ) => {
        configListener = fn;
        return disposable;
      },
      registerTextDocumentContentProvider: () => disposable,
      createFileSystemWatcher: () => ({
        onDidChange() {},
        onDidCreate() {},
        onDidDelete() {},
        dispose() {},
      }),
      fs: {
        readFile: async (uri: { path: string }) => {
          const data = storageFiles.get(uri.path);
          if (!data) throw Object.assign(new Error("missing"), { code: "FileNotFound" });
          return data;
        },
        createDirectory: async () => {},
        writeFile: async (uri: { path: string }, data: Uint8Array) => {
          storageFiles.set(uri.path, data);
        },
        delete: async (uri: { path: string }) => {
          storageFiles.delete(uri.path);
        },
        rename: async (from: { path: string }, to: { path: string }) => {
          storageFiles.set(to.path, storageFiles.get(from.path)!);
          storageFiles.delete(from.path);
        },
      },
    },
    lm: {
      selectChatModels: async () => [
        {
          id: "gpt-5-mini",
          name: "GPT-5 mini",
          family: "gpt-5-mini",
          maxInputTokens: 1000000,
        },
      ],
      onDidChangeChatModels: () => disposable,
    },
    env: { clipboard: { writeText: async () => {} } },
  };
  (globalThis as any).__paretoVscodeMock = mock;
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  const appdata = process.env.APPDATA;
  const empty = mkdtempSync(join(tmpdir(), "pareto-settings-"));
  process.env.HOME = empty;
  process.env.XDG_CONFIG_HOME = join(empty, "xdg");
  process.env.APPDATA = join(empty, "appdata");
  try {
    const bundle = await build({
      entryPoints: ["src/extension.ts"],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      plugins: [
        {
          name: "mock-vscode",
          setup(b) {
            b.onResolve({ filter: /^vscode$/ }, () => ({
              path: "vscode",
              namespace: "mock",
            }));
            b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
              contents:
                "const mock=globalThis.__paretoVscodeMock; export const {commands,Uri,ViewColumn,window,workspace,lm,env,RelativePattern,StatusBarAlignment}=mock;",
              loader: "js",
            }));
          },
        },
      ],
    });
    const extension = await import(
      // A nonce comment keeps this bundle's data URL distinct from the other
      // extension-host bundle in this file: identical bytes would share Node's
      // data-URL module cache and keep the other test's vscode mock.
      `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n// pareto-settings-host-test`).toString("base64")}`
    );
    extension.activate({
      extensionUri: { path: "/extension" },
      globalStorageUri: { path: "/cache" },
      subscriptions: [],
      globalState: {
        get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
        update: async (key: string, value: unknown) => {
          state.set(key, value);
        },
      },
      secrets: { get: async () => "key" },
    });
    commands.get("paretoGhc.open")!();
    await receiver({ type: "ready" });
    const last = () => (messages.at(-1) as any).state;
    const revision = () => last().optionsRevision;
    // The host queues webview messages; poll until the expected state lands.
    const waitFor = async (cond: () => boolean, label: string) => {
      for (let i = 0; i < 500 && !cond(); i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.ok(cond(), label);
    };
    // Fresh install: no saved chart choice, so the configured default wins.
    await waitFor(
      () => last()?.options.display.chart === "workload",
      "initial chart follows the configured default",
    );
    assert.equal(state.get("options"), undefined);
    // Clearing the setting keeps the current view instead of resetting it.
    delete configValues["chart.defaultView"];
    fireConfig();
    assert.equal(last().options.display.chart, "workload");
    // An explicitly configured retention window shows before any consent and
    // never triggers a scan on its own.
    configValues["usage.retentionDays"] = 30;
    fireConfig();
    assert.equal(last().usageRetentionDays, 30);
    assert.equal(last().usage, null);
    // The first consented scan starts watching per the default (watch on).
    await receiver({ type: "scanUsage" });
    await waitFor(
      () => last()?.usageWatching === true,
      "first consented scan starts watching",
    );
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);
    // Retention applies on scans: an older request is purged.
    const sessionDir = join(
      empty,
      "xdg",
      "Code",
      "User",
      "workspaceStorage",
      "ws",
      "chatSessions",
    );
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "old.jsonl"),
      JSON.stringify({
        kind: 1,
        k: ["requests", 0, "result"],
        v: {
          metadata: { modelId: "copilot/gpt-5-mini", promptTokens: 5, outputTokens: 5 },
          timings: { requestSent: Date.now() - 40 * 86400000 },
        },
      }),
    );
    await receiver({ type: "scanUsage" });
    await waitFor(
      () => last()?.usage?.requestCount === 0,
      "retention purge applies on scan",
    );
    assert.match(last().message, /Retention \(30 days\): purged 1/);
    // Switching the watch default off stops watching without touching
    // consent or stored data; switching it back on resumes watching.
    configValues["usage.watchOnScan"] = false;
    fireConfig();
    await waitFor(
      () => last()?.usageWatching === false,
      "watch default off stops watching",
    );
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);
    assert.notEqual(last().usage, null);
    configValues["usage.watchOnScan"] = true;
    fireConfig();
    await waitFor(
      () => last()?.usageWatching === true,
      "watch default on resumes watching",
    );
    // An explicit pause still wins over an enabled watch default.
    await receiver({ type: "pauseUsage" });
    await waitFor(() => last()?.usagePaused === true, "explicit pause sticks");
    fireConfig();
    assert.equal(last().usageWatching, false);
    await receiver({ type: "resumeUsage" });
    await waitFor(
      () => last()?.usageWatching === true,
      "explicit resume restarts watching",
    );
    // The Usage tab input mirrors into the explicitly configured setting.
    await receiver({ type: "setUsageRetention", days: 60 });
    await waitFor(
      () => last()?.usageRetentionDays === 60,
      "tab edit mirrors into the configured setting",
    );
    assert.equal(configValues["usage.retentionDays"], 60);
    assert.equal(state.get("usageRetentionDays"), 60);
    // Clearing the setting falls back to the stored value; later tab edits
    // then stay in stored state without touching Settings.
    delete configValues["usage.retentionDays"];
    fireConfig();
    assert.equal(last().usageRetentionDays, 60);
    await receiver({ type: "setUsageRetention", days: 45 });
    await waitFor(
      () => last()?.usageRetentionDays === 45,
      "cleared setting falls back to stored state",
    );
    assert.equal(state.get("usageRetentionDays"), 45);
    assert.equal("usage.retentionDays" in configValues, false);
    // An explicitly invalid setting falls back to stored state, no crash.
    configValues["usage.retentionDays"] = -5;
    fireConfig();
    assert.equal(last().usageRetentionDays, 45);
    delete configValues["usage.retentionDays"];
    fireConfig();
    // An explicitly configured chart basis applies to the open chart without
    // reload, without touching saved profiles.
    const before = revision();
    configValues["chart.defaultView"] = "task";
    fireConfig();
    await waitFor(
      () => last()?.options.display.chart === "task",
      "configured chart basis applies without reload",
    );
    assert.ok(revision() > before);
    assert.equal(last().profileModified, false);
    // A later panel chart edit wins until the setting itself changes again:
    // unrelated configuration events must not stomp it.
    await receiver({
      type: "options",
      options: { ...last().options, display: { ...last().options.display, chart: "workload" } },
    });
    await waitFor(
      () =>
        last()?.options.display.chart === "workload" &&
        state.get("options") !== undefined,
      "panel chart edit persists",
    );
    fireConfig();
    assert.equal(last().options.display.chart, "workload");
  } finally {
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    if (xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = xdg;
    if (appdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = appdata;
  }
  delete (globalThis as any).__paretoVscodeMock;
});

test("an imported snapshot reopens read-only, refuses live edits, and reopens with the panel", async () => {
  const commands = new Map<string, () => unknown>();
  const messages: unknown[] = [];
  const files = new Map<string, string>();
  const disposable = { dispose() {} };
  const state = new Map<string, unknown>();
  const cache = {
    version: "4.4",
    fetchedAt: Date.now(),
    models: [
      {
        id: "aa",
        slug: "gpt-5-mini",
        name: "GPT-5 mini",
        provider: "OpenAI",
        scores: { general: 30, coding: 40, agentic: 20 },
      },
    ],
  };
  files.set("/cache/benchmarks.json", JSON.stringify(cache));
  let receiver: (m: unknown) => Promise<void> = async () => {};
  let disposePanel: (() => void) | undefined;
  let openPath = "/exports/does-not-exist.json";
  const infos: string[] = [];
  const mock = {
    commands: {
      registerCommand: (id: string, fn: () => unknown) => {
        commands.set(id, fn);
        return disposable;
      },
      executeCommand: async (id: string) => commands.get(id)?.(),
    },
    Uri: {
      joinPath: (root: { path: string }, ...parts: string[]) => ({
        path: [root.path, ...parts].join("/"),
        toString() {
          return this.path;
        },
      }),
      parse: (value: string) => ({
        path: value,
        toString() {
          return value;
        },
      }),
    },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 100 },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    window: {
      createWebviewPanel: () => ({
        webview: {
          cspSource: "https://resources.test",
          asWebviewUri: (u: unknown) => u,
          html: "",
          postMessage: (m: unknown) => messages.push(m),
          onDidReceiveMessage: (fn: typeof receiver) => {
            receiver = fn;
            return disposable;
          },
        },
        onDidDispose: (fn: () => void) => {
          disposePanel = fn;
          return disposable;
        },
        reveal() {},
      }),
      showOpenDialog: async () => [{ path: openPath, toString: () => openPath }],
      showSaveDialog: async () => undefined,
      showInformationMessage: async (...args: unknown[]) => {
        infos.push(String(args[0]));
        return undefined;
      },
      showWarningMessage: async (...args: unknown[]) => {
        infos.push(String(args[0]));
        return undefined;
      },
      createStatusBarItem: () => ({
        text: "",
        tooltip: "",
        command: "",
        shown: false,
        show() {},
        hide() {},
        dispose() {},
      }),
    },
    workspace: {
      getConfiguration: () => ({
        get: () => undefined,
        inspect: () => ({ key: "paretoGhc", globalValue: undefined }),
        update: async () => {},
      }),
      onDidChangeConfiguration: () => disposable,
      registerTextDocumentContentProvider: () => disposable,
      createFileSystemWatcher: () => ({
        onDidChange() {},
        onDidCreate() {},
        onDidDelete() {},
        dispose() {},
      }),
      fs: {
        stat: async (uri: { path: string }) => ({
          size: files.get(uri.path)?.length ?? 0,
        }),
        readFile: async (uri: { path: string }) => {
          const found = files.get(uri.path);
          if (found === undefined) throw new Error("missing");
          return Buffer.from(found);
        },
        writeFile: async (uri: { path: string }, data: Uint8Array) => {
          files.set(uri.path, Buffer.from(data).toString());
        },
        createDirectory: async () => {},
        delete: async (uri: { path: string }) => {
          files.delete(uri.path);
        },
        rename: async (from: { path: string }, to: { path: string }) => {
          files.set(to.path, files.get(from.path)!);
          files.delete(from.path);
        },
      },
    },
    lm: {
      selectChatModels: async () => [
        {
          id: "gpt-5-mini",
          name: "GPT-5 mini",
          family: "gpt-5-mini",
          maxInputTokens: 1000000,
        },
      ],
      onDidChangeChatModels: () => disposable,
    },
    env: { clipboard: { writeText: async () => {} } },
  };
  (globalThis as any).__paretoVscodeMock = mock;
  const bundle = await build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "mock-vscode",
        setup(b) {
          b.onResolve({ filter: /^vscode$/ }, () => ({
            path: "vscode",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents:
              "const mock=globalThis.__paretoVscodeMock; export const {commands,Uri,ViewColumn,window,workspace,lm,env,RelativePattern,StatusBarAlignment}=mock;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const extension = await import(
    // A nonce comment keeps this bundle's data URL distinct from the other
    // extension-host bundles in this file: identical bytes would share Node's
    // data-URL module cache and keep the other test's vscode mock.
    `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n// pareto-import-host-test`).toString("base64")}`
  );
  extension.activate({
    extensionUri: { path: "/extension" },
    globalStorageUri: { path: "/cache" },
    subscriptions: [],
    globalState: {
      get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update: async (key: string, value: unknown) => {
        if (value === undefined) state.delete(key);
        else state.set(key, value);
      },
    },
    secrets: { get: async () => "", store: async () => {}, delete: async () => {} },
  });
  const open = () => commands.get("paretoGhc.open")!() as Promise<void>;
  const importFile = async (contents: string, path = "/exports/snap.json") => {
    openPath = path;
    files.set(path, contents);
    await (commands.get("paretoGhc.importSnapshot")!() as Promise<void>);
  };
  const last = () => (messages.at(-1) as any).state;
  try {
    await open();
    await receiver({ type: "ready" });
    assert.equal(last().imported, undefined);
    assert.equal(last().rows.length, 1);
    assert.equal(last().rows[0].name, "GPT-5 mini");

    const rows: Row[] = [
      {
        id: "a1",
        modelId: "a1",
        baseModelId: "a1",
        name: "Alpha",
        provider: "OpenAI",
        score: 50,
        cost: 2,
        frontier: true,
        dominatedBy: [],
        reasons: [],
        mappingStatus: "exact",
        candidateIds: [],
        pricing: { status: "priced", source: "copilot-catalog" },
      },
      {
        id: "a2",
        modelId: "a2",
        baseModelId: "a2",
        name: "Beta",
        provider: "OpenAI",
        score: 30,
        cost: 1,
        frontier: false,
        dominatedBy: ["a1"],
        reasons: ["priced"],
        mappingStatus: "inferred",
        candidateIds: [],
        pricing: { status: "priced", source: "copilot-catalog" },
      },
    ];
    const snapshot = exportSnapshot(
      rows,
      defaults,
      new Set(["a1"]),
      {
        source: "copilot",
        preset: "coding",
        billing: "credits",
        catalogDate: "2026-01-01",
        staticRegistryDate: "2026-01-02",
        planRegistryDate: "2026-01-03",
        version: "4.0",
        fetchedAt: 5,
        scenario: { status: "off" },
      },
    );
    await importFile(snapshot);
    assert.equal(last().imported.kind, "single");
    assert.equal(last().imported.fileName, "snap.json");
    assert.equal(last().imported.costBasis.basis, "task");
    assert.equal(last().imported.costBasis.unit, "AI credits");
    assert.equal(last().imported.catalogDate, "2026-01-01");
    // Only the path is persisted, never the file's contents.
    assert.equal(state.get("importedSnapshot"), "/exports/snap.json");
    assert.match(last().message, /read-only/);
    assert.match(last().message, /Historical data, not live results/);
    // The historical rows, dates, and benchmark version replace the live ones.
    assert.deepEqual(
      last().rows.map((r: { id: string }) => r.id),
      ["a1", "a2"],
    );
    assert.equal(last().catalogDate, "2026-01-01");
    assert.equal(last().version, "4.0");
    assert.equal(last().fetchedAt, 5);
    assert.equal(last().selected, "a1");
    assert.deepEqual(last().checklist, []);
    assert.deepEqual(last().models, []);
    assert.equal(last().usage, null);
    assert.deepEqual(last().recommendation.modelIds, ["a1"]);

    // Every live mutation is refused with an explanation, and nothing behind
    // the historical view changes.
    await receiver({ type: "exportCsv" });
    assert.match(last().message, /read-only/);
    await receiver({ type: "source", source: "codex" });
    assert.equal(state.get("options"), undefined);
    assert.equal(last().source, "copilot");
    await receiver({ type: "excludeMany", ids: ["a1"], excluded: true });
    assert.equal(state.get("excluded"), undefined);
    await receiver({ type: "pin", id: "a1", benchmarkId: "aa" });
    assert.equal(state.get("pins"), undefined);
    await receiver({ type: "watchlistAlerts", enabled: true });
    assert.equal(state.get("watchlistAlerts"), undefined);
    assert.equal(last().imported.kind, "single");

    // Display-only drafts still work, and never reach saved options.
    await receiver({
      type: "options",
      options: { ...last().options, filter: "bet" },
    });
    assert.equal(last().rows.length, 1);
    assert.equal(last().rows[0].id, "a2");
    assert.equal(state.get("options"), undefined);
    await receiver({
      type: "options",
      options: {
        ...last().options,
        filter: "",
        display: { ...last().options.display, chart: "workload" },
      },
    });
    // A chart-basis change never relabels costs the snapshot already priced.
    assert.equal(last().options.display.chart, "task");
    assert.equal(state.get("options"), undefined);

    // Row selection stays inside the imported view.
    await receiver({ type: "select", id: "a1" });
    assert.equal(last().selected, "a1");

    // Leaving returns the live comparison and forgets the stored path.
    await receiver({ type: "importExit" });
    assert.equal(last().imported, undefined);
    assert.equal(state.get("importedSnapshot"), undefined);
    assert.equal(last().rows[0].name, "GPT-5 mini");
    assert.match(last().message, /Back to the live comparison/);

    // A file that is not a snapshot keeps the live view and says why.
    await importFile('{"nope":true}', "/exports/badge.json");
    assert.equal(last().imported, undefined);
    assert.match(last().message, /not a comparison snapshot/);
    await importFile("not json at all", "/exports/broken.json");
    assert.equal(last().imported, undefined);
    assert.match(last().message, /not valid JSON/);
    await importFile(
      JSON.stringify({ version: 99, kind: "single", rows: [] }),
      "/exports/future.json",
    );
    assert.equal(last().imported, undefined);
    assert.match(last().message, /schema version 99/);
    // An implausibly large file is refused before it is read.
    files.set("/exports/huge.json", "x".repeat(10));
    mock.workspace.fs.stat = async (uri: { path: string }) => ({
      size: uri.path === "/exports/huge.json" ? 40_000_000 : 0,
    });
    await importFile("{}", "/exports/huge.json");
    assert.equal(last().imported, undefined);
    assert.match(last().message, /too large/);
    mock.workspace.fs.stat = async (uri: { path: string }) => ({
      size: files.get(uri.path)?.length ?? 0,
    });

    // A two-option snapshot reopens as two read-only panels.
    const pairSide = (
      over: Partial<PairSideInput>,
    ): PairSideInput => ({
      side: "A",
      name: "Copilot",
      options: defaults,
      rows,
      recommendation: { modelIds: ["a1"], explanation: "best" },
      scenario: { status: "off" },
      costNormalization: { status: "off" },
      availabilityNote: "available",
      pricingNote: "priced",
      discoveryError: "",
      ...over,
    });
    await importFile(
      exportPairSnapshot(
        [
          pairSide({ side: "A" }),
          pairSide({ side: "B", name: "Codex" }),
        ],
        {
          catalogDate: "2026-02-01",
          staticRegistryDate: "2026-02-02",
          planRegistryDate: "2026-02-03",
          version: "4.1",
          fetchedAt: 6,
          normalize: false,
          usdCostDelta: null,
        },
      ),
      "/exports/pair.json",
    );
    assert.equal(last().imported.kind, "comparison");
    assert.deepEqual(last().imported.options, ["A: Copilot", "B: Codex"]);
    assert.equal(last().comparison.sides.B.name, "Codex");
    assert.equal(last().comparison.sides.A.rows.length, 2);
    assert.equal(last().comparison.delta.direction, "B minus A");

    // Reopening the panel re-reads the stored path, so the historical view
    // survives closing it.
    disposePanel?.();
    await open();
    await receiver({ type: "ready" });
    assert.equal(last().imported.kind, "comparison");
    assert.equal(last().imported.fileName, "pair.json");

    // A file that moved or changed falls back to live data with the reason,
    // and the stale path is forgotten.
    files.delete("/exports/pair.json");
    disposePanel?.();
    await open();
    await receiver({ type: "ready" });
    assert.equal(last().imported, undefined);
    assert.equal(state.get("importedSnapshot"), undefined);
    // The explanation reaches a host notification too: the refresh that
    // follows opening a panel replaces the panel status line.
    assert.ok(infos.some((i) => /not reopened/.test(i)));
    assert.equal(last().rows[0].name, "GPT-5 mini");
  } finally {
    delete (globalThis as any).__paretoVscodeMock;
  }
});

test("each usage source is read only after its own opt-in, and removable on its own", async () => {
  const commands = new Map<string, () => unknown>();
  const messages: unknown[] = [];
  const disposable = { dispose() {} };
  const state = new Map<string, unknown>();
  const storageFiles = new Map<string, Uint8Array>();
  const cache = {
    version: "4.4",
    fetchedAt: Date.now(),
    models: [
      {
        id: "aa",
        slug: "gpt-5-mini",
        name: "GPT-5 mini",
        provider: "OpenAI",
        scores: { general: 30, coding: 40, agentic: 20 },
      },
    ],
  };
  storageFiles.set("/cache/benchmarks.json", Buffer.from(JSON.stringify(cache)));
  let receiver: (m: unknown) => Promise<void> = async () => {};
  // Consent prompts answer differently per test step; the default keeps the
  // first-run scan working.
  let modal = "Scan locally";
  const mock = {
    commands: {
      registerCommand: (id: string, fn: () => unknown) => {
        commands.set(id, fn);
        return disposable;
      },
      executeCommand: async (id: string) => commands.get(id)?.(),
    },
    Uri: {
      joinPath: (root: { path: string }, ...parts: string[]) => ({
        path: [root.path, ...parts].join("/"),
        toString() {
          return this.path;
        },
      }),
      parse: (value: string) => ({
        path: value,
        toString() {
          return value;
        },
      }),
    },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 100 },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    window: {
      createWebviewPanel: () => ({
        webview: {
          cspSource: "https://resources.test",
          asWebviewUri: (u: unknown) => u,
          html: "",
          postMessage: (m: unknown) => messages.push(m),
          onDidReceiveMessage: (fn: typeof receiver) => {
            receiver = fn;
            return disposable;
          },
        },
        onDidDispose: () => disposable,
        reveal() {},
      }),
      showInformationMessage: async () => modal,
      createStatusBarItem: () => ({
        text: "",
        tooltip: "",
        command: "",
        shown: false,
        show() {},
        hide() {},
        dispose() {},
      }),
    },
    workspace: {
      getConfiguration: () => ({
        get: () => undefined,
        inspect: () => ({ key: "paretoGhc", globalValue: undefined }),
        update: async () => {},
      }),
      onDidChangeConfiguration: () => disposable,
      registerTextDocumentContentProvider: () => disposable,
      createFileSystemWatcher: () => ({
        onDidChange() {},
        onDidCreate() {},
        onDidDelete() {},
        dispose() {},
      }),
      fs: {
        readFile: async (uri: { path: string }) => {
          const found = storageFiles.get(uri.path);
          if (found === undefined) throw new Error("missing");
          return found;
        },
        writeFile: async (uri: { path: string }, data: Uint8Array) => {
          storageFiles.set(uri.path, data);
        },
        createDirectory: async () => {},
        delete: async (uri: { path: string }) => {
          storageFiles.delete(uri.path);
        },
        rename: async (from: { path: string }, to: { path: string }) => {
          storageFiles.set(to.path, storageFiles.get(from.path)!);
          storageFiles.delete(from.path);
        },
      },
    },
    lm: {
      selectChatModels: async () => [
        {
          id: "gpt-5-mini",
          name: "GPT-5 mini",
          family: "gpt-5-mini",
          maxInputTokens: 1000000,
        },
      ],
      onDidChangeChatModels: () => disposable,
    },
    env: { clipboard: { writeText: async () => {} } },
  };
  (globalThis as any).__paretoVscodeMock = mock;
  const bundle = await build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "mock-vscode",
        setup(b) {
          b.onResolve({ filter: /^vscode$/ }, () => ({
            path: "vscode",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents:
              "const mock=globalThis.__paretoVscodeMock; export const {commands,Uri,ViewColumn,window,workspace,lm,env,RelativePattern,StatusBarAlignment}=mock;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const extension = await import(
    // A nonce comment keeps this bundle's data URL distinct from the other
    // extension-host bundles in this file: identical bytes would share Node's
    // data-URL module cache and keep the other test's vscode mock.
    `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n// pareto-usage-roots-host-test`).toString("base64")}`
  );
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  const appdata = process.env.APPDATA;
  const empty = mkdtempSync(join(tmpdir(), "pareto-roots-"));
  process.env.HOME = empty;
  process.env.XDG_CONFIG_HOME = join(empty, "xdg");
  process.env.APPDATA = join(empty, "appdata");
  const session = (index: number) =>
    JSON.stringify({
      kind: 1,
      k: ["requests", index, "result"],
      v: {
        metadata: {
          modelId: "copilot/gpt-5-mini",
          promptTokens: 100 + index,
          outputTokens: 10,
        },
      },
    });
  const write = (editor: string, file: string, index: number) => {
    const dir = join(
      empty,
      "xdg",
      editor,
      "User",
      "workspaceStorage",
      "ws",
      "chatSessions",
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), session(index));
  };
  extension.activate({
    extensionUri: { path: "/extension" },
    globalStorageUri: { path: "/cache" },
    subscriptions: [],
    globalState: {
      get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update: async (key: string, value: unknown) => {
        if (value === undefined) state.delete(key);
        else state.set(key, value);
      },
    },
    secrets: { get: async () => "", store: async () => {}, delete: async () => {} },
  });
  const last = () => (messages.at(-1) as any).state;
  const storedFiles = () =>
    Object.keys(
      (JSON.parse(
        Buffer.from(storageFiles.get("/cache/usage.json")!).toString(),
      ) as { files: Record<string, unknown> }).files,
    );
  try {
    // Two editors hold sessions, but only VS Code is consented to at first.
    write("Code", "a.jsonl", 0);
    write("Cursor", "b.jsonl", 1);
    await (commands.get("paretoGhc.open")!() as Promise<void>);
    await receiver({ type: "ready" });
    await receiver({ type: "scanUsage" });
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);
    // Cursor is detected and offered, but never read.
    const cursor = last().usageSources.find((s: { id: string }) => s.id === "cursor");
    assert.equal(cursor.detected, true);
    assert.equal(cursor.included, false);
    assert.match(cursor.purpose, /nothing is uploaded/);
    assert.equal(last().usage.requestCount, 1);
    assert.deepEqual(
      last().usage.editors.map((e: { editor: string }) => e.editor),
      ["VS Code"],
    );
    assert.ok(
      storedFiles().every((p) => p.includes("/Code/")),
      "only the consented root is stored",
    );

    // A root that does not exist is refused rather than created.
    modal = "Include this editor";
    await receiver({ type: "usageAddRoot", id: "trae" });
    assert.match(last().message, /No Trae storage directory found/);
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);
    // An id outside the registry is refused by name. The registry holds more
    // than Copilot editors now, so the refusal is client-neutral.
    await receiver({ type: "usageAddRoot", id: "/etc" });
    assert.match(last().message, /not a known local usage source/);
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);

    // Including Cursor reads it, labels it, and leaves VS Code untouched.
    modal = "Include this editor";
    await receiver({ type: "usageAddRoot", id: "cursor" });
    assert.deepEqual(state.get("usageRoots"), [
      "code",
      "code-insiders",
      "cursor",
    ]);
    assert.equal(last().usage.requestCount, 2);
    assert.deepEqual(
      last().usage.editors.map((e: { editor: string }) => e.editor).sort(),
      ["Cursor", "VS Code"],
    );
    assert.equal(last().usageSources.find((s: { id: string }) => s.id === "cursor").requests, 1);
    // Declining the confirmation changes nothing, even for a root that exists.
    write("Windsurf", "c.jsonl", 2);
    modal = "Not now";
    await receiver({ type: "usageAddRoot", id: "windsurf" });
    assert.match(last().message, /not included/);
    assert.deepEqual(state.get("usageRoots"), [
      "code",
      "code-insiders",
      "cursor",
    ]);

    // Removing one source deletes only its data and keeps the rest.
    modal = "Stop and remove";
    await receiver({ type: "usageRemoveRoot", id: "cursor" });
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);
    assert.equal(last().usage.requestCount, 1);
    assert.ok(
      storedFiles().every((p) => p.includes("/Code/")),
      "the removed root's files are gone",
    );
    assert.match(last().message, /Stopped reading GitHub Copilot in Cursor/);
    // Removing a source that was never included is explained, not acted on.
    await receiver({ type: "usageRemoveRoot", id: "windsurf" });
    assert.match(last().message, /not included/);
    // Keeping an included one changes nothing: re-include Windsurf, decline
    // the removal, and its data stays.
    modal = "Include this editor";
    await receiver({ type: "usageAddRoot", id: "windsurf" });
    assert.equal(last().usage.requestCount, 2);
    modal = "Keep it";
    await receiver({ type: "usageRemoveRoot", id: "windsurf" });
    assert.match(last().message, /unchanged/);
    assert.ok((state.get("usageRoots") as string[]).includes("windsurf"));
    assert.equal(last().usage.requestCount, 2);
    // The global erase still clears every source at once.
    modal = "Stop and remove";
    await receiver({ type: "usageRemoveRoot", id: "windsurf" });
    assert.equal(last().usage.requestCount, 1);
    await receiver({ type: "clearUsage" });
    assert.deepEqual(state.get("usageRoots"), []);
    assert.equal(last().usage, null);
  } finally {
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    if (xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = xdg;
    if (appdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = appdata;
    delete (globalThis as any).__paretoVscodeMock;
  }
});

test("Claude Code is a separate consented source with its own store and unit", async () => {
  const commands = new Map<string, () => unknown>();
  const messages: unknown[] = [];
  const disposable = { dispose() {} };
  const state = new Map<string, unknown>();
  const storageFiles = new Map<string, Uint8Array>();
  const cache = {
    version: "4.4",
    fetchedAt: Date.now(),
    models: [
      {
        id: "aa",
        slug: "gpt-5-mini",
        name: "GPT-5 mini",
        provider: "OpenAI",
        scores: { general: 30, coding: 40, agentic: 20 },
      },
    ],
  };
  storageFiles.set("/cache/benchmarks.json", Buffer.from(JSON.stringify(cache)));
  let receiver: (m: unknown) => Promise<void> = async () => {};
  let modal: string | undefined = "Scan locally";
  const mock = {
    commands: {
      registerCommand: (id: string, fn: () => unknown) => {
        commands.set(id, fn);
        return disposable;
      },
      executeCommand: async (id: string) => commands.get(id)?.(),
    },
    Uri: {
      joinPath: (root: { path: string }, ...parts: string[]) => ({
        path: [root.path, ...parts].join("/"),
        toString() {
          return this.path;
        },
      }),
      parse: (value: string) => ({
        path: value,
        toString() {
          return value;
        },
      }),
    },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 100 },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    window: {
      createWebviewPanel: () => ({
        webview: {
          html: "",
          cspSource: "vscode-webview:",
          asWebviewUri: (u: { toString(): string }) => u,
          postMessage: async (m: unknown) => {
            messages.push(m);
            return true;
          },
          onDidReceiveMessage: (fn: (m: unknown) => Promise<void>) => {
            receiver = fn;
            return disposable;
          },
        },
        onDidDispose: () => disposable,
        reveal() {},
      }),
      showInformationMessage: async () => modal,
      createStatusBarItem: () => ({
        text: "",
        tooltip: "",
        command: "",
        shown: false,
        show() {},
        hide() {},
        dispose() {},
      }),
    },
    workspace: {
      getConfiguration: () => ({
        get: () => undefined,
        inspect: () => ({ key: "paretoGhc", globalValue: undefined }),
        update: async () => {},
      }),
      onDidChangeConfiguration: () => disposable,
      registerTextDocumentContentProvider: () => disposable,
      createFileSystemWatcher: () => ({
        onDidChange() {},
        onDidCreate() {},
        onDidDelete() {},
        dispose() {},
      }),
      fs: {
        readFile: async (uri: { path: string }) => {
          const found = storageFiles.get(uri.path);
          if (found === undefined) throw new Error("missing");
          return found;
        },
        writeFile: async (uri: { path: string }, data: Uint8Array) => {
          storageFiles.set(uri.path, data);
        },
        createDirectory: async () => {},
        delete: async (uri: { path: string }) => {
          if (!storageFiles.has(uri.path)) {
            throw Object.assign(new Error("missing"), { code: "FileNotFound" });
          }
          storageFiles.delete(uri.path);
        },
        rename: async (from: { path: string }, to: { path: string }) => {
          storageFiles.set(to.path, storageFiles.get(from.path)!);
          storageFiles.delete(from.path);
        },
      },
    },
    lm: {
      selectChatModels: async () => [
        {
          id: "gpt-5-mini",
          name: "GPT-5 mini",
          family: "gpt-5-mini",
          maxInputTokens: 1000000,
        },
      ],
      onDidChangeChatModels: () => disposable,
    },
    env: { clipboard: { writeText: async () => {} } },
  };
  (globalThis as any).__paretoVscodeMock = mock;
  const bundle = await build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "mock-vscode",
        setup(b) {
          b.onResolve({ filter: /^vscode$/ }, () => ({
            path: "vscode",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents:
              "const mock=globalThis.__paretoVscodeMock; export const {commands,Uri,ViewColumn,window,workspace,lm,env,RelativePattern,StatusBarAlignment}=mock;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const extension = await import(
    `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n// pareto-claude-usage-host-test`).toString("base64")}`
  );
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  const appdata = process.env.APPDATA;
  const empty = mkdtempSync(join(tmpdir(), "pareto-claude-"));
  process.env.HOME = empty;
  process.env.XDG_CONFIG_HOME = join(empty, "xdg");
  process.env.APPDATA = join(empty, "appdata");
  // One Copilot session and one Claude Code transcript, so the two ledgers can
  // be shown side by side without ever being added together.
  const sessionDir = join(
    empty,
    "xdg",
    "Code",
    "User",
    "workspaceStorage",
    "ws",
    "chatSessions",
  );
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, "a.jsonl"),
    JSON.stringify({
      kind: 1,
      k: ["requests", 0, "result"],
      v: {
        metadata: {
          modelId: "copilot/gpt-5-mini",
          promptTokens: 100,
          outputTokens: 10,
        },
      },
    }),
  );
  const claudeDir = join(empty, ".claude", "projects", "proj-a");
  mkdirSync(join(claudeDir, "memory"), { recursive: true });
  writeFileSync(join(claudeDir, "memory", "MEMORY.md"), "stored user memory");
  writeFileSync(
    join(claudeDir, "s1.jsonl"),
    [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "synthetic" },
        sessionId: "s1",
        cwd: join(empty, "code", "api"),
        version: "2.1.280",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5-20250929",
          usage: {
            input_tokens: 1200,
            output_tokens: 340,
            cache_read_input_tokens: 8000,
            cache_creation_input_tokens: 1500,
          },
        },
        sessionId: "s1",
        cwd: join(empty, "code", "api"),
        isSidechain: false,
        version: "2.1.280",
      }),
      "",
    ].join("\n"),
  );
  extension.activate({
    extensionUri: { path: "/extension" },
    globalStorageUri: { path: "/cache" },
    subscriptions: [],
    globalState: {
      get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update: async (key: string, value: unknown) => {
        if (value === undefined) state.delete(key);
        else state.set(key, value);
      },
    },
    secrets: { get: async () => "", store: async () => {}, delete: async () => {} },
  });
  const last = () => (messages.at(-1) as any).state;
  try {
    await (commands.get("paretoGhc.open")!() as Promise<void>);
    await receiver({ type: "ready" });
    await receiver({ type: "scanUsage" });
    // The first-run consent covers only the two VS Code roots, exactly as
    // before: upgrading never adds a data source on the user's behalf.
    assert.deepEqual(state.get("usageRoots"), ["code", "code-insiders"]);
    // Claude Code is detected and offered, with its own stated purpose.
    const claude = last().usageSources.find(
      (s: { id: string }) => s.id === "claude-code",
    );
    assert.equal(claude.detected, true);
    assert.equal(claude.included, false);
    assert.match(claude.purpose, /never message content/);
    // Nothing about Claude has been read: no store, no summary, and the Copilot
    // ledger is untouched by the transcript sitting on disk.
    assert.equal(storageFiles.has("/cache/usage-claude.json"), false);
    assert.equal(last().claudeUsage, null);
    assert.equal(last().usage.requestCount, 1);

    // Including it reads only the transcript, never the memory file beside it.
    modal = "Include Claude Code";
    await receiver({ type: "usageAddRoot", id: "claude-code" });
    assert.ok((state.get("usageRoots") as string[]).includes("claude-code"));
    assert.ok(storageFiles.has("/cache/usage-claude.json"));
    const claudeStore = JSON.parse(
      Buffer.from(storageFiles.get("/cache/usage-claude.json")!).toString(),
    );
    assert.equal(Object.keys(claudeStore.files).length, 1);
    assert.ok(
      !Buffer.from(storageFiles.get("/cache/usage-claude.json")!).toString().includes(
        "stored user memory",
      ),
      "the memory file is never read",
    );
    // Its own ledger, in tokens, with the four disjoint buckets.
    const cu = last().claudeUsage;
    assert.equal(cu.requestCount, 1);
    assert.deepEqual(cu.totals, {
      requests: 1,
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 8000,
      cacheWriteTokens: 1500,
    });
    assert.deepEqual(
      cu.models.map((m: { modelId: string }) => m.modelId),
      ["claude-sonnet-4-5-20250929"],
    );
    assert.deepEqual(cu.exclusions, { sidechain: 0, missingTokens: 0 });
    // The two ledgers are never added: the Copilot summary is still one request,
    // and the budget suggestion still speaks only in Copilot's own unit.
    assert.equal(last().usage.requestCount, 1);
    assert.equal(last().usage.promptTokens, 100);
    assert.equal("premiumEstimate" in cu, false);
    assert.equal("premiumP90" in cu, false);
    assert.ok(storageFiles.has("/cache/usage.json"));

    // Removing Claude Code drops only its own store.
    modal = "Stop and remove";
    await receiver({ type: "usageRemoveRoot", id: "claude-code" });
    assert.equal(storageFiles.has("/cache/usage-claude.json"), false);
    assert.ok(storageFiles.has("/cache/usage.json"), "the Copilot store survives");
    assert.equal(last().claudeUsage, null);
    assert.equal(last().usage.requestCount, 1);
    assert.ok(!(state.get("usageRoots") as string[]).includes("claude-code"));
  } finally {
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    if (xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = xdg;
    if (appdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = appdata;
    delete (globalThis as any).__paretoVscodeMock;
  }
});
