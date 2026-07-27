import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

const root = process.cwd();
const sourceDirectory = path.join(root, "extension", "dist");
const outputDirectory = path.join(root, "public", "downloads");
const outputPath = path.join(outputDirectory, "mochi-connector.zip");
const archive = new JSZip();
const archiveDate = new Date("2000-01-01T00:00:00.000Z");

async function addDirectory(directory, prefix = "") {
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const archivePath = path.posix.join(prefix, entry.name);

    if (entry.isDirectory()) {
      await addDirectory(absolutePath, archivePath);
    } else {
      archive.file(archivePath, await readFile(absolutePath), {
        date: archiveDate,
      });
    }
  }
}

await addDirectory(sourceDirectory);
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  outputPath,
  await archive.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    type: "nodebuffer",
  }),
);
