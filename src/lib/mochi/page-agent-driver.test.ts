import { describe, expect, it, vi } from "vitest";

import {
  buildPageAgentTask,
  createPageAgentDriver,
} from "@/lib/mochi/page-agent-driver";
import type { Strategy } from "@/lib/mochi/types";

const strategy: Strategy = {
  id: "balanced",
  label: "Balanced",
  eyebrow: "Best all-rounder",
  rationale: "Grounded.",
  confidence: 0.9,
  accent: "violet",
  fields: {
    fullName: { value: "", status: "needs-input", confidence: 0 },
    summary: { value: "A grounded draft.", status: "draft", confidence: 0.8 },
  },
  sources: [],
};

describe("Page Agent bridge", () => {
  it("builds a bounded task that omits unknown fields and protects submit mode", () => {
    expect(buildPageAgentTask(strategy, "fill")).toContain(
      '"summary":"A grounded draft."',
    );
    expect(buildPageAgentTask(strategy, "fill")).not.toContain("fullName");
    expect(buildPageAgentTask(strategy, "fill")).toContain(
      "Do not submit the form",
    );
    expect(buildPageAgentTask(strategy, "autopilot")).toContain(
      "Do not click or submit",
    );
  });

  it("executes through Page Agent and exposes cancellation", async () => {
    const execute = vi.fn().mockResolvedValue({ success: true });
    const stop = vi.fn().mockResolvedValue(undefined);
    const driver = await createPageAgentDriver(
      {
        baseURL: "https://example.test/v1",
        model: "test-model",
        apiKey: "session-only",
      },
      async () => ({ execute, stop, dispose: vi.fn() }),
    );

    const result = await driver.execute(strategy, "fill");
    driver.cancel();

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("summary"));
    expect(result).toMatchObject({ status: "filled", adapter: "page-agent" });
    expect(stop).toHaveBeenCalledOnce();
  });
});
