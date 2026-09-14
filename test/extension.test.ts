import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { validSnapshot } from "../src/api";
import { planRegistryDate } from "../src/plans";

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
  const storageFiles = new Map<string, Uint8Array>();
  let pauseWrite: (() => Promise<void>) | undefined;
  let deleted = false;
  let deleteError = false;
  let receiver: (m: unknown) => Promise<void> = async () => {},
    discoveryChanged = () => {};
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
    },
    ViewColumn: { One: 1 },
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
    },
    workspace: {
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
              "const mock=globalThis.__paretoVscodeMock; export const {commands,Uri,ViewColumn,window,workspace,lm,env,RelativePattern}=mock;",
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
  await receiver({ type: "options", options: { preset: "bad" } });
  assert.match(last().message, /Could not apply/);
  await receiver({ type: "pin", id: "gpt-5-mini", benchmarkId: "aa" });
  await receiver({ type: "pin", id: "gpt-5-mini", benchmarkId: "other" });
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
  assert.equal(snapshotExport.version, 2);
  assert.equal(snapshotExport.options.length, 2);
  assert.deepEqual(
    snapshotExport.options[1].rows,
    JSON.parse(JSON.stringify(last().comparison.sides.B.rows)),
  );
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
    assert.equal(state.get("usageConsent"), true);
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
    assert.equal(state.get("usageConsent"), false);
    assert.match(last().message, /erased/);
    deleteError = true;
    await receiver({ type: "clearUsage" });
    assert.match(last().message, /could not be erased/);
    assert.equal(state.get("usageConsent"), false);
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
