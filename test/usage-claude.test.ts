import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateClaudeUsage,
  claudeUnmapped,
  claudeTableCaps,
  discoverClaudeFiles,
  fingerprintClaudeTranscript,
  parseClaudeTranscript,
  purgeClaudeRetention,
  validClaudeUsageFile,
  type ClaudeFileInput,
  type ClaudeStoredFile,
} from "../src/usageClaude";
import type { ClaudeUsageRequest } from "../src/types";
import { claudeCodeRoot, usageRoots } from "../src/usage";
import { claudeUnmappedWorkspace, workspaceLabel } from "../src/workspaceLabel";
import { formatClaudeSchemaFingerprint } from "../src/types";

const fixture = (name: string) =>
  readFile(`test/fixtures/usage/claude/${name}`, "utf8");
const root = (path: string) => ({
  ...claudeCodeRoot("linux", path.split("/").slice(0, 1).join("/") || "/"),
  path,
});

test("the Claude root is per-platform, separate, and states its purpose", () => {
  // The path is built with the same `join` the Copilot roots use, so it follows
  // each platform's home convention without claiming a separator the rest of
  // the registry does not use.
  for (const [platform, home] of [
    ["linux", "/home/u"],
    ["darwin", "/Users/u"],
    ["win32", "C:\\Users\\u"],
  ] as const) {
    const found = claudeCodeRoot(platform, home);
    assert.equal(found.path, join(home, ".claude", "projects"));
    assert.ok(found.path.includes(".claude"));
    assert.ok(found.path.endsWith("projects"));
    assert.equal(found.id, "claude-code");
    assert.equal(found.editor, "Claude Code");
    assert.equal(found.layout, "claude-transcripts");
  }
  // It is offered in the same registry as Copilot's roots, with its own id and
  // its own stated purpose, so consent stays per root.
  const all = usageRoots("linux", {}, "/home/u");
  const claude = all.filter((r) => r.id === "claude-code");
  assert.equal(claude.length, 1);
  assert.equal(all.filter((r) => r.layout === "copilot-chat").length > 0, true);
  // The purpose states what is read, what is not, and the client's own control.
  assert.match(claude[0].purpose, /token totals/);
  assert.match(claude[0].purpose, /never message content/);
  assert.match(claude[0].purpose, /memory files/);
  assert.match(claude[0].purpose, /claude project purge/);
  assert.ok(!/Copilot/.test(claude[0].purpose));
});

test("discovery takes transcripts only and never opens memory files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pareto claude "));
  try {
    const projects = join(dir, "projects");
    await mkdir(join(projects, "proj-a", "memory"), { recursive: true });
    await writeFile(join(projects, "proj-a", "s1.jsonl"), "{}\n");
    await writeFile(join(projects, "proj-a", "notes.txt"), "user content");
    // Auto memory lives here per the vendor's directory reference. Reading it
    // would be reading stored user memory, not usage.
    await writeFile(join(projects, "proj-a", "memory", "MEMORY.md"), "remember this");
    await writeFile(join(projects, "proj-a", "memory", "topic.md"), "notes");
    await mkdir(join(projects, "proj-b"), { recursive: true });
    await writeFile(join(projects, "proj-b", "s2.jsonl"), "{}\n");
    const found = await discoverClaudeFiles([root(projects)]);
    assert.deepEqual(
      found.map((c) => c.filePath.split("/").slice(-2).join("/")).sort(),
      ["proj-a/s1.jsonl", "proj-b/s2.jsonl"],
    );
    // A Copilot root is never walked as a project tree, and vice versa.
    assert.deepEqual(await discoverClaudeFiles([{ ...root(projects), layout: "copilot-chat" }]), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only assistant records carry usage; other known types are ignored", async () => {
  const parsed = parseClaudeTranscript(await fixture("session-basic.jsonl"), "proj-a");
  assert.equal(parsed.diagnostics.malformed, 0);
  assert.equal(parsed.diagnostics.unsupported, 0);
  // Three assistant records with usage; the 8 user/attachment/title/mode lines
  // are ignored rather than counted malformed.
  assert.equal(parsed.requests.length, 3);
  assert.equal(parsed.workspacePath, "/home/example/project-alpha");
  const [first, zero, partial] = parsed.requests;
  assert.equal(first.modelId, "claude-sonnet-4-5-20250929");
  assert.deepEqual(
    {
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
      cacheReadTokens: first.cacheReadTokens,
      cacheWriteTokens: first.cacheWriteTokens,
    },
    { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 8000, cacheWriteTokens: 1500 },
  );
  // Valid observed zeros stay zeros, distinct from a missing field.
  assert.deepEqual(
    [zero.inputTokens, zero.outputTokens, zero.cacheReadTokens, zero.cacheWriteTokens],
    [0, 0, 0, 0],
  );
  // A record missing two buckets keeps the observed two and counts the rest 0.
  assert.deepEqual([partial.inputTokens, partial.outputTokens], [400, 90]);
  assert.equal(partial.cacheReadTokens, 0);
  assert.equal(partial.timestampMs, Date.parse("2026-09-21T09:00:00.000Z"));
});

