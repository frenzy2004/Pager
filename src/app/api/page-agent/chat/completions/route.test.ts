import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPageAgentChatHandler } from "./route";

const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.PAGE_AGENT_MODEL;

function requestWith(body: unknown, authorization = "Bearer browser-secret") {
  return new Request(
    "http://localhost/api/page-agent/chat/completions",
    {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

const validBody = {
  model: "attacker-controlled-model",
  messages: [
    { role: "system", content: "Operate the current page safely." },
    { role: "user", content: "Fill the visible name field." },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "fill",
        description: "Fill a safe field.",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    },
  ],
  tool_choice: "required",
  parallel_tool_calls: true,
  reasoning_effort: "max",
  stream: true,
};

describe("POST /api/page-agent/chat/completions", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "server-only-key";
    process.env.PAGE_AGENT_MODEL = "gpt-5.6-sol";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    process.env.PAGE_AGENT_MODEL = originalModel;
    vi.restoreAllMocks();
  });

  it("requires a server-side OpenAI key", async () => {
    delete process.env.OPENAI_API_KEY;
    const createCompletion = vi.fn();
    const response = await createPageAgentChatHandler(createCompletion)(
      requestWith(validBody),
    );

    expect(response.status).toBe(503);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized bodies", async () => {
    const handler = createPageAgentChatHandler(vi.fn());
    const malformed = await handler(
      requestWith({ messages: [], tools: [] }),
    );
    const oversized = await handler(
      new Request(
        "http://localhost/api/page-agent/chat/completions",
        {
          method: "POST",
          body: JSON.stringify({
            ...validBody,
            padding: "x".repeat(1_000_001),
          }),
        },
      ),
    );

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
  });

  it("strips browser model/auth choices and pins tool-safe GPT-5.6 settings", async () => {
    const completion = {
      id: "chatcmpl-test",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [],
          },
        },
      ],
    };
    const createCompletion = vi.fn().mockResolvedValue(completion);
    const response = await createPageAgentChatHandler(createCompletion)(
      requestWith(validBody),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(completion);
    expect(createCompletion).toHaveBeenCalledWith({
      messages: validBody.messages,
      tools: validBody.tools,
      tool_choice: "required",
      parallel_tool_calls: false,
      model: "gpt-5.6-sol",
      reasoning_effort: "none",
      stream: false,
      verbosity: "low",
    });
  });
});
