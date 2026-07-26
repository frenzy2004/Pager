import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPageAgentExecutor,
  type AgentRuntime,
  type PageAgentFactory,
} from "./agent";
import type { Strategy } from "../shared/protocol";

const strategy: Strategy = {
  id: "balanced",
  label: "Balanced",
  eyebrow: "Best overall",
  rationale: "Clear and grounded.",
  confidence: 0.9,
  accent: "violet",
  fields: {
    name: {
      value: "Jamie Chen",
      status: "supported",
      confidence: 1,
      sourceIds: [],
    },
  },
  sources: [],
};

function runtime(): AgentRuntime & {
  sendMessage: ReturnType<typeof vi.fn>;
} {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      ok: true,
      result: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        bodyText: '{"choices":[]}',
      },
    }),
  };
}

describe("Alibaba Page Agent connector executor", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <label for="name">Full name</label>
      <input id="name" name="name" value="Before" />
    `;
  });

  it("keeps review mode non-mutating and does not construct an agent", async () => {
    const createAgent = vi.fn();
    const executor = createPageAgentExecutor({
      createAgent,
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "review")).resolves.toMatchObject({
      status: "preview",
      values: { name: "Jamie Chen" },
    });
    expect(createAgent).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
  });

  it("configures Page Agent with a fixed Vercel custom fetch and sixteen steps", async () => {
    const execute = vi.fn().mockImplementation(async () => {
      document.querySelector<HTMLInputElement>("[name=name]")!.value =
        "Jamie Chen";
      return { success: true, data: "Filled", history: [] };
    });
    const stop = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn();
    const createAgent = vi.fn<PageAgentFactory>(() => ({
      dispose,
      execute,
      stop,
    }));
    const agentRuntime = runtime();
    const executor = createPageAgentExecutor({
      createAgent,
      document,
      runtime: agentRuntime,
    });

    await expect(executor.run(strategy, "fill")).resolves.toMatchObject({
      status: "filled",
      values: { name: "Jamie Chen" },
    });

    const config = createAgent.mock.calls[0]![0];
    expect(config).toMatchObject({
      apiKey: "",
      baseURL: "https://mochi-overlay.vercel.app/api/page-agent",
      language: "en-US",
      maxSteps: 16,
      model: "gpt-5.6-sol",
      promptForNextTask: false,
    });
    expect(config.customTools).toMatchObject({ ask_user: null });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("Do not submit the form"),
    );

    const response = await config.customFetch!(
      "https://attacker.example.test/chat/completions",
      { method: "POST", body: '{"messages":[]}' },
    );
    expect(agentRuntime.sendMessage).toHaveBeenCalledWith({
      type: "FETCH_PAGE_AGENT",
      body: '{"messages":[]}',
    });
    expect(response.status).toBe(200);

    executor.cancel();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("snapshots safe controls and can undo Page Agent changes", async () => {
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute: async () => {
          document.querySelector<HTMLInputElement>("[name=name]")!.value =
            "Jamie Chen";
          return { success: true, data: "Filled", history: [] };
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await executor.run(strategy, "fill");
    executor.undo();

    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
  });

  it("uses the exact-map fallback only after Page Agent was attempted", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("Provider offline"));
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute,
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "fill")).resolves.toMatchObject({
      status: "filled",
      adapter: "exact-fallback",
      changedFields: 1,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Jamie Chen");
  });

  it("treats a resolved Page Agent failure as a failure before falling back", async () => {
    const execute = vi.fn().mockResolvedValue({
      success: false,
      data: "Invalid model tool response",
      history: [],
    });
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute,
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "fill")).resolves.toMatchObject({
      status: "filled",
      adapter: "exact-fallback",
      warning: expect.stringContaining("exact field mappings"),
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Jamie Chen");
  });
});
