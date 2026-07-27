import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createConnectorSessionHandler,
  MOCHI_EXTENSION_ID,
  MOCHI_WEB_CLIENT_ID,
} from "@/app/api/connector/session/route";
import { verifyConnectorToken } from "@/lib/mochi/connector-auth";
import { solveProofOfWork } from "../../../../../extension/src/shared/proof-of-work";

const originalSecret = process.env.MOCHI_CONNECTOR_SECRET;

function connectorRequest(extensionId = MOCHI_EXTENSION_ID) {
  return new Request("http://localhost/api/connector/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10",
      "x-mochi-extension-id": extensionId,
      "x-mochi-extension-version": "0.1.0",
    },
    body: JSON.stringify({ installId: "install-123" }),
  });
}

describe("POST /api/connector/session", () => {
  beforeEach(() => {
    process.env.MOCHI_CONNECTOR_SECRET =
      "a-production-length-secret-with-more-than-32-characters";
  });

  afterEach(() => {
    process.env.MOCHI_CONNECTOR_SECRET = originalSecret;
  });

  it("issues a short-lived signed token to the fixed Mochi extension", async () => {
    const now = Date.parse("2026-07-26T12:00:00.000Z");
    const handler = createConnectorSessionHandler({
      challengeDifficulty: 8,
      now: () => now,
      takeRateLimit: () => true,
    });
    const challengeResponse = await handler(connectorRequest());
    const challenge = await challengeResponse.json();
    const solution = await solveProofOfWork(
      challenge.challengeToken,
      challenge.difficulty,
    );
    const provedRequest = () =>
      new Request("http://localhost/api/connector/session", {
        method: "POST",
        headers: connectorRequest().headers,
        body: JSON.stringify({
          installId: "install-123",
          challengeToken: challenge.challengeToken,
          solution,
        }),
      });
    const response = await handler(provedRequest());
    const body = await response.json();
    const replay = await handler(provedRequest());

    expect(challengeResponse.status).toBe(428);
    expect(response.status).toBe(200);
    expect(replay.status).toBe(409);
    expect(body.expiresAt).toBe(now + 15 * 60_000);
    expect(
      verifyConnectorToken(body.token, {
        extensionId: MOCHI_EXTENSION_ID,
        ip: "203.0.113.10",
        now,
        secret: process.env.MOCHI_CONNECTOR_SECRET!,
      }),
    ).toMatchObject({ installId: "install-123" });
  });

  it("rejects other clients and rate-limited session minting", async () => {
    const handler = createConnectorSessionHandler({
      takeRateLimit: () => false,
    });
    const wrongExtension = await handler(
      connectorRequest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    );
    const rateLimited = await handler(connectorRequest());

    expect(wrongExtension.status).toBe(403);
    expect(rateLimited.status).toBe(429);
  });

  it("allows the first-party web overlay to request the same proof challenge", async () => {
    const handler = createConnectorSessionHandler({
      challengeDifficulty: 8,
      takeRateLimit: () => true,
    });
    const response = await handler(
      new Request("http://localhost/api/connector/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
          "x-mochi-client-id": MOCHI_WEB_CLIENT_ID,
          "x-mochi-client-version": "0.1.0",
        },
        body: JSON.stringify({ installId: "web-install-123" }),
      }),
    );

    expect(response.status).toBe(428);
  });
});
