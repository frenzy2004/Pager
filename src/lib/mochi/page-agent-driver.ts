import type {
  ActionDriver,
  ExecutionMode,
  ExecutionResult,
  Strategy,
} from "@/lib/mochi/types";
import {
  buildPageAgentTask,
  strategyValues,
} from "@/lib/mochi/page-agent-task";

export interface PageAgentRuntimeConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
}

interface PageAgentLike {
  execute(task: string): Promise<unknown>;
  stop(): Promise<void>;
  dispose(): void;
}

type PageAgentFactory = () => Promise<PageAgentLike>;

export { buildPageAgentTask } from "@/lib/mochi/page-agent-task";

export async function createPageAgentDriver(
  config: PageAgentRuntimeConfig,
  injectedFactory?: PageAgentFactory,
): Promise<ActionDriver> {
  const factory: PageAgentFactory =
    injectedFactory ??
    (async () => {
      const { PageAgent } = await import("page-agent");
      return new PageAgent({
        ...config,
        language: "en-US",
        maxSteps: 16,
        enableMask: true,
        promptForNextTask: false,
        customTools: {
          ask_user: null,
        },
        instructions: {
          system:
            "Act only on the current form. Respect explicit submit boundaries. Never guess missing personal facts.",
        },
      });
    });

  const agent = await factory();

  return {
    async execute(
      strategy: Strategy,
      mode: ExecutionMode,
    ): Promise<ExecutionResult> {
      const values = strategyValues(strategy);

      if (mode === "review") {
        return { status: "preview", adapter: "page-agent", values };
      }

      await agent.execute(buildPageAgentTask(strategy, mode));
      return {
        status: mode === "autopilot" ? "submitted" : "filled",
        adapter: "page-agent",
        values,
      };
    },

    cancel() {
      void agent.stop();
    },
  };
}
