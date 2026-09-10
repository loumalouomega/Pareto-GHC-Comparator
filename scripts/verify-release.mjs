import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const lock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (
  !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
  tag !== `v${manifest.version}`
) {
  throw new Error(
    `Release tag must equal v${manifest.version}; only stable versions are published.`,
  );
}
if (
  lock.version !== manifest.version ||
  lock.packages[""].version !== manifest.version
) {
  throw new Error(
    "package-lock.json must match the release version. Update both using npm version.",
  );
}
console.log(
  `Release verified: ${manifest.publisher}.${manifest.name} ${manifest.version}`,
);
