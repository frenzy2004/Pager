import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/analyze/route";

const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalExaKey = process.env.EXA_API_KEY;

function requestWith(body: unknown) {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validInput = {
  preset: "job",
  taskHint: "Use the screenshot context",
  screenshots: [
    {
      name: "resume.png",
      dataUrl: "data:image/png;base64,AA==",
    },
  ],
  fields: [
    {
      key: "summary",
      label: "Why are you a fit?",
      type: "textarea",
      required: true,
    },
  ],
};

describe("POST /api/analyze", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.EXA_API_KEY;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
    process.env.EXA_API_KEY = originalExaKey;
  });

  it("returns a deterministic three-strategy demo when no provider key exists", async () => {
    const response = await POST(requestWith(validInput));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.engine).toBe("demo");
    expect(body.strategies).toHaveLength(3);
    expect(body.notice).toContain("Interactive demo");
  });

  it("rejects malformed requests instead of guessing at the contract", async () => {
    const response = await POST(
      requestWith({ ...validInput, preset: "unknown", screenshots: [] }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("That context packet is not valid.");
    expect(body.issues).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it("accepts eight sourced captures and rejects a ninth", async () => {
    const capture = {
      dataUrl: "data:image/png;base64,AA==",
      sourceUrl: "https://example.com/profile",
      sourceTitle: "Candidate profile",
      capturedAt: "2026-07-26T12:00:00.000Z",
      kind: "viewport",
    };
    const accepted = await POST(
      requestWith({
        ...validInput,
        screenshots: Array.from({ length: 8 }, () => capture),
      }),
    );
    const rejected = await POST(
      requestWith({
        ...validInput,
        screenshots: Array.from({ length: 9 }, () => capture),
      }),
    );

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
  });
});
