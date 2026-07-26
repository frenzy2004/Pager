import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const root = process.cwd();
const outputDirectory = path.join(root, "extension", "dist");

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });
await cp(
  path.join(root, "extension", "static"),
  outputDirectory,
  { recursive: true },
);

await build({
  absWorkingDir: root,
  bundle: true,
  entryNames: "[name]",
  entryPoints: {
    agent: "extension/src/content/agent.ts",
    background: "extension/src/background.ts",
    content: "extension/src/content/content.ts",
    sidepanel: "extension/src/sidepanel/main.tsx",
  },
  format: "iife",
  loader: {
    ".css": "css",
  },
  outdir: outputDirectory,
  sourcemap: false,
  target: "chrome116",
});