test("subagent turns are held out of totals and counted, never dropped", async () => {
  const parsed = parseClaudeTranscript(await fixture("session-sidechain.jsonl"), "proj-b");
  assert.equal(parsed.requests.length, 4);
  assert.deepEqual(
    parsed.requests.map((r) => r.sidechain),
    [false, true, true, false],
  );
  const summary = aggregateClaudeUsage([
    { path: "p", projectSlug: "proj-b", ...parsed } as ClaudeFileInput,
  ]);
  // Only the two non-sidechain turns reach the headline totals; the 46k tokens
  // of subagent work are held back, not silently dropped.
  assert.equal(summary.requestCount, 2);
  assert.equal(summary.totals.inputTokens, 510);
  assert.equal(summary.exclusions.sidechain, 2);
  // No model/day row exists for the excluded turns either. Sorted by tokens,
  // heaviest first.
  assert.deepEqual(
    summary.models.map((m) => m.modelId),
    ["claude-sonnet-4-5-20250929", "claude-haiku-4-5"],
  );
});

test("a drifted transcript fails closed with a content-free fingerprint", async () => {
  const text = await fixture("session-drifted.jsonl");
  const parsed = parseClaudeTranscript(text, "proj-gamma");
  // assistant records are present but unusable, and two types are unknown:
  // unsupported, never a silent zero.
  assert.equal(parsed.diagnostics.unsupported, 1);
  assert.deepEqual(parsed.requests, []);
  const fp = parsed.fingerprint!;
  assert.equal(fp.assistant, true);
  assert.equal(fp.usageInput, false);
  assert.equal(fp.usageCacheWrite, false);
  assert.equal(fp.unknownLines, 2);
  assert.equal(fp.clientVersion, "9.9.9");
  // A record type that is recognized but carries no usage is never "unknown".
  const known = fingerprintClaudeTranscript(
    (await fixture("session-basic.jsonl")).split("\n").filter(Boolean),
  );
  assert.equal(known.unknownLines, 0);
  assert.equal(known.clientVersion, "2.1.280");
  assert.ok(known.kinds.includes("attachment"));
  assert.ok(known.kinds.includes("last-prompt"));
  // The rendered fingerprint names the client version and field presence, and
  // leaks no model id, path, token value, or content.
  const line = formatClaudeSchemaFingerprint(fp);
  assert.match(line, /client=9\.9\.9/);
  assert.match(line, /nousage\.input_tokens|no-usage\.input_tokens/);
  assert.ok(!line.includes("claude-sonnet"));
  assert.ok(!line.includes("/home/example"));
  assert.ok(!line.includes("synthetic"));
  // Malformed lines are counted; they never become usage rows.
  const broken = parseClaudeTranscript(
    '{"type":"assistant","message":{"usage":{"input_tokens":5}}}\nnot json\n[]\n',
    "p",
  );
  assert.equal(broken.diagnostics.malformed, 2);
  assert.equal(broken.requests.length, 1);
});

test("aggregation keeps Claude totals in tokens and separate by client", async () => {
  const basic = parseClaudeTranscript(await fixture("session-basic.jsonl"), "proj-a");
  const side = parseClaudeTranscript(await fixture("session-sidechain.jsonl"), "proj-b");
  const summary = aggregateClaudeUsage([
    { path: "a", ...basic, projectSlug: "proj-a" },
    { path: "b", ...side, projectSlug: "proj-b" },
  ] as ClaudeFileInput[]);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.requestCount, 5);
  assert.equal(summary.totals.inputTokens, 1200 + 0 + 400 + 500 + 10);
  assert.equal(summary.totals.cacheReadTokens, 8000);
  // Per-day rows come from the transcript timestamp, newest first.
  assert.deepEqual(
    summary.days.map((d) => d.date),
    ["2026-09-22", "2026-09-21", "2026-09-20"],
  );
  // Per-workspace rows are keyed by the project directory and carry cwd,
  // heaviest first.
  assert.deepEqual(
    summary.workspaces.map((w) => [w.id, w.path]),
    [
      ["proj-a", "/home/example/project-alpha"],
      ["proj-b", "/home/example/project-beta"],
    ],
  );
  // Nothing in the summary is a price, a premium request, or a credit figure.
  const serialized = JSON.stringify(summary);
  assert.ok(!/premiumEstimate|creditP90|premiumP90|medianPrompt|usd|rate/i.test(serialized));
  assert.equal("completeness" in summary, false);
});

