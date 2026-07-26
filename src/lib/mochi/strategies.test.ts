import { describe, expect, it } from "vitest";

import { createDemoAnalysis } from "@/lib/mochi/strategies";

describe("createDemoAnalysis", () => {
  it("returns exactly three distinct strategies for the selected preset", () => {
    const result = createDemoAnalysis({
      preset: "job",
      taskHint: "Apply for the product designer role",
      screenshots: [{ name: "resume.png", dataUrl: "data:image/png;base64,AA==" }],
      fields: [
        { key: "name", label: "Full name", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
        { key: "summary", label: "Why you?", type: "textarea", required: true },
      ],
    });

    expect(result.engine).toBe("demo");
    expect(result.strategies).toHaveLength(3);
    expect(new Set(result.strategies.map((strategy) => strategy.id)).size).toBe(3);
    expect(result.strategies.map((strategy) => strategy.label)).toEqual([
      "Safe & precise",
      "Balanced",
      "Standout",
    ]);
  });

  it("keeps unsupported identity fields blank instead of inventing facts", () => {
    const result = createDemoAnalysis({
      preset: "general",
      taskHint: "",
      screenshots: [],
      fields: [
        { key: "legalName", label: "Legal name", type: "text", required: true },
      ],
    });

    for (const strategy of result.strategies) {
      expect(strategy.fields.legalName.value).toBe("");
      expect(strategy.fields.legalName.status).toBe("needs-input");
    }
  });

  it("adapts draft copy to job, lead, and general missions", () => {
    const labels = (["job", "lead", "general"] as const).map((preset) =>
      createDemoAnalysis({
        preset,
        taskHint: "",
        screenshots: [],
        fields: [
          { key: "summary", label: "Summary", type: "textarea", required: false },
        ],
      }).strategies[1].fields.summary.value,
    );

    expect(labels[0]).toContain("product");
    expect(labels[1]).toContain("team");
    expect(labels[2]).toContain("request");
  });
});

