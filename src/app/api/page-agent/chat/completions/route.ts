import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { createHash } from "node:crypto";
import { z } from "zod";

import {
  CONNECTOR_TOKEN_TTL_MS,
  FixedWindowLimiter,
  MOCHI_EXTENSION_ID,
  verifyConnectorToken,
} from "@/lib/mochi/connector-auth";
import {
  buildPageAgentTask,
  PAGE_AGENT_SYSTEM_INSTRUCTIONS,
} from "@/lib/mochi/page-agent-task";
import { canonicalJson } from "@/lib/mochi/page-agent-contract";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 250_000;
const PAGE_AGENT_SYSTEM_PROMPT_SHA256 =
  "fcfdd783ddda5b6742b9d87da0aa71d9b629ee42e22f0ad26ef0174aa3fb47c4";
const PAGE_AGENT_TOOL_SCHEMA_SHA256 =
  "5174b1d60041603bf2d23cad1ae6bb6ee47f3775b7c59c6eea9661ebef4d6856";
const pageAgentLimiter = new FixedWindowLimiter();

const messageSchema = z
  .object({
    role: z.enum(["system", "user"]),
    content: z.string().min(1).max(250_000),
  })
  .strict();

const functionToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.literal("AgentOutput"),
    description: z.literal("You MUST call this tool every step!"),
    parameters: z.unknown(),
    strict: z.boolean().optional(),
  }).strict(),
}).strict();

const pageAgentRequestSchema = z.object({
  messages: z
    .array(messageSchema)
    .length(2)
    .refine(
      ([system, user]) =>
        system?.role === "system" && user?.role === "user",
      "Page Agent must send one system and one user message.",
    ),
  tools: z.array(functionToolSchema).length(1),
  tool_choice: z.object({
    type: z.literal("function"),
    function: z.object({ name: z.literal("AgentOutput") }),
  }),
}).strip();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatesMochiTask(task: string) {
  const lines = task.split("\n");
  if (lines.length !== 6) return false;
  const mapPrefix = "Field-value map: ";
  if (!lines[4]?.startsWith(mapPrefix)) return false;

  let rawValues: unknown;
  try {
    rawValues = JSON.parse(lines[4].slice(mapPrefix.length));
  } catch {
    return false;
  }
  if (!isRecord(rawValues)) return false;
  const entries = Object.entries(rawValues);
  if (
    entries.length > 30 ||
    entries.some(
      ([key, value]) =>
        !/^[A-Za-z0-9_-]{1,80}$/.test(key) ||
        key === "__proto__" ||
        key === "constructor" ||
        key === "prototype" ||
        typeof value !== "string" ||
        value.length > 6_000,
    ) ||
    entries.reduce(
      (total, [key, value]) => total + key.length + String(value).length,
      0,
    ) > 100_000
  ) {
    return false;
  }

  const strategy = {
    fields: Object.fromEntries(
      entries.map(([key, value]) => [
        key,
        { value: value as string },
      ]),
    ),
  };
  return (
    task === buildPageAgentTask(strategy, "fill") ||
    task === buildPageAgentTask(strategy, "autopilot")
  );
}

function validatesUserPrompt(content: string) {
  const instructionBlock = [
    "<instructions>",
    "<system_instructions>",
    PAGE_AGENT_SYSTEM_INSTRUCTIONS,
    "</system_instructions>",
    "</instructions>",
    "",
    "",
  ].join("\n");
  if (!content.startsWith(instructionBlock)) return false;
  const requestStart = "<user_request>\n";
  const requestEnd = "\n</user_request>";
  const start = content.indexOf(requestStart, instructionBlock.length);
  const end = content.indexOf(requestEnd, start + requestStart.length);
  if (start < 0 || end < 0) return false;
  const task = content.slice(start + requestStart.length, end);
  return (
    validatesMochiTask(task) &&
    /<step_info>\nStep (?:[1-9]|1[0-6]) of 16 max possible steps\n/.test(
      content,
    ) &&
    content.includes("<agent_history>\n") &&
    content.includes("<browser_state>\n") &&
    content.endsWith("</browser_state>\n\n")
  );
}

function validatesAgentTool(parameters: unknown) {
  if (!isRecord(parameters)) return false;
  const canonical = canonicalJson(parameters);
  return (
    canonical.length <= 30_000 &&
    createHash("sha256").update(canonical).digest("hex") ===
      PAGE_AGENT_TOOL_SCHEMA_SHA256
  );
}

function validatesPageAgentEnvelope(
  data: z.infer<typeof pageAgentRequestSchema>,
  systemPromptSha256: string,
) {
  const [system, user] = data.messages;
  return (
    createHash("sha256").update(system!.content).digest("hex") ===
      systemPromptSha256 &&
    validatesUserPrompt(user!.content) &&
    validatesAgentTool(data.tools[0]!.function.parameters)
  );
}

export type CreatePageAgentCompletion = (
  body: ChatCompletionCreateParamsNonStreaming,
) => Promise<unknown>;

async function createOpenAICompletion(
  body: ChatCompletionCreateParamsNonStreaming,
) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client.chat.completions.create(body);
}

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function authorizeConnector(request: Request) {
  const extensionId = request.headers.get("x-mochi-extension-id");
  const authorization = request.headers.get("authorization");
  const secret = process.env.MOCHI_CONNECTOR_SECRET ?? "";
  if (
    extensionId !== MOCHI_EXTENSION_ID ||
    !authorization?.startsWith("Bearer ") ||
    secret.length < 32
  ) {
    return { ok: false as const, status: 401 };
  }
  const token = authorization.slice("Bearer ".length);
  const payload = verifyConnectorToken(token, {
    extensionId,
    ip: clientIp(request),
    now: Date.now(),
    secret,
  });
  if (!payload) {
    return { ok: false as const, status: 401 };
  }
  if (
    !pageAgentLimiter.take(
      `${payload.ipHash}:${payload.installId}`,
      60,
      CONNECTOR_TOKEN_TTL_MS,
    )
  ) {
    return { ok: false as const, status: 429 };
  }
  return { ok: true as const };
}

export function createPageAgentChatHandler(
  createCompletion: CreatePageAgentCompletion = createOpenAICompletion,
  {
    systemPromptSha256 = PAGE_AGENT_SYSTEM_PROMPT_SHA256,
  }: { systemPromptSha256?: string } = {},
) {
  return async function handlePageAgentChat(request: Request) {
    const authorization = authorizeConnector(request);
    if (!authorization.ok) {
      return NextResponse.json(
        {
          error:
            authorization.status === 429
              ? "Page Agent session quota reached. Try again later."
              : "A valid Mochi connector session is required.",
        },
        { status: authorization.status },
      );
    }

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
    if (
      !parsed.success ||
      !validatesPageAgentEnvelope(parsed.data, systemPromptSha256)
    ) {
      return NextResponse.json(
        {
          error: "The Page Agent request is not valid.",
          ...(!parsed.success
            ? {
                issues: parsed.error.issues.map(
                  (issue) => issue.message,
                ),
              }
            : {}),
        },
        { status: 400 },
      );
    }

    const body = {
      messages: parsed.data.messages,
      tools: parsed.data.tools,
      tool_choice: parsed.data.tool_choice,
      parallel_tool_calls: false,
      max_completion_tokens: 1_200,
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
