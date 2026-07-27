import { describe, expect, it } from "vitest";

import {
  FixedWindowLimiter,
  issueConnectorChallenge,
  issueConnectorToken,
  verifyConnectorChallenge,
  verifyConnectorToken,
} from "@/lib/mochi/connector-auth";
import { solveProofOfWork } from "@/lib/mochi/proof-of-work";

describe("connector authorization", () => {
  const secret = "a-production-length-secret-with-more-than-32-characters";
  const now = Date.parse("2026-07-26T12:00:00.000Z");

  it("issues expiring tokens bound to one install, extension, and IP", () => {
    const token = issueConnectorToken({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      installId: "install-123",
      ip: "203.0.113.10",
      now,
      secret,
    });

    expect(
      verifyConnectorToken(token, {
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        ip: "203.0.113.10",
        now: now + 1_000,
        secret,
      }),
    ).toMatchObject({ installId: "install-123" });
    expect(
      verifyConnectorToken(token, {
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        ip: "203.0.113.11",
        now: now + 1_000,
        secret,
      }),
    ).toBeNull();
    expect(
      verifyConnectorToken(token, {
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        ip: "203.0.113.10",
        now: now + 16 * 60_000,
        secret,
      }),
    ).toBeNull();
  });

  it("enforces bounded fixed-window quotas", () => {
    const limiter = new FixedWindowLimiter();

    expect(limiter.take("install", 2, 60_000, now)).toBe(true);
    expect(limiter.take("install", 2, 60_000, now + 1)).toBe(true);
    expect(limiter.take("install", 2, 60_000, now + 2)).toBe(false);
    expect(limiter.take("install", 2, 60_000, now + 60_001)).toBe(true);
  });

  it("verifies a short-lived IP-bound proof-of-work challenge", async () => {
    const challenge = issueConnectorChallenge({
      difficulty: 8,
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      installId: "install-123",
      ip: "203.0.113.10",
      nonce: "server-random-nonce",
      now,
      secret,
    });
    const solution = await solveProofOfWork(challenge.token, 8);

    expect(
      verifyConnectorChallenge(challenge.token, solution, {
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        installId: "install-123",
        ip: "203.0.113.10",
        now: now + 1_000,
        secret,
      }),
    ).toBe(true);
    expect(
      verifyConnectorChallenge(challenge.token, solution, {
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        installId: "install-123",
        ip: "203.0.113.11",
        now: now + 1_000,
        secret,
      }),
    ).toBe(false);
  });
});
