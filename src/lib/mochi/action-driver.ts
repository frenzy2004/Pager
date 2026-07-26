import type {
  ActionDriver,
  ExecutionMode,
  ExecutionResult,
  Strategy,
} from "@/lib/mochi/types";

export interface DomActionHooks {
  fill(values: Record<string, string>): void | Promise<void>;
  submit(): void | Promise<void>;
  countdownMs?: number;
}

function strategyValues(strategy: Strategy) {
  return Object.fromEntries(
    Object.entries(strategy.fields)
      .filter(([, suggestion]) => suggestion.value.trim().length > 0)
      .map(([key, suggestion]) => [key, suggestion.value]),
  );
}

export function createDomActionDriver({
  fill,
  submit,
  countdownMs = 3000,
}: DomActionHooks): ActionDriver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolvePending: ((result: ExecutionResult) => void) | null = null;
  let pendingValues: Record<string, string> = {};
  let cancelRequested = false;

  return {
    async execute(strategy: Strategy, mode: ExecutionMode) {
      cancelRequested = false;
      const values = strategyValues(strategy);

      if (mode === "review") {
        return { status: "preview", adapter: "dom", values };
      }

      await fill(values);

      if (mode === "fill") {
        return { status: "filled", adapter: "dom", values };
      }

      pendingValues = values;
      if (cancelRequested) {
        return { status: "cancelled", adapter: "dom", values };
      }

      return new Promise<ExecutionResult>((resolve) => {
        resolvePending = resolve;
        timer = setTimeout(async () => {
          timer = null;
          await submit();
          resolvePending = null;
          cancelRequested = false;
          resolve({ status: "submitted", adapter: "dom", values });
        }, countdownMs);
      });
    },

    cancel() {
      cancelRequested = true;
      if (!timer || !resolvePending) {
        return;
      }

      clearTimeout(timer);
      timer = null;
      const resolve = resolvePending;
      resolvePending = null;
      cancelRequested = false;
      resolve({
        status: "cancelled",
        adapter: "dom",
        values: pendingValues,
      });
    },
  };
}
