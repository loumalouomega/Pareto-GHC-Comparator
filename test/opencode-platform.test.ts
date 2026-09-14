import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executableCandidates,
  createOpenCodeRunner,
  execOnce,
  OpenCodeError,
  discoverOpenCode,
} from "../src/opencode";
test("native resolution uses platform path semantics and never invokes a shell", async () => {
  assert.deepEqual(
    executableCandidates(
      "win32",
      { Path: '"C:\\Program Files\\OpenCode";D:\\tools' },
      "C:\\Users\\Person",
    ),
    [
      "C:\\Program Files\\OpenCode\\opencode.exe",
      "D:\\tools\\opencode.exe",
      "C:\\Users\\Person\\.opencode\\bin\\opencode.exe",
    ],
  );
  assert.deepEqual(
    executableCandidates(
      "darwin",
      { PATH: "/opt/bin:/opt/bin" },
      "/Users/person",
    ),
    ["/opt/bin/opencode", "/Users/person/.opencode/bin/opencode"],
  );
  assert.deepEqual(executableCandidates("linux", {}, "/home/p"), [
    "/home/p/.opencode/bin/opencode",
  ]);
  const called: string[] = [];
  const runner = createOpenCodeRunner({
    platform: "linux",
    env: { PATH: "/one:/two" },
    home: "/home/p",
    execute: async (binary, args) => {
      called.push(binary);
      assert.deepEqual(args, ["models", "--verbose"]);
      if (binary === "/one/opencode")
        throw Object.assign(Error(), { code: "ENOENT" });
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });
  assert.equal((await runner(["models", "--verbose"])).stdout, "ok");
  assert.equal(called.length, 2);
  await assert.rejects(
    createOpenCodeRunner({
      env: {},
      execute: async () => {
        throw Object.assign(Error(), { code: "ENOENT" });
      },
    })([]),
    /native.*Script-only/,
  );
  const timeout = new OpenCodeError("Timeout", "timeout");
  await assert.rejects(
    discoverOpenCode(
      createOpenCodeRunner({
        execute: async () => {
          throw timeout;
        },
      }),
    ),
    (e) => e === timeout,
  );
  await assert.rejects(
    discoverOpenCode(async () => {
      throw Error("failure");
    }),
    (e) => e instanceof OpenCodeError && e.kind === "command",
  );
});
test("native process receives arguments literally at a path containing spaces", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pareto native space "));
  try {
    const binary = join(
      dir,
      process.platform === "win32" ? "native.exe" : "native",
    );
    await copyFile(process.execPath, binary);
    const r = await execOnce(binary, [
      "-e",
      "process.stdout.write(process.argv[1])",
      "literal $HOME; & argument",
    ]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "literal $HOME; & argument");
    assert.equal((await execOnce(binary, ["-e", "process.exit(3)"])).code, 3);
    await assert.rejects(execOnce(join(dir, "absent"), []), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("process boundary enforces timeout and buffer limits with actionable failures", async () => {
  const { execFile } = await import("node:child_process");
  const executor = ((
    _binary: unknown,
    _args: unknown,
    options: unknown,
    callback: Function,
  ) => {
    assert.deepEqual(options, { timeout: 20000, maxBuffer: 10 * 1024 * 1024 });
    callback(Object.assign(Error("timeout"), { killed: true }), "", "");
    return {};
  }) as unknown as typeof execFile;
  await assert.rejects(
    execOnce("opencode", [], executor),
    (e) => e instanceof OpenCodeError && e.kind === "timeout",
  );
});
