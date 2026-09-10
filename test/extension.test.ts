import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { validSnapshot } from "../src/api";

test("extension discovers Copilot models, serves cached data, validates messages, and keeps secrets host-side", async () => {
  const commands = new Map<string, () => unknown>();
  const messages: unknown[] = [];
  const copied: string[] = [];
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
  assert.ok(validSnapshot(cache));
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
    },
    workspace: {
      fs: {
        readFile: async () => Buffer.from(JSON.stringify(cache)),
        createDirectory: async () => {},
        writeFile: async () => {},
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
              "const mock=globalThis.__paretoVscodeMock; export const {commands,Uri,ViewColumn,window,workspace,lm,env}=mock;",
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
  assert.equal(last().rows[0].score, 40);
  assert.equal(last().rows[0].frontier, true);
  await receiver({ type: "copy", id: "gpt-5-mini" });
  await receiver({ type: "copy", id: "fake" });
  assert.deepEqual(copied, ["GPT-5 mini"]);
  await receiver({ type: "options", options: { preset: "bad" } });
  assert.match(last().message, /Could not apply/);
  await receiver({ type: "mapping", id: "gpt-5-mini", benchmarkId: "aa" });
  assert.deepEqual(state.get("mappings"), { "gpt-5-mini": "aa" });
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
  delete (globalThis as any).__paretoVscodeMock;
});