test("unreadable roots and odd records are reported, never silently skipped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pareto claude odd "));
  try {
    const projects = join(dir, "projects");
    await mkdir(join(projects, "ok"), { recursive: true });
    await writeFile(join(projects, "ok", "s.jsonl"), "{}\n");
    // A file where a project directory is expected: readdir succeeds, stat does
    // not report a file, so it is skipped without being read.
    await writeFile(join(projects, "notadir"), "x");
    // A directory named like a transcript is not a transcript.
    await mkdir(join(projects, "ok", "dir.jsonl"), { recursive: true });
    // The same root twice must not double-count a transcript.
    const found = await discoverClaudeFiles([root(projects), root(projects)]);
    assert.deepEqual(
      found.map((c) => c.filePath.split("/").slice(-2).join("/")),
      ["ok/s.jsonl"],
    );
    // A root that does not exist is not "unreadable"; a broken one is.
    const missing: string[] = [];
    assert.deepEqual(
      await discoverClaudeFiles([root(join(dir, "nope"))], missing),
      [],
    );
    assert.deepEqual(missing, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // An assistant record with no `message`, and one with no `usage`, are
  // malformed usage records — counted, never invented into a zero-token turn.
  const noMessage = parseClaudeTranscript(
    [
      JSON.stringify({ type: "assistant", sessionId: "s", cwd: "/w" }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-5" },
        sessionId: "s",
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 7 } },
        sessionId: "s",
        timestamp: "2026-09-20T00:00:00.000Z",
      }),
    ].join("\n"),
    "p",
  );
  assert.equal(noMessage.requests.length, 1);
  assert.equal(noMessage.requests[0].inputTokens, 7);
  assert.equal(noMessage.diagnostics.unsupported, 0);

  // A bare epoch value is accepted only when it is plainly milliseconds; a
  // seconds value is refused rather than multiplied by a guess.
  const stamps = parseClaudeTranscript(
    [
      JSON.stringify({
        type: "assistant",
        message: { usage: { input_tokens: 1 } },
        sessionId: "s",
        timestamp: 1790000000000,
      }),
      JSON.stringify({
        type: "assistant",
        message: { usage: { input_tokens: 1 } },
        sessionId: "s",
        timestamp: 1790000000,
      }),
    ].join("\n"),
    "p",
  );
  assert.equal(stamps.requests[0].timestampMs, 1790000000000);
  assert.equal(stamps.requests[1].timestampMs, null);
});

test("an assistant record with no readable bucket is counted, not read as zero", () => {
  // Four `assistant` records whose `usage` object is present but carries none
  // of the four known buckets: each is counted as missing tokens and none
  // becomes a turn. A model-less record is likewise counted, not invented.
  const noBuckets = parseClaudeTranscript(
    [
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: { prompt_tokens: 5 } },
        sessionId: "s",
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: {} },
        sessionId: "s",
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: "many" } },
        sessionId: "s",
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: -3 } },
        sessionId: "s",
      }),
    ].join("\n"),
    "p",
  );
  assert.equal(noBuckets.requests.length, 0);
  assert.equal(noBuckets.diagnostics.missingTokens, 4);
  // With no known bucket anywhere there is no usable request, and the file has
  // no unknown `type` to corroborate drift, so it is ignored rather than
  // reported as an unsupported schema.
  assert.equal(noBuckets.diagnostics.unsupported, 0);

  // A record that does carry a bucket is kept even when its model is absent;
  // the turn is attributed to an explicit "unknown" model in the aggregate.
  const modelLess = parseClaudeTranscript(
    JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 4, output_tokens: 1 } },
      sessionId: "s",
      timestamp: "2026-09-20T00:00:00.000Z",
    }),
    "proj",
  );
  assert.equal(modelLess.requests.length, 1);
  assert.equal(modelLess.requests[0].modelId, null);
  const summary = aggregateClaudeUsage([
    { path: "a", ...modelLess, projectSlug: "proj" },
  ] as ClaudeFileInput[]);
  assert.deepEqual(summary.unknownModels, ["proj"]);
});

