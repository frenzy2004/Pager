import { describe, expect, it } from "vitest";

import {
  buildPageAgentTask,
  strategyValues,
} from "@/lib/mochi/page-agent-task";

const strategy = {
  fields: {
    fullName: { value: "", status: "needs-input", confidence: 0 },
    summary: {
      value: "A grounded draft.",
      status: "draft",
      confidence: 0.8,
    },
  },
};

describe("shared Page Agent task", () => {
  it("omits unknown values and protects fill-only submit boundaries", () => {
    expect(strategyValues(strategy)).toEqual({
      summary: "A grounded draft.",
    });
    expect(buildPageAgentTask(strategy, "fill")).toContain(
      '"summary":"A grounded draft."',
    );
    expect(buildPageAgentTask(strategy, "fill")).not.toContain("fullName");
    expect(buildPageAgentTask(strategy, "fill")).toContain(
      "Do not submit the form",
    );
  });

  it("allows exactly one verified submit in autopilot", () => {
    expect(buildPageAgentTask(strategy, "autopilot")).toContain(
      "submit exactly once",
    );
  });
});
