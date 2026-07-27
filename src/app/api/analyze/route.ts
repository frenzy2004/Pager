import { NextResponse } from "next/server";

import { runLiveAnalysis } from "@/lib/mochi/analyze-live";
import { MAX_ANALYSIS_BODY_BYTES } from "@/lib/mochi/image-limits";
import { analysisInputSchema } from "@/lib/mochi/schema";
import { createDemoAnalysis } from "@/lib/mochi/strategies";
import {
  CONNECTOR_TOKEN_TTL_MS,
  FixedWindowLimiter,
  MOCHI_EXTENSION_ID,
  MOCHI_WEB_CLIENT_ID,
  verifyConnectorToken,
} from "@/lib/mochi/connector-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
const analysisLimiter = new FixedWindowLimiter();

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function authorizeAnalysis(request: Request) {
  const clientId =
    request.headers.get("x-mochi-client-id") ??
    request.headers.get("x-mochi-extension-id");
  const authorization = request.headers.get("authorization");
  const secret = process.env.MOCHI_CONNECTOR_SECRET ?? "";
  if (
    (clientId !== MOCHI_EXTENSION_ID &&
      clientId !== MOCHI_WEB_CLIENT_ID) ||
    !authorization?.startsWith("Bearer ") ||
    secret.length < 32
  ) {
    return { ok: false as const, status: 401 };
  }
  const payload = verifyConnectorToken(
    authorization.slice("Bearer ".length),
    {
      extensionId: clientId,
      ip: clientIp(request),
      now: Date.now(),
      secret,
    },
  );
  if (!payload) return { ok: false as const, status: 401 };
  if (
    !analysisLimiter.take(
      `${payload.ipHash}:${payload.installId}`,
      6,
      CONNECTOR_TOKEN_TTL_MS,
    )
  ) {
    return { ok: false as const, status: 429 };
  }
  return { ok: true as const };
}

export async function POST(request: Request) {
  const authorization = authorizeAnalysis(request);
  if (!authorization.ok) {
    return NextResponse.json(
      {
        error:
          authorization.status === 429
            ? "Analysis session quota reached. Try again later."
            : "A valid Mochi session is required.",
      },
      { status: authorization.status },
    );
  }

  let payload: unknown;
  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { error: "That context packet is not valid.", issues: ["Invalid JSON."] },
      { status: 400 },
    );
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_ANALYSIS_BODY_BYTES) {
    return NextResponse.json(
      {
        error: "That context packet is too large.",
        issues: ["Keep the normalized context packet under 4 MB."],
      },
      { status: 413 },
    );
  }
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "That context packet is not valid.", issues: ["Invalid JSON."] },
      { status: 400 },
    );
  }

  const parsed = analysisInputSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "That context packet is not valid.",
        issues: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(createDemoAnalysis(parsed.data));
  }

  try {
    return NextResponse.json(await runLiveAnalysis(parsed.data));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown provider error.";
    return NextResponse.json(
      {
        error: "Mochi could not finish the live analysis.",
        detail: message,
      },
      { status: 502 },
    );
  }
}
