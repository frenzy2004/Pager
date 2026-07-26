import { describe, expect, it, vi } from "vitest";

import { createDomActionDriver } from "@/lib/mochi/action-driver";
import type { Strategy } from "@/lib/mochi/types";

const strategy: Strategy = {
  id: "balanced",
  label: "Balanced",
  eyebrow: "Best all-rounder",
  rationale: "Grounded and direct.",
  confidence: 0.91,
  accent: "violet",
  fields: {
    name: { value: "", status: "needs-input", confidence: 0 },
    summary: { value: "A clear summary.", status: "draft", confidence: 0.8 },
  },
  sources: [],
};

describe("createDomActionDriver", () => {
  it("returns a preview without mutating the form in review mode", async () => {
    const fill = vi.fn();
    const submit = vi.fn();
    const driver = createDomActionDriver({ fill, submit });

    const result = await driver.execute(strategy, "review");

    expect(result.status).toBe("preview");
    expect(fill).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("fills but never submits in fill-only mode", async () => {
    const fill = vi.fn();
    const submit = vi.fn();
    const driver = createDomActionDriver({ fill, submit });

    const result = await driver.execute(strategy, "fill");

    expect(result.status).toBe("filled");
    expect(fill).toHaveBeenCalledWith({
      summary: "A clear summary.",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("fills and schedules a cancellable submit in autopilot mode", async () => {
    vi.useFakeTimers();
    const fill = vi.fn();
    const submit = vi.fn();
    const driver = createDomActionDriver({ fill, submit, countdownMs: 3000 });

    const execution = driver.execute(strategy, "autopilot");
    await vi.advanceTimersByTimeAsync(2999);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(execution).resolves.toMatchObject({ status: "submitted" });
    expect(fill).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("cancels autopilot before submission", async () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const driver = createDomActionDriver({
      fill: vi.fn(),
      submit,
      countdownMs: 3000,
    });

    const execution = driver.execute(strategy, "autopilot");
    driver.cancel();
    await vi.runAllTimersAsync();

    await expect(execution).resolves.toMatchObject({ status: "cancelled" });
    expect(submit).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
