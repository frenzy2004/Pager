import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductDemo } from "@/components/demo/product-demo";
import { createDemoAnalysis } from "@/lib/mochi/strategies";
import type { AnalysisInput } from "@/lib/mochi/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductDemo", () => {
  it("fills and undoes the real embedded form through Mochi", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const packet = JSON.parse(String(init?.body)) as AnalysisInput;
      return new Response(JSON.stringify(createDemoAnalysis(packet)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(<ProductDemo />);

    await user.click(screen.getByRole("button", { name: /open mochi/i }));
    await user.click(screen.getByRole("button", { name: /use sample context/i }));
    await user.click(screen.getByRole("button", { name: /analyze context/i }));
    await screen.findByRole("button", { name: /balanced/i });
    await user.click(screen.getByRole("radio", { name: /fill only/i }));
    await user.click(screen.getByRole("button", { name: /fill this page/i }));

    const summary = screen.getByRole("textbox", {
      name: /why are you a strong fit/i,
    });
    await waitFor(() =>
      expect((summary as HTMLTextAreaElement).value).toContain("product"),
    );

    await user.click(screen.getByRole("button", { name: /undo page changes/i }));
    expect(summary).toHaveValue("");
  });

  it("switches the same universal surface between job, lead, and general missions", async () => {
    const user = userEvent.setup();
    render(<ProductDemo />);

    expect(
      screen.getByRole("heading", { name: /product designer application/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /sales lead/i }));
    expect(
      screen.getByRole("heading", { name: /qualify a promising lead/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /general form/i }));
    expect(
      screen.getByRole("heading", { name: /make a considered request/i }),
    ).toBeInTheDocument();
  });
});
