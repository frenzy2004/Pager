import { NextResponse } from "next/server";

import { runLiveAnalysis } from "@/lib/mochi/analyze-live";
import { analysisInputSchema } from "@/lib/mochi/schema";
import { createDemoAnalysis } from "@/lib/mochi/strategies";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
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

