import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 1_000_000;

const messageSchema = z
  .object({
    role: z.enum(["developer", "system", "user", "assistant", "tool"]),
    content: z.union([
      z.string().max(250_000),
      z.array(z.unknown()).max(20),
      z.null(),
    ]),
    name: z.string().max(64).optional(),
    tool_call_id: z.string().max(120).optional(),
    tool_calls: z.array(z.unknown()).max(8).optional(),
  })
  .passthrough();

const functionToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    description: z.string().max(2_000).optional(),
    parameters: z.record(z.string(), z.unknown()),
    strict: z.boolean().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string().min(1).max(64) }),
  }),
]);

const pageAgentRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  tools: z.array(functionToolSchema).min(1).max(24),
  tool_choice: toolChoiceSchema.optional(),
});

export type CreatePageAgentCompletion = (
  body: ChatCompletionCreateParamsNonStreaming,
) => Promise<unknown>;

async function createOpenAICompletion(
  body: ChatCompletionCreateParamsNonStreaming,
) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client.chat.completions.create(body);
}

export function createPageAgentChatHandler(
  createCompletion: CreatePageAgentCompletion = createOpenAICompletion,
) {
  return async function handlePageAgentChat(request: Request) {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Page Agent is not configured on this deployment." },
        { status: 503 },
      );
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return NextResponse.json(
        { error: "Could not read the Page Agent request." },
        { status: 400 },
      );
    }

    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "The Page Agent request is too large." },
        { status: 413 },
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "The Page Agent request is not valid JSON." },
        { status: 400 },
      );
    }

    const parsed = pageAgentRequestSchema.safeParse(value);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "The Page Agent request is not valid.",
          issues: parsed.error.issues.map((issue) => issue.message),
        },
        { status: 400 },
      );
    }

    const body = {
      messages: parsed.data.messages,
      tools: parsed.data.tools,
      tool_choice: parsed.data.tool_choice,
      parallel_tool_calls: false,
      model:
        process.env.PAGE_AGENT_MODEL ??
        process.env.OPENAI_MODEL ??
        "gpt-5.6-sol",
      reasoning_effort: "none",
      stream: false,
      verbosity: "low",
    } as ChatCompletionCreateParamsNonStreaming;

    try {
      return NextResponse.json(await createCompletion(body));
    } catch (error) {
      return NextResponse.json(
        {
          error: "Page Agent could not reach the model.",
          detail:
            error instanceof Error ? error.message : "Unknown provider error.",
        },
        { status: 502 },
      );
    }
  };
}

export const POST = createPageAgentChatHandler();
