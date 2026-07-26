import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Chrome connector artifacts", () => {
  it("builds a Chrome 116 MV3 connector and downloadable archive", () => {
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
  });
});
