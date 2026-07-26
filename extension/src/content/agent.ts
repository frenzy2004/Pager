import {
  PageAgent,
  type ExecutionResult,
  type PageAgentConfig,
} from "page-agent";

import {
  buildPageAgentTask,
  strategyValues,
} from "../../../src/lib/mochi/page-agent-task";
import type {
  ExecutionMode,
  PageAgentFetchResponse,
  Strategy,
} from "../shared/protocol";
import {
  applyExactValues,
  snapshotSafeValues,
  undoExactValues,
  type UndoEntry,
} from "./exact-driver";

const PAGE_AGENT_BASE_URL =
  "https://mochi-overlay.vercel.app/api/page-agent";

export interface AgentRuntime {
  sendMessage(message: {
    type: "FETCH_PAGE_AGENT";
    body: string;
  }): Promise<unknown>;
}

interface PageAgentLike {
  dispose(): void;
  execute(task: string): Promise<ExecutionResult>;
  stop(): Promise<void>;
}

export type PageAgentFactory = (config: PageAgentConfig) => PageAgentLike;

interface PageAgentExecutorOptions {
  createAgent?: PageAgentFactory;
  document: Document;
  runtime: AgentRuntime;
}

interface RuntimeEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function unwrapFetchResponse(value: unknown): PageAgentFetchResponse {
  let candidate = value;
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value
  ) {
    const envelope = value as RuntimeEnvelope;
    if (!envelope.ok) {
      throw new Error(envelope.error ?? "Page Agent proxy failed.");
    }
    candidate = envelope.result;
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("status" in candidate) ||
    !("bodyText" in candidate)
  ) {
    throw new Error("Page Agent proxy returned an invalid response.");
  }
  return candidate as PageAgentFetchResponse;
}

export function createPageAgentExecutor({
  createAgent = (config) => new PageAgent(config),
  document: pageDocument,
  runtime,
}: PageAgentExecutorOptions) {
  let activeAgent: PageAgentLike | null = null;
  let undoSnapshot: UndoEntry[] = [];

  const customFetch: typeof fetch = async (_input, init) => {
    if (typeof init?.body !== "string") {
      throw new Error("Page Agent sent an unsupported request body.");
    }
    const proxy = unwrapFetchResponse(
      await runtime.sendMessage({
        type: "FETCH_PAGE_AGENT",
        body: init.body,
      }),
    );
    return new Response(proxy.bodyText, {
      status: proxy.status,
      statusText: proxy.statusText,
      headers: proxy.headers,
    });
  };

  return {
    async run(strategy: Strategy, mode: ExecutionMode) {
      const values = strategyValues(strategy);
      if (mode === "review") {
        return {
          status: "preview" as const,
          adapter: "page-agent" as const,
          values,
          changedFields: 0,
        };
      }

      activeAgent?.dispose();
      undoSnapshot = snapshotSafeValues(pageDocument);
      const agent = createAgent({
        apiKey: "",
        baseURL: PAGE_AGENT_BASE_URL,
        model: "gpt-5.6-sol",
        language: "en-US",
        maxSteps: 16,
        enableMask: true,
        promptForNextTask: false,
        customFetch,
        customTools: {
          ask_user: null,
        },
        experimentalScriptExecutionTool: false,
        instructions: {
          system:
            "Act only on the current top-level form. Use the exact provided values, respect submit boundaries, and never guess personal facts or touch credentials, payment, uploads, OTP, or CAPTCHA.",
        },
      });
      activeAgent = agent;
      try {
        const result = await agent.execute(buildPageAgentTask(strategy, mode));
        if (!result.success) {
          throw new Error(result.data || "Page Agent could not finish.");
        }
      } catch (error) {
        if (Object.keys(values).length === 0) {
          throw error;
        }
        const fallback = applyExactValues(pageDocument, values);
        if (fallback.changed.length === 0) {
          throw error;
        }
        return {
          status: "filled" as const,
          adapter: "exact-fallback" as const,
          values,
          changedFields: fallback.changed.length,
          warning:
            "Page Agent was unavailable, so Mochi used exact field mappings and did not submit.",
        };
      }
      return {
        status: mode === "autopilot" ? ("submitted" as const) : ("filled" as const),
        adapter: "page-agent" as const,
        values,
        changedFields: Object.keys(values).length,
      };
    },
    cancel() {
      if (activeAgent) {
        void activeAgent.stop();
      }
    },
    undo() {
      undoExactValues(pageDocument, undoSnapshot);
      undoSnapshot = [];
    },
  };
}

declare global {
  interface Window {
    __mochiPageAgentInstalled?: boolean;
  }
}

if (
  typeof chrome !== "undefined" &&
  chrome.runtime?.id &&
  !window.__mochiPageAgentInstalled
) {
  window.__mochiPageAgentInstalled = true;
  const executor = createPageAgentExecutor({
    document,
    runtime: {
      sendMessage(message) {
        return chrome.runtime.sendMessage(message);
      },
    },
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message)
    ) {
      return;
    }
    if (
      message.type === "RUN_PAGE_AGENT" &&
      "strategy" in message &&
      "mode" in message
    ) {
      void executor
        .run(message.strategy as Strategy, message.mode as ExecutionMode)
        .then(
          (result) => sendResponse(result),
          (error: unknown) =>
            sendResponse({
              error:
                error instanceof Error
                  ? error.message
                  : "Page Agent could not finish.",
            }),
        );
      return true;
    }
    if (message.type === "CANCEL_EXECUTION") {
      executor.cancel();
      sendResponse({ status: "cancelled" });
      return;
    }
    if (message.type === "UNDO") {
      executor.undo();
      sendResponse({ status: "undone" });
    }
  });
}
