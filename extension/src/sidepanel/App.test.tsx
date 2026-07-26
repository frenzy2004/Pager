import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  App,
  type SidePanelRuntime,
} from "./App";
import type {
  ConnectorMessage,
  ConnectorSession,
} from "../shared/protocol";
import { createEmptySession } from "../shared/session";

function readySession(): ConnectorSession {
  return {
    ...createEmptySession(),
    captures: [
      {
        id: "capture-1",
        dataUrl: "data:image/jpeg;base64,YQ==",
        sourceUrl: "https://profile.example.test/me",
        sourceTitle: "My profile",
        capturedAt: "2026-07-26T11:00:00.000Z",
        kind: "viewport",
      },
      {
        id: "capture-2",
        dataUrl: "data:image/jpeg;base64,Yg==",
        sourceUrl: "https://company.example.test/about",
        sourceTitle: "Company",
        capturedAt: "2026-07-26T11:05:00.000Z",
        kind: "region",
      },
    ],
    strategies: [
      {
        id: "safe",
        label: "Safe & precise",
        eyebrow: "Verified",
        rationale: "Only supported facts.",
        confidence: 0.94,
        accent: "sage",
        fields: {},
        sources: [],
      },
      {
        id: "balanced",
        label: "Balanced",
        eyebrow: "Best overall",
        rationale: "Clear, warm, and grounded.",
        confidence: 0.88,
        accent: "violet",
        fields: {},
        sources: [],
      },
      {
        id: "standout",
        label: "Standout",
        eyebrow: "Memorable",
        rationale: "A stronger voice without invention.",
        confidence: 0.8,
        accent: "coral",
        fields: {},
        sources: [],
      },
    ],
    selectedStrategyId: "balanced",
    status: "ready",
  };
}

function runtime(session: ConnectorSession): SidePanelRuntime & {
  sendMessage: ReturnType<typeof vi.fn>;
} {
  const sendMessage = vi.fn(async (message: ConnectorMessage) => ({
    ok: true,
    result: message.type === "GET_SESSION" ? session : session,
  }));
  return {
    addMessageListener() {
      return () => undefined;
    },
    sendMessage,
  };
}

describe("global Mochi side panel", () => {
  it("offers repeated viewport and region capture across all three missions", async () => {
    const user = userEvent.setup();
    const panelRuntime = runtime(createEmptySession());
    render(<App runtime={panelRuntime} />);

    expect(await screen.findByText("0 / 8")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /capture page/i }));
    await user.click(screen.getByRole("button", { name: /snip area/i }));
    await user.click(screen.getByRole("radio", { name: /sales lead/i }));

    expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
      type: "CAPTURE_VIEWPORT",
    });
    expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
      type: "START_SNIP",
    });
    expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
      type: "SET_PRESET",
      preset: "lead",
    });
  });

  it("shows shared captures, three strategies, and safe execution modes", async () => {
    const user = userEvent.setup();
    const panelRuntime = runtime(readySession());
    render(<App runtime={panelRuntime} />);

    expect(await screen.findByText("2 / 8")).toBeInTheDocument();
    expect(screen.getByText("My profile")).toBeInTheDocument();
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getAllByTestId("connector-strategy")).toHaveLength(3);
    expect(
      screen.getByRole("radio", { name: /review first/i }),
    ).toBeChecked();

    await user.click(screen.getByRole("radio", { name: /fill only/i }));
    await user.click(
      screen.getByRole("button", { name: /execute with balanced/i }),
    );

    expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
      type: "SET_MODE",
      mode: "fill",
    });
    expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
      type: "EXECUTE",
    });
  });

  it("can remove, clear, and analyze accumulated captures", async () => {
    const user = userEvent.setup();
    const panelRuntime = runtime(readySession());
    render(<App runtime={panelRuntime} />);

    await screen.findByText("2 / 8");
    await user.click(
      screen.getByRole("button", { name: /remove my profile/i }),
    );
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    await user.click(screen.getByRole("button", { name: /analyze context/i }));

    await waitFor(() => {
      expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
        type: "REMOVE_CAPTURE",
        captureId: "capture-1",
      });
      expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
        type: "CLEAR_SESSION",
      });
      expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
        type: "ANALYZE",
      });
    });
  });
});
