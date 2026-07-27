import { describe, expect, it, vi } from "vitest";

import {
  askOpenAI,
  completePageAgent,
  OPENAI_MODEL,
  OPENAI_CHAT_COMPLETIONS_URL,
  OPENAI_MODEL_URL,
  OPENAI_RESPONSES_URL,
  testOpenAIKey,
} from "./openai";
import type { SafePageAgentRequest } from "./page-agent-policy";
import type { ProviderAnalysisInput } from "./analysis";

const signal = new AbortController().signal;

const input: ProviderAnalysisInput = {
  preset: "general",
  taskHint: "Keep it concise.",
  screenshots: [
    {
      id: "capture-1",
      dataUrl: "data:image/jpeg;base64,Y2FwdHVyZQ==",
      sourceUrl: "https://profile.example.test",
      sourceTitle: "Profile",
      capturedAt: "2026-07-27T04:00:00.000Z",
      kind: "viewport",
    },
  ],
  fields: [
    {
      key: "summary",
      label: "Summary",
      type: "textarea",
      required: true,
    },
  ],
};

const modelAnalysis = {
  pageSummary: "One summary field.",
  gaps: [],
  researchQuery: null,
  strategies: [
    {
      id: "safe",
      label: "Safe & precise",
      eyebrow: "Verified",
      rationale: "Use supported context.",
      confidence: 0.9,
      accent: "sage",
      fields: [
        {
          key: "summary",
          value: "Supported summary",
          status: "supported",
          confidence: 0.9,
          sourceIds: [],
        },
      ],
    },
    {
      id: "balanced",
      label: "Balanced",
      eyebrow: "Best overall",
      rationale: "Use clear context.",
      confidence: 0.88,
      accent: "violet",
      fields: [
        {
          key: "summary",
          value: "Clear summary",
          status: "draft",
          confidence: 0.8,
          sourceIds: [],
        },
      ],
    },
    {
      id: "standout",
      label: "Standout",
      eyebrow: "Memorable",
      rationale: "Use a stronger voice.",
      confidence: 0.8,
      accent: "coral",
      fields: [
        {
          key: "summary",
          value: "Memorable summary",
          status: "draft",
          confidence: 0.7,
          sourceIds: [],
        },
      ],
    },
  ],
};

function responsesPayload(value: unknown) {
  return {
    id: "resp_test",
    object: "response",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(value),
          },
        ],
      },
    ],
  };
}

describe("OpenAI provider", () => {
  it("tests access using only Mochi's fixed model endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await testOpenAIKey("sk-openai-secret", fetcher, signal);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(OPENAI_MODEL_URL);
    expect(init).toMatchObject({
      method: "GET",
      headers: { authorization: "Bearer sk-openai-secret" },
      signal,
    });
    expect(JSON.stringify(init?.body ?? "")).not.toContain(
      "sk-openai-secret",
    );
  });

  it("sends bounded multimodal structured analysis to the fixed Responses API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(responsesPayload(modelAnalysis)),
    );

    const result = await askOpenAI(
      "sk-openai-secret",
      input,
      [],
      fetcher,
      signal,
    );

    expect(result).toEqual(modelAnalysis);
    const [url, init] = fetcher.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(url).toBe(OPENAI_RESPONSES_URL);
    expect(body).toMatchObject({
      model: OPENAI_MODEL,
      max_output_tokens: 3000,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "mochi_analysis",
          strict: true,
        },
      },
    });
    expect(JSON.stringify(body)).toContain(
      "data:image/jpeg;base64,Y2FwdHVyZQ==",
    );
    expect(JSON.stringify(body)).not.toContain("sk-openai-secret");
  });

  it.each([
    [401, "OpenAI rejected this key. Replace it in Settings."],
    [403, "This key cannot use Mochi's model."],
    [404, "This key cannot use Mochi's model."],
    [429, "OpenAI rate limit or project quota reached."],
  ])("maps status %s without leaking provider details", async (status, message) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "provider detail containing sk-openai-secret" },
        }),
        { status },
      ),
    );

    await expect(
      testOpenAIKey("sk-openai-secret", fetcher, signal),
    ).rejects.toThrow(message);
  });

  it("rejects malformed structured output instead of guessing", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(responsesPayload({ strategies: [] })),
    );

    await expect(
      askOpenAI("sk-openai-secret", input, [], fetcher, signal),
    ).rejects.toThrow("OpenAI returned an invalid Mochi response.");
  });

  it("sends a sanitized Page Agent request only to OpenAI", async () => {
    const safeBody = {
      messages: [
        { role: "system" as const, content: "fixed system" },
        { role: "user" as const, content: "fixed user" },
      ],
      tools: [],
      tool_choice: {
        type: "function" as const,
        function: { name: "AgentOutput" as const },
      },
      parallel_tool_calls: false as const,
      max_completion_tokens: 1_200,
      model: OPENAI_MODEL,
      reasoning_effort: "none" as const,
      stream: false as const,
      verbosity: "low" as const,
    } satisfies SafePageAgentRequest;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"choices":[]}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-provider-secret": "drop-me",
        },
      }),
    );

    const result = await completePageAgent(
      "sk-openai-secret",
      safeBody,
      fetcher,
      signal,
    );

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(OPENAI_CHAT_COMPLETIONS_URL);
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer sk-openai-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(safeBody),
      signal,
    });
    expect(result).toEqual({
      status: 200,
      statusText: "",
      headers: { "content-type": "application/json" },
      bodyText: '{"choices":[]}',
    });
  });
});
