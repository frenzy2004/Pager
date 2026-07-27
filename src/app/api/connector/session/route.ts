import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  FixedWindowLimiter,
  issueConnectorChallenge,
  issueConnectorToken,
  MOCHI_EXTENSION_ID,
  MOCHI_WEB_CLIENT_ID,
  verifyConnectorChallenge,
  CONNECTOR_TOKEN_TTL_MS,
} from "@/lib/mochi/connector-auth";

export const runtime = "nodejs";
export { MOCHI_EXTENSION_ID, MOCHI_WEB_CLIENT_ID };

const sessionSchema = z.object({
  installId: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/),
  challengeToken: z.string().min(40).max(2_048).optional(),
  solution: z.string().regex(/^\d{1,10}$/).optional(),
});
const issuanceLimiter = new FixedWindowLimiter();
const consumedChallenges = new Map<string, number>();

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

interface SessionHandlerOptions {
  challengeDifficulty?: number;
  now?: () => number;
  takeRateLimit?: (key: string) => boolean;
}

export function createConnectorSessionHandler({
  challengeDifficulty = 16,
  now = Date.now,
  takeRateLimit,
}: SessionHandlerOptions = {}) {
  return async function handleConnectorSession(request: Request) {
    const extensionId =
      request.headers.get("x-mochi-client-id") ??
      request.headers.get("x-mochi-extension-id");
    const version =
      request.headers.get("x-mochi-client-version") ??
      request.headers.get("x-mochi-extension-version");
    if (
      (extensionId !== MOCHI_EXTENSION_ID &&
        extensionId !== MOCHI_WEB_CLIENT_ID) ||
      !version ||
      !/^\d+\.\d+\.\d+$/.test(version)
    ) {
      return NextResponse.json(
        { error: "This connector client is not allowed." },
        { status: 403 },
      );
    }

    const secret = process.env.MOCHI_CONNECTOR_SECRET ?? "";
    if (secret.length < 32) {
      return NextResponse.json(
        { error: "Connector authorization is not configured." },
        { status: 503 },
      );
    }

    let parsed: z.infer<typeof sessionSchema>;
    try {
      const rawBody = await request.text();
      if (rawBody.length > 1_000) throw new Error("oversized");
      parsed = sessionSchema.parse(JSON.parse(rawBody));
    } catch {
      return NextResponse.json(
        { error: "The connector session request is invalid." },
        { status: 400 },
      );
    }

    const ip = clientIp(request);
    const rateKey = ip;
    const allowed = takeRateLimit
      ? takeRateLimit(rateKey)
      : issuanceLimiter.take(rateKey, 20, 60_000, now());
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many connector session requests. Try again later." },
        { status: 429 },
      );
    }

    const issuedAt = now();
    if (!parsed.challengeToken || !parsed.solution) {
      const challenge = issueConnectorChallenge({
        difficulty: challengeDifficulty,
        extensionId,
        installId: parsed.installId,
        ip,
        nonce: randomBytes(18).toString("base64url"),
        now: issuedAt,
        secret,
      });
      return NextResponse.json(
        {
          challengeToken: challenge.token,
          difficulty: challengeDifficulty,
          expiresAt: challenge.expiresAt,
        },
        {
          status: 428,
          headers: { "cache-control": "private, no-store" },
        },
      );
    }

    for (const [token, expiresAt] of consumedChallenges) {
      if (expiresAt <= issuedAt) consumedChallenges.delete(token);
    }
    if (consumedChallenges.has(parsed.challengeToken)) {
      return NextResponse.json(
        { error: "That connector challenge was already used." },
        { status: 409 },
      );
    }
    if (
      !verifyConnectorChallenge(
        parsed.challengeToken,
        parsed.solution,
        {
          extensionId,
          installId: parsed.installId,
          ip,
          now: issuedAt,
          secret,
        },
      )
    ) {
      return NextResponse.json(
        { error: "The connector challenge proof is invalid or expired." },
        { status: 401 },
      );
    }
    consumedChallenges.set(
      parsed.challengeToken,
      issuedAt + CONNECTOR_TOKEN_TTL_MS,
    );

    return NextResponse.json(
      {
        token: issueConnectorToken({
          extensionId,
          installId: parsed.installId,
          ip,
          now: issuedAt,
          secret,
        }),
        expiresAt: issuedAt + CONNECTOR_TOKEN_TTL_MS,
      },
      {
        headers: {
          "cache-control": "private, no-store",
        },
      },
    );
  };
}

export const POST = createConnectorSessionHandler();
