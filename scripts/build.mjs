import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    target: "node20",
  }),
  build({
    entryPoints: ["webview/main.ts"],
    outfile: "dist/webview.js",
    bundle: true,
    platform: "browser",
    target: "es2022",
    minify: true,
  }),
  copyFile("webview/style.css", "dist/style.css"),
]);