test("fingerprints group, dedupe, and reject malformed stored values", () => {
  const fp = fingerprintClaudeTranscript(
    JSON.stringify({
      type: "assistant",
      message: { model: "m", usage: { input_tokens: 1 } },
      version: "2.1.280",
      sessionId: "s",
      cwd: "/w",
      timestamp: "2026-09-20T00:00:00.000Z",
      isSidechain: false,
    }).split("\n"),
  );
  const file: ClaudeStoredFile = {
    projectSlug: "p",
    workspacePath: "/w",
    diagnostics: {
      malformed: 0,
      unsupported: 1,
      unreadable: 0,
      stale: 0,
      missingTokens: 0,
      estimatedTokens: 0,
    },
    requests: [],
    fingerprint: fp,
  };
  // Identical fingerprints collapse into one entry with a file count; a
  // malformed one is ignored rather than reported.
  const summary = aggregateClaudeUsage([
    { path: "a", ...file },
    { path: "b", ...file },
    { path: "c", ...file, fingerprint: { version: 9 } as never },
  ] as ClaudeFileInput[]);
  assert.equal(summary.schemaFingerprints?.length, 1);
  assert.equal(summary.schemaFingerprints?.[0].files, 2);

  // Stored-file validation rejects each structural break rather than trusting
  // part of a record.
  const base = {
    version: 1,
    scannedAt: 1,
    index: { version: 1, files: {} },
    files: { a: file },
  };
  assert.equal(validClaudeUsageFile(base), true);
  // Each structural break is rejected outright rather than partly trusted.
  assert.equal(validClaudeUsageFile(null), false, "not an object");
  assert.equal(validClaudeUsageFile([]), false, "an array is not a store");
  assert.equal(
    validClaudeUsageFile({ ...base, version: 2 }),
    false,
    "an unknown store version",
  );
  assert.equal(
    validClaudeUsageFile({ ...base, index: "none" }),
    false,
    "index must be an object",
  );
  assert.equal(
    validClaudeUsageFile({ ...base, index: { version: 2, files: {} } }),
    false,
    "index must be version 1",
  );
  assert.equal(
    validClaudeUsageFile({ ...base, index: { version: 1 } }),
    false,
    "index needs a files map",
  );
  assert.equal(
    validClaudeUsageFile({ ...base, files: undefined }),
    false,
    "files must be an object",
  );
  assert.equal(
    validClaudeUsageFile({ ...base, scannedAt: "soon" }),
    false,
    "scannedAt must be a finite number",
  );
  // A fingerprint that is not one of ours is rejected, not coerced.
  for (const [why, bad] of [
    ["a wrong version", { ...fp, version: 2 }],
    ["a wrong format tag", { ...fp, format: "jsonl" }],
    ["a non-string kind list", { ...fp, kinds: [1] }],
    ["an over-long kind list", { ...fp, kinds: new Array(21).fill("a") }],
    ["a negative line count", { ...fp, lines: -1 }],
    ["a non-integer unknown count", { ...fp, unknownLines: 1.5 }],
    ["a non-boolean field flag", { ...fp, usageInput: "yes" }],
  ] as const) {
    assert.equal(
      validClaudeUsageFile({ ...base, files: { a: { ...file, fingerprint: bad } } }),
      false,
      why,
    );
  }
  assert.equal(
    validClaudeUsageFile({
      ...base,
      index: { version: 1, files: { a: { size: 1, mtime: 2 } } },
    }),
    false,
    "an index entry needs a parser version",
  );
  assert.equal(
    validClaudeUsageFile({
      ...base,
      files: { a: { ...file, diagnostics: { malformed: 1 } } },
    }),
    false,
    "every diagnostic counter must be present",
  );
  const request: ClaudeUsageRequest = {
    sessionId: "s",
    requestIndex: 0,
    modelId: null,
    timestampMs: null,
    inputTokens: 1,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    sidechain: false,
  };
  assert.equal(
    validClaudeUsageFile({ ...base, files: { a: { ...file, requests: [request] } } }),
    true,
    "a well-formed request validates",
  );
  for (const [why, broken] of [
    ["a non-boolean sidechain flag", { ...request, sidechain: "yes" }],
    ["a negative token count", { ...request, inputTokens: -1 }],
    ["a non-finite token count", { ...request, outputTokens: Number.NaN }],
    ["a non-integer index", { ...request, requestIndex: 1.5 }],
    ["a numeric model id", { ...request, modelId: 7 }],
  ] as const) {
    assert.equal(
      validClaudeUsageFile({
        ...base,
        files: { a: { ...file, requests: [broken as ClaudeUsageRequest] } },
      }),
      false,
      why,
    );
  }

  // A request with no model is reported as unknown, and its workspace is named.
  const unknown = aggregateClaudeUsage([
    {
      path: "a",
      projectSlug: "proj",
      workspacePath: "/w",
      diagnostics: file.diagnostics,
      requests: [
        {
          sessionId: "s",
          requestIndex: 0,
          modelId: null,
          timestampMs: Date.parse("2026-09-20T00:00:00.000Z"),
          inputTokens: 3,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          sidechain: false,
        },
      ],
    },
  ] as ClaudeFileInput[]);
  assert.deepEqual(unknown.unknownModels, ["proj"]);
  assert.deepEqual(
    unknown.models.map((m) => m.modelId),
    ["unknown"],
  );

  // Retention can empty a file entirely, and it is then dropped.
  const emptied = purgeClaudeRetention(
    {
      only: {
        projectSlug: "p",
        workspacePath: "/w",
        diagnostics: file.diagnostics,
        requests: [
          {
            sessionId: "s",
            requestIndex: 0,
            modelId: null,
            timestampMs: 0,
            inputTokens: 1,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            sidechain: false,
          },
        ],
      },
    },
    1,
    1_000_000_000_000,
  );
  assert.equal(emptied.purgedFiles, 1);
  assert.deepEqual(emptied.files, {});
});

