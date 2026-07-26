import type {
  ActionDriver,
  ExecutionMode,
  ExecutionResult,
  Strategy,
} from "@/lib/mochi/types";

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

function nonEmptyValues(strategy: Strategy) {
  return Object.fromEntries(
    Object.entries(strategy.fields)
      .filter(([, suggestion]) => suggestion.value.trim().length > 0)
      .map(([key, suggestion]) => [key, suggestion.value]),
  );
}

export function buildPageAgentTask(
  strategy: Strategy,
  mode: ExecutionMode,
) {
  const values = nonEmptyValues(strategy);
  const submitInstruction =
    mode === "autopilot"
      ? "After verifying every filled value, submit exactly once."
      : "Do not submit the form, click a final confirmation, or navigate away.";

  return [
    "Fill the single visible form using only the exact field-value map below.",
    "Match keys to labels, names, or accessible descriptions. Skip any field not present.",
    "Never infer or invent a missing value. Do not alter fields outside this map.",
    `Field-value map: ${JSON.stringify(values)}`,
    submitInstruction,
  ].join("\n");
}

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
      const values = nonEmptyValues(strategy);

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

