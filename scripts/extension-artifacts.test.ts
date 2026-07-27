import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Chrome connector artifacts", () => {
  it("builds a direct-provider Chrome 116 MV3 extension without bundled secrets", async () => {
    execFileSync("npm", ["run", "package:extension"], {
      cwd: root,
      stdio: "pipe",
    });

    const manifest = JSON.parse(
      readFileSync(path.join(root, "extension/dist/manifest.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      manifest_version: 3,
      minimum_chrome_version: "116",
      permissions: expect.arrayContaining([
        "activeTab",
        "scripting",
        "sidePanel",
        "storage",
      ]),
      host_permissions: expect.arrayContaining([
        "https://api.openai.com/*",
        "https://api.exa.ai/*",
      ]),
    });

    const listing = execFileSync(
      "unzip",
      ["-Z1", path.join(root, "public/downloads/mochi-connector.zip")],
      { encoding: "utf8" },
    );

    expect(listing.split("\n")).toContain("manifest.json");
    expect(listing.split("\n")).toEqual(
      expect.arrayContaining([
        "background.js",
        "content.js",
        "agent.js",
        "sidepanel.html",
        "sidepanel.js",
      ]),
    );

    expect(
      statSync(path.join(root, "extension/dist/sidepanel.js")).size,
    ).toBeLessThan(250_000);
    expect(
      statSync(path.join(root, "extension/dist/agent.js")).size,
    ).toBeLessThan(500_000);

    const archive = await JSZip.loadAsync(
      readFileSync(
        path.join(root, "public/downloads/mochi-connector.zip"),
      ),
    );
    const archiveDates = Object.values(archive.files)
      .filter((file) => !file.dir)
      .map((file) => file.date.toISOString());
    expect(new Set(archiveDates)).toEqual(
      new Set(["2000-01-01T00:00:00.000Z"]),
    );
    const bundledText = (
      await Promise.all(
        Object.values(archive.files)
          .filter((file) => !file.dir)
          .map((file) => file.async("string")),
      )
    ).join("\n");

    expect(bundledText).not.toContain(
      "mochi-overlay.vercel.app/api/",
    );
    expect(bundledText).not.toMatch(
      /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|exa_[A-Za-z0-9_-]{20,}|OPENAI_API_KEY\s*=|EXA_API_KEY\s*=)/,
    );
  });
});
