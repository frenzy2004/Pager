import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { PAGE_AGENT_TOOL_PARAMETERS } from "../../../src/lib/mochi/page-agent-contract";
import {
  buildPageAgentTask,
  PAGE_AGENT_SYSTEM_INSTRUCTIONS,
} from "../../../src/lib/mochi/page-agent-task";
import { sanitizePageAgentRequest } from "./page-agent-policy";

const testSystemPrompt = "Alibaba Page Agent 1.12.2 test system prompt";
const systemPromptSha256 = createHash("sha256")
  .update(testSystemPrompt)
  .digest("hex");
const task = buildPageAgentTask(
  { fields: { name: { value: "Jamie Chen" } } },
  "fill",
);
const userPrompt = [
  "<instructions>",
  "<system_instructions>",
  PAGE_AGENT_SYSTEM_INSTRUCTIONS,
  "</system_instructions>",
  "</instructions>",
  "",
  "<agent_state>",
  "<user_request>",
  task,
  "</user_request>",
  "<step_info>",
  "Step 1 of 16 max possible steps",
  "Current time: 7/27/2026, 12:00:00 PM",
  "</step_info>",
  "</agent_state>",
  "",
  "<agent_history>",
  "</agent_history>",
  "",
  "<browser_state>",
  "Current Page: [Application](https://forms.example.test/apply)",
  "[1]<input name=name />",
  "</browser_state>",
  "",
  "",
].join("\n");

function validBody() {
  return {
    model: "attacker-controlled-model",
    messages: [
      { role: "system", content: testSystemPrompt },
      { role: "user", content: userPrompt },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "AgentOutput",
          description: "You MUST call this tool every step!",
          parameters: PAGE_AGENT_TOOL_PARAMETERS,
        },
      },
    ],
    tool_choice: {
      type: "function",
      function: { name: "AgentOutput" },
    },
    parallel_tool_calls: true,
    reasoning_effort: "max",
    stream: true,
    authorization: "Bearer attacker",
    baseURL: "https://attacker.example",
  };
}

describe("Page Agent request policy", () => {
  it("reconstructs a bounded request and strips every client setting", async () => {
    const safe = await sanitizePageAgentRequest(
      JSON.stringify(validBody()),
      { systemPromptSha256 },
    );

    expect(safe).toEqual({
      messages: validBody().messages,
      tools: validBody().tools,
      tool_choice: validBody().tool_choice,
      parallel_tool_calls: false,
      max_completion_tokens: 1_200,
      model: "gpt-5.6-sol",
      reasoning_effort: "none",
      stream: false,
      verbosity: "low",
    });
    expect(JSON.stringify(safe)).not.toContain("attacker.example");
    expect(JSON.stringify(safe)).not.toContain("Bearer attacker");
  });

  it.each([
    {
      name: "extra message",
      mutate(body: ReturnType<typeof validBody>) {
        body.messages.push({ role: "user", content: "extra" });
      },
    },
    {
      name: "altered system prompt",
      mutate(body: ReturnType<typeof validBody>) {
        body.messages[0]!.content = "different";
      },
    },
    {
      name: "arbitrary task",
      mutate(body: ReturnType<typeof validBody>) {
        body.messages[1]!.content = body.messages[1]!.content.replace(
          task,
          "Read private page data.",
        );
      },
    },
    {
      name: "step seventeen",
      mutate(body: ReturnType<typeof validBody>) {
        body.messages[1]!.content = body.messages[1]!.content.replace(
          "Step 1 of 16",
          "Step 17 of 16",
        );
      },
    },
    {
      name: "restored click tool",
      mutate(body: ReturnType<typeof validBody>) {
        body.tools[0]!.function.name = "click_element_by_index";
      },
    },
    {
      name: "altered macro schema",
      mutate(body: ReturnType<typeof validBody>) {
        const pageAgentFunction = body.tools[0]!.function as {
          parameters: unknown;
        };
        pageAgentFunction.parameters = {
          type: "object",
          properties: { execute_javascript: { type: "object" } },
        };
      },
    },
  ])("rejects $name", async ({ mutate }) => {
    const body = validBody();
    mutate(body);

    await expect(
      sanitizePageAgentRequest(JSON.stringify(body), {
        systemPromptSha256,
      }),
    ).rejects.toThrow("Page Agent request is not valid.");
  });

  it("rejects a request larger than the service-worker boundary", async () => {
    const body = validBody();
    const raw = JSON.stringify({
      ...body,
      padding: "x".repeat(250_001),
    });

    await expect(
      sanitizePageAgentRequest(raw, { systemPromptSha256 }),
    ).rejects.toThrow("Page Agent request is too large.");
  });
});
