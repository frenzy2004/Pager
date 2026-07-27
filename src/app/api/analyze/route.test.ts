import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/analyze/route";
import {
  issueConnectorToken,
  MOCHI_WEB_CLIENT_ID,
} from "@/lib/mochi/connector-auth";

const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalExaKey = process.env.EXA_API_KEY;
const originalConnectorSecret = process.env.MOCHI_CONNECTOR_SECRET;

function authorization() {
  return `Bearer ${issueConnectorToken({
    extensionId: MOCHI_WEB_CLIENT_ID,
    installId: "web-install-test",
    ip: "203.0.113.10",
    now: Date.now(),
    secret: process.env.MOCHI_CONNECTOR_SECRET!,
  })}`;
}

function requestWith(body: unknown, authorized = true) {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: {
      ...(authorized ? { authorization: authorization() } : {}),
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10",
      "x-mochi-client-id": MOCHI_WEB_CLIENT_ID,
    },
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
    process.env.MOCHI_CONNECTOR_SECRET =
      "a-production-length-secret-with-more-than-32-characters";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
    process.env.EXA_API_KEY = originalExaKey;
    process.env.MOCHI_CONNECTOR_SECRET = originalConnectorSecret;
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

  it("requires a signed proof-backed session", async () => {
    const response = await POST(requestWith(validInput, false));

    expect(response.status).toBe(401);
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

  it("accepts checkbox and grouped radio manifests from the connector", async () => {
    const response = await POST(
      requestWith({
        ...validInput,
        fields: [
          {
            key: "remote",
            label: "Open to remote",
            type: "checkbox",
            required: false,
          },
          {
            key: "contact",
            label: "Contact method",
            type: "radio",
            required: false,
            options: ["email", "phone"],
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects raw packets before they can exceed the Vercel function body limit", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          authorization: authorization(),
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
          "x-mochi-client-id": MOCHI_WEB_CLIENT_ID,
        },
        body: JSON.stringify({
          ...validInput,
          padding: "x".repeat(4_000_000),
        }),
      }),
    );

    expect(response.status).toBe(413);
  });
});