test("workspace labels use the Claude unmapped reason, not Copilot's", () => {
  assert.equal(
    workspaceLabel("", "proj-x", false, claudeUnmapped),
    "proj-x · unmapped workspace (no cwd in transcript)",
  );
  // The same constant the webview uses, so the two cannot drift.
  assert.equal(claudeUnmapped, claudeUnmappedWorkspace);
  assert.equal(
    workspaceLabel("/home/u/code/api", "id", false),
    "api",
  );
  assert.equal(workspaceLabel("/home/u/code/api", "id", true), "/home/u/code/api");
  // A multi-root cwd keeps one label per segment.
  assert.equal(workspaceLabel("/a/one;/b/two", "id", false), "one; two");
});

test("stored-file validation is strict and the retention purge is bounded", async () => {
  const parsed = parseClaudeTranscript(await fixture("session-basic.jsonl"), "proj-a");
  const good = {
    version: 1,
    scannedAt: Date.now(),
    index: { version: 1, files: { a: { size: 10, mtime: 5, parser: 1 } } },
    files: { a: { ...parsed, projectSlug: "proj-a", workspacePath: "/w" } },
  };
  assert.equal(validClaudeUsageFile(good), true);
  assert.equal(validClaudeUsageFile({ ...good, version: 2 }), false);
  assert.equal(validClaudeUsageFile({ ...good, files: { a: { ...good.files.a, requests: "no" } } }), false);
  assert.equal(
    validClaudeUsageFile({ ...good, files: { a: { ...good.files.a, requests: [{ ...parsed.requests[0], sidechain: "yes" }] } } }),
    false,
  );
  // A fingerprint is optional, but a malformed one invalidates the file.
  assert.equal(validClaudeUsageFile({ ...good, files: { a: { ...good.files.a, fingerprint: { version: 9 } } } }), false);

  const now = Date.parse("2026-09-25T00:00:00.000Z");
  const files = {
    old: {
      projectSlug: "p",
      workspacePath: "/w",
      diagnostics: parsed.diagnostics,
      requests: [
        { ...parsed.requests[0], timestampMs: now - 10 * 86400000 },
        { ...parsed.requests[0], timestampMs: now - 86400000 },
        { ...parsed.requests[0], timestampMs: null },
      ],
    },
    boundary: {
      projectSlug: "p",
      workspacePath: "/w",
      diagnostics: parsed.diagnostics,
      requests: [{ ...parsed.requests[0], timestampMs: now - 3 * 86400000 }],
    },
  };
  const purged = purgeClaudeRetention(files, 3, now);
  // Strictly older than the cutoff: the boundary survives, the 10-day row goes,
  // and a request with no timestamp is kept rather than guessed at.
  assert.equal(purged.purgedRequests, 1);
  assert.deepEqual(purged.files.old.requests.length, 2);
  assert.equal(purged.files.boundary.requests.length, 1);
  // Unlimited retention is a no-op, not a purge of everything.
  const kept = purgeClaudeRetention(files, undefined, now);
  assert.equal(kept.purgedRequests, 0);
  assert.equal(Object.keys(kept.files).length, 2);
});
