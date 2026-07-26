import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MochiOverlay } from "@/components/mochi/mochi-overlay";
import type { AnalysisResult, PageField } from "@/lib/mochi/types";

const fields: PageField[] = [
  { key: "name", label: "Full name", type: "text", required: true },
  { key: "summary", label: "Why you?", type: "textarea", required: true },
];

const result: AnalysisResult = {
  engine: "demo",
  notice: "Interactive demo",
  pageSummary: "A job application form.",
  gaps: ["Confirm your full name."],
  strategies: [
    {
      id: "safe",
      label: "Safe & precise",
      eyebrow: "Verified facts first",
      rationale: "Conservative.",
      confidence: 0.84,
      accent: "sage",
      fields: {
        name: { value: "", status: "needs-input", confidence: 0 },
        summary: { value: "Safe draft.", status: "draft", confidence: 0.7 },
      },
      sources: [],
    },
    {
      id: "balanced",
      label: "Balanced",
      eyebrow: "Best all-rounder",
      rationale: "Clear and grounded.",
      confidence: 0.92,
      accent: "violet",
      fields: {
        name: { value: "", status: "needs-input", confidence: 0 },
        summary: {
          value: "Balanced draft.",
          status: "draft",
          confidence: 0.8,
        },
      },
      sources: [],
    },
    {
      id: "standout",
      label: "Standout",
      eyebrow: "Memorable framing",
      rationale: "Bolder.",
      confidence: 0.82,
      accent: "coral",
      fields: {
        name: { value: "", status: "needs-input", confidence: 0 },
        summary: { value: "Standout draft.", status: "draft", confidence: 0.7 },
      },
      sources: [],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MochiOverlay", () => {
  it("turns the pet into an overlay and carries screenshot context through to fill", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn().mockResolvedValue({
      status: "filled",
      adapter: "dom",
      values: { name: "", summary: "Balanced draft." },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <MochiOverlay
        fields={fields}
        preset="job"
        onExecute={onExecute}
        onUndo={vi.fn()}
        canUndo={false}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /open mochi/i }),
    );
    expect(
      screen.getByRole("dialog", { name: /mochi context assistant/i }),
    ).toBeInTheDocument();

    const screenshot = new File(["pixel"], "resume-shot.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText(/add screenshots/i), screenshot);
    expect(await screen.findByText("resume-shot.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /analyze context/i }));
    expect(
      await screen.findByRole("button", { name: /balanced/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("strategy-card")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: /balanced/i }));
    await user.click(screen.getByRole("radio", { name: /fill only/i }));
    await user.click(screen.getByRole("button", { name: /fill this page/i }));

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith(result.strategies[1], "fill");
    });
    expect(screen.getByText(/page filled/i)).toBeInTheDocument();
  });

  it("keeps review mode non-mutating until the user approves", async () => {
    const user = userEvent.setup();
    const onExecute = vi
      .fn()
      .mockResolvedValueOnce({
        status: "preview",
        adapter: "dom",
        values: { summary: "Balanced draft." },
      })
      .mockResolvedValueOnce({
        status: "filled",
        adapter: "dom",
        values: { summary: "Balanced draft." },
      });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <MochiOverlay
        fields={fields}
        preset="job"
        onExecute={onExecute}
        onUndo={vi.fn()}
        canUndo={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /open mochi/i }));
    await user.click(screen.getByRole("button", { name: /use sample context/i }));
    await user.click(screen.getByRole("button", { name: /analyze context/i }));
    await user.click(
      await screen.findByRole("button", { name: /review changes/i }),
    );

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ready for your approval/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /approve and fill/i }));
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
  });
});

