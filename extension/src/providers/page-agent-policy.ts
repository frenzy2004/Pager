import { z } from "zod";

import {
  canonicalJson,
} from "../../../src/lib/mochi/page-agent-contract";
import {
  buildPageAgentTask,
  PAGE_AGENT_SYSTEM_INSTRUCTIONS,
} from "../../../src/lib/mochi/page-agent-task";
import { OPENAI_MODEL } from "./openai";

const MAX_BODY_BYTES = 250_000;
const PAGE_AGENT_SYSTEM_PROMPT_SHA256 =
  "fcfdd783ddda5b6742b9d87da0aa71d9b629ee42e22f0ad26ef0174aa3fb47c4";
const PAGE_AGENT_TOOL_SCHEMA_SHA256 =
  "5174b1d60041603bf2d23cad1ae6bb6ee47f3775b7c59c6eea9661ebef4d6856";

const messageSchema = z
  .object({
    role: z.enum(["system", "user"]),
    content: z.string().min(1).max(250_000),
  })
  .strict();

const functionToolSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z.literal("AgentOutput"),
        description: z.literal("You MUST call this tool every step!"),
        parameters: z.unknown(),
        strict: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

const pageAgentRequestSchema = z
  .object({
    messages: z
      .array(messageSchema)
      .length(2)
      .refine(
        ([system, user]) =>
          system?.role === "system" && user?.role === "user",
      ),
    tools: z.array(functionToolSchema).length(1),
    tool_choice: z.object({
      type: z.literal("function"),
      function: z.object({ name: z.literal("AgentOutput") }),
    }),
  })
  .strip();

type ParsedPageAgentRequest = z.infer<typeof pageAgentRequestSchema>;

export interface SafePageAgentRequest {
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  tools: ParsedPageAgentRequest["tools"];
  tool_choice: ParsedPageAgentRequest["tool_choice"];
  parallel_tool_calls: false;
  max_completion_tokens: 1_200;
  model: typeof OPENAI_MODEL;
  reasoning_effort: "none";
  stream: false;
  verbosity: "low";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

async function validatesEnvelope(
  data: ParsedPageAgentRequest,
  systemPromptSha256: string,
) {
  const [system, user] = data.messages;
  if (!system || !user) return false;
  const toolParameters = data.tools[0]?.function.parameters;
  if (canonicalJson(toolParameters).length > 30_000) return false;
  return (
    (await sha256(system.content)) === systemPromptSha256 &&
    validatesUserPrompt(user.content) &&
    (await sha256(canonicalJson(toolParameters))) ===
      PAGE_AGENT_TOOL_SCHEMA_SHA256
  );
}

export async function sanitizePageAgentRequest(
  rawBody: string,
  {
    systemPromptSha256 = PAGE_AGENT_SYSTEM_PROMPT_SHA256,
  }: { systemPromptSha256?: string } = {},
): Promise<SafePageAgentRequest> {
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    throw new Error("Page Agent request is too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new Error("Page Agent request is not valid.");
  }
  const parsed = pageAgentRequestSchema.safeParse(value);
  if (
    !parsed.success ||
    !(await validatesEnvelope(parsed.data, systemPromptSha256))
  ) {
    throw new Error("Page Agent request is not valid.");
  }
  return {
    messages: parsed.data.messages,
    tools: parsed.data.tools,
    tool_choice: parsed.data.tool_choice,
    parallel_tool_calls: false,
    max_completion_tokens: 1_200,
    model: OPENAI_MODEL,
    reasoning_effort: "none",
    stream: false,
    verbosity: "low",
  };
}
