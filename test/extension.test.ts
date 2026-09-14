import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { validSnapshot } from "../src/api";

test("extension discovers Copilot models, serves cached data, validates messages, and keeps secrets host-side", async () => {
  const commands = new Map<string, () => unknown>();
  const messages: unknown[] = [];
  const copied: string[] = [];
  const kicks: (() => void)[] = [];
  const writes: string[] = [];
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
          Buffer.from(
            JSON.stringify(uri.path.includes("prev") ? prevCache : cache),
          ),
        createDirectory: async () => {},
        writeFile: async (uri: { path: string }) => {
          writes.push(uri.path);
          await pauseWrite?.();
        },
        delete: async (uri: { path: string }) => {
          if (uri.path.endsWith("/usage.json")) {
            if (deleteError) throw new Error("write denied");
            deleted = true;
          }
        },
        rename: async () => {},
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
  const byokRates = {
    "opencode:openai/gpt-5.4": {
      rates: { input: 1, read: 1, write: null, output: 1 },
    },
  };
  await receiver({ type: "byok", rates: byokRates });
  assert.deepEqual(state.get("byokRates"), byokRates);
  assert.deepEqual(last().byok, byokRates);
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
