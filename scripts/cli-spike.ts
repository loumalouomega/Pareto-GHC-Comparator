// Feasibility spike for docs/cli-investigation.md — NOT a shipped product
// feature (excluded from the VSIX by .vscodeignore's allowlist). Proves that
// src/compare.ts, src/export.ts, and src/opencode.ts can run a comparison and
// produce CSV/snapshot output with zero VS Code dependency: no globalState,
// no SecretStorage, no globalStorageUri cache, no network fetch. Inputs are
// explicit files; OpenCode discovery (when --source opencode is passed) is
// the same read-only CLI spawn the extension already uses for discovery, not
// an inference call.
//
// Usage:
//   npx tsx scripts/cli-spike.ts --snapshot <file.json> --options <file.json> \
//     --source <static-source-id|opencode> [--format csv|snapshot]
import { readFile } from "node:fs/promises";
import { validSnapshot } from "../src/api";
import { catalogDate } from "../src/catalog";
import { compare, savedOptions } from "../src/compare";
import { exportCsv, exportSnapshot } from "../src/export";
import { createOpenCodeRunner, discoverOpenCode } from "../src/opencode";
import { recommend } from "../src/recommend";
import { isStaticSource, staticModels, staticRegistryDate } from "../src/staticSources";
import type { AvailableModel, Options, Source, Snapshot } from "../src/types";

function usage(): never {
  console.error(
    "Usage: cli-spike.ts --snapshot <file.json> --options <file.json> --source <id> [--format csv|snapshot]",
  );
  process.exit(2);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read/parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function availableFor(source: Source): Promise<AvailableModel[]> {
  if (isStaticSource(source)) return staticModels(source);
  if (source === "opencode") return discoverOpenCode(createOpenCodeRunner());
  throw new Error(
    `Source "${source}" needs a live editor session (vscode.lm) and has no offline/CLI equivalent — see docs/cli-investigation.md.`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const snapshotPath = flag(args, "--snapshot");
  const optionsPath = flag(args, "--options");
  const sourceArg = flag(args, "--source");
  const format = flag(args, "--format") ?? "csv";
  if (!snapshotPath || !optionsPath || !sourceArg) usage();
  if (format !== "csv" && format !== "snapshot") usage();

  const snapshotRaw = await readJson(snapshotPath);
  if (!validSnapshot(snapshotRaw)) {
    throw new Error(`${snapshotPath} failed validSnapshot() — not a valid benchmark snapshot.`);
  }
  const snapshot: Snapshot = snapshotRaw;

  const optionsRaw = await readJson(optionsPath);
  // Apply the --source override before migration (not after), so an
  // incompatible billing mode is reconciled the same way the host
  // reconciles it on a source switch, instead of parseOptions rejecting it.
  const options: Options = savedOptions({
    ...(optionsRaw as Record<string, unknown>),
    source: sourceArg,
  });
  if (options.source !== sourceArg) {
    throw new Error(`"${sourceArg}" is not a valid source.`);
  }

  const available = await availableFor(options.source);
  const rows = compare(available, snapshot.models, options);
  const recommended = new Set(recommend(rows, options).modelIds);

  const output =
    format === "csv"
      ? exportCsv(rows, options, recommended)
      : exportSnapshot(rows, options, recommended, {
          source: options.source,
          preset: options.preset,
          billing: options.billing,
          catalogDate,
          staticRegistryDate,
          version: snapshot.version,
          fetchedAt: snapshot.fetchedAt,
        });
  process.stdout.write(output + "\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
