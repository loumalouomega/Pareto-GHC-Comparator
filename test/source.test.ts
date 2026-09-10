import { test } from "vitest";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { validSnapshot } from "../src/api";

const kimiBlock = (header: string, body: Record<string, unknown>) =>
  `${header}\n${JSON.stringify(body)}`;
const kimiFixture = [
  kimiBlock("opencode-go/kimi-k2.7-code", {
    id: "kimi-k2.7-code",
    providerID: "opencode-go",
    name: "Kimi K2.7 Code",
    family: "kimi-k2",
    status: "active",
    cost: { input: 0.95, output: 4, cache: { read: 0.19, write: 0 } },
    limit: { context: 262144, output: 262144 },
    variants: {},
  }),
  kimiBlock("openai/gpt-5.4", {
    id: "gpt-5.4",
    providerID: "openai",
    name: "GPT-5.4",
    family: "gpt",
    status: "active",
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 1050000, input: 922000, output: 128000 },
    variants: { low: {}, high: {} },
  }),
].join("\n");
const cache = {
  version: "4.3",
  fetchedAt: Date.now(),
  models: [
    {
      id: "k",
      slug: "kimi-k2-7-code",
      name: "Kimi K2.7 Code",
      provider: "Moonshot AI",
      scores: { general: 70, coding: 80, agentic: 50 },
    },
    {
      id: "mini-cache",
      slug: "gpt-5-mini",
      name: "GPT-5 mini",
      provider: "OpenAI",
      scores: { general: 30, coding: 40, agentic: 20 },
    },
  ],
};

test("source switching resets billing, namespaces overrides, and guards stale discovery", async () => {
  assert.ok(validSnapshot(cache));
  const commands = new Map<string, () => unknown>();
  const messages: unknown[] = [];
  let receiver: (m: unknown) => Promise<void> = async () => {};
  let discoveryChanged = () => {};
  const state = new Map<string, unknown>();
  const disposable = { dispose() {} };
  let secret: string | undefined = "key";
  type ExecCb = (error: unknown, stdout?: string, stderr?: string) => void;
  const pendingExec: ExecCb[] = [];
  let execMode: { stdout: string } | { defer: true } = { stdout: kimiFixture };
  (globalThis as any).__paretoExecMock = (
    _binary: string,
    _args: string[],
    _opts: unknown,
    cb: ExecCb,
  ) => {
    if ("defer" in execMode) pendingExec.push(cb);
    else cb(null, (execMode as { stdout: string }).stdout, "");
  };
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
      selectChatModels: async () => [
        {
          id: "gpt-5-mini",
          name: "GPT-5 mini",
          family: "gpt-5-mini",
          maxInputTokens: 1000000,
          sendRequest: () => {
            throw new Error("Inference must never be called");
          },
        },
      ],
      onDidChangeChatModels: (fn: () => void) => {
        discoveryChanged = fn;
        return disposable;
      },
    },
    env: { clipboard: { writeText: async () => {} } },
  };
  (globalThis as any).__paretoVscodeMock = mock;
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
                "const mock=globalThis.__paretoVscodeMock; export const {commands,Uri,ViewColumn,window,workspace,lm,env}=mock;",
              loader: "js",
            }));
          },
        },
        {
          name: "mock-exec",
          setup(b) {
            b.onResolve({ filter: /^node:child_process$/ }, () => ({
              path: "child_process",
              namespace: "mock-exec",
            }));
            b.onLoad({ filter: /.*/, namespace: "mock-exec" }, () => ({
              contents:
                "export const execFile = (...args) => globalThis.__paretoExecMock(...args);",
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
    const last = () => (messages.at(-1) as any).state;
    assert.equal(last().source, "copilot");
    assert.equal(last().options.billing, "credits");
    assert.ok(last().rows.some((r: any) => r.id === "gpt-5-mini"));

    // Switch to OpenCode: billing resets to USD and CLI rates price the rows.
    await receiver({ type: "source", source: "opencode" });
    assert.equal(last().source, "opencode");
    assert.equal(last().options.billing, "usd");
    const kimi = last().rows.find(
      (r: any) => r.id === "opencode:opencode-go/kimi-k2.7-code",
    );
    assert.ok(kimi);
    assert.equal(kimi.mappingStatus, "exact");
    assert.equal(kimi.cost, (1000 * 0.95 + 1000 * 4) / 1000000);
    const gpt = last().rows.find(
      (r: any) => r.id === "opencode:openai/gpt-5.4#low",
    );
    assert.ok(gpt);
    assert.equal(gpt.cost, null);
    assert.match(gpt.reasons.join(" "), /Billed by provider/);

    // Overrides are namespaced by source and never collide with Copilot IDs.
    await receiver({
      type: "mapping",
      id: "opencode:opencode-go/kimi-k2.7-code",
      benchmarkId: "k",
    });
    assert.deepEqual(state.get("mappings"), {
      "opencode:opencode-go/kimi-k2.7-code": "k",
    });
    assert.equal(
      last().rows.find((r: any) => r.id === "opencode:opencode-go/kimi-k2.7-code")
        .mappingStatus,
      "user",
    );

    // Profiles carry their source: saving on OpenCode and applying from
    // Copilot restores the OpenCode workload and rediscovers it.
    await receiver({
      type: "profile",
      change: { action: "saveAs", name: "OpenCode work" },
    });
    const profileId = last().activeProfileId;
    await receiver({ type: "source", source: "copilot" });
    assert.equal(last().options.billing, "credits");
    await receiver({ type: "profile", change: { action: "apply", id: profileId } });
    assert.equal(last().source, "opencode");
    assert.equal(last().options.billing, "usd");
    assert.ok(
      last().rows.some((r: any) => r.id === "opencode:opencode-go/kimi-k2.7-code"),
    );

    // Stale guard: overlapping discoveries resolve in order. Handler-driven
    // discoveries are serialized by the message queue, so overlap only
    // happens via the model-change listener (Copilot path); the generation
    // counter in discover() is shared by both sources.
    await receiver({ type: "source", source: "copilot" });
    let lmDeferred: Array<(models: any[]) => void> = [];
    const copilotModels = (tag: string) => [
      { id: tag, name: tag, family: tag, maxInputTokens: 1000000 },
    ];
    mock.lm.selectChatModels = async () =>
      new Promise<any[]>((resolve) => {
        lmDeferred.push(resolve);
      });
    discoveryChanged();
    discoveryChanged();
    for (let i = 0; i < 200 && lmDeferred.length < 2; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lmDeferred.length, 2);
    lmDeferred[0](copilotModels("stale-model"));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      !last().rows.some((r: any) => r.id === "stale-model"),
      "stale discovery must not render",
    );
    lmDeferred[1](copilotModels("fresh-model"));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(last().rows.some((r: any) => r.id === "fresh-model"));
    assert.ok(
      !last().rows.some((r: any) => r.id === "stale-model"),
    );
    assert.ok(!JSON.stringify(messages).includes(secret));
  } finally {
    delete (globalThis as any).__paretoVscodeMock;
    delete (globalThis as any).__paretoExecMock;
  }
});
