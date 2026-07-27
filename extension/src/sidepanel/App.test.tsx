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
  ProviderStatus,
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
        fields: {
          name: {
            value: "Jamie Chen",
            status: "supported",
            confidence: 1,
            sourceIds: [],
          },
        },
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

const validProviderStatus: ProviderStatus = {
  configured: true,
  openAI: "valid",
  exa: "missing",
};

function runtime(
  session: ConnectorSession,
  status: ProviderStatus = validProviderStatus,
): SidePanelRuntime & {
  sendMessage: ReturnType<typeof vi.fn>;
} {
  const sendMessage = vi.fn(async (message: ConnectorMessage) => ({
    ok: true,
    result:
      message.type === "GET_PROVIDER_STATUS"
        ? status
        : session,
  }));
  return {
    addMessageListener() {
      return () => undefined;
    },
    sendMessage,
  };
}

describe("global Mochi side panel", () => {
  it("gates first use behind one required OpenAI key and optional Exa key", async () => {
    const panelRuntime = runtime(createEmptySession(), {
      configured: false,
      openAI: "missing",
      exa: "missing",
    });
    render(<App runtime={panelRuntime} />);

    expect(
      await screen.findByRole("heading", { name: /add your own key/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/openai api key/i),
    ).toHaveAttribute("type", "password");
    expect(
      screen.getByLabelText(/exa api key.*optional/i),
    ).toHaveAttribute("type", "password");
    expect(
      screen.queryByRole("button", { name: /capture page/i }),
    ).not.toBeInTheDocument();
  });

  it("saves keys once and unlocks when OpenAI validates", async () => {
    const user = userEvent.setup();
    const panelRuntime = runtime(createEmptySession(), {
      configured: false,
      openAI: "missing",
      exa: "missing",
    });
    panelRuntime.sendMessage.mockImplementation(
      async (message: ConnectorMessage) => ({
        ok: true,
        result:
          message.type === "GET_PROVIDER_STATUS"
            ? {
                configured: false,
                openAI: "missing",
                exa: "missing",
              }
            : message.type === "SAVE_AND_TEST_PROVIDER_SETTINGS"
              ? {
                  configured: true,
                  openAI: "valid",
                  exa: "missing",
                }
              : createEmptySession(),
      }),
    );
    render(<App runtime={panelRuntime} />);

    await user.type(
      await screen.findByLabelText(/openai api key/i),
      "sk-openai-test",
    );
    await user.click(
      screen.getByRole("button", { name: /save & test/i }),
    );

    expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
      type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
      openAIApiKey: "sk-openai-test",
    });
    expect(
      await screen.findByRole("button", { name: /capture page/i }),
    ).toBeVisible();
  });

  it("clears keys from Settings while preserving the capture session", async () => {
    const user = userEvent.setup();
    const session = readySession();
    const panelRuntime = runtime(session);
    panelRuntime.sendMessage.mockImplementation(
      async (message: ConnectorMessage) => ({
        ok: true,
        result:
          message.type === "GET_PROVIDER_STATUS"
            ? validProviderStatus
            : message.type === "CLEAR_PROVIDER_SETTINGS"
              ? {
                  configured: false,
                  openAI: "missing",
                  exa: "missing",
                }
              : session,
      }),
    );
    render(<App runtime={panelRuntime} />);

    await user.click(
      await screen.findByRole("button", {
        name: /provider settings/i,
      }),
    );
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === "OpenAI: connected",
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /clear keys/i }),
    );

    expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
      type: "CLEAR_PROVIDER_SETTINGS",
    });
    expect(
      await screen.findByRole("heading", { name: /add your own key/i }),
    ).toBeInTheDocument();
    expect(session.captures).toHaveLength(2);
  });

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
    const session = readySession();
    const panelRuntime = runtime(session);
    panelRuntime.sendMessage.mockImplementation(
      async (message: ConnectorMessage) => ({
        ok: true,
        result:
          message.type === "GET_PROVIDER_STATUS"
            ? validProviderStatus
            : message.type === "SET_MODE"
            ? { ...session, executionMode: message.mode }
            : session,
      }),
    );
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

  it("renders the exact field-value preview returned by Review mode", async () => {
    const user = userEvent.setup();
    const session = readySession();
    const panelRuntime = runtime(session);
    panelRuntime.sendMessage.mockImplementation(
      async (message: ConnectorMessage) => ({
        ok: true,
        result:
          message.type === "GET_PROVIDER_STATUS"
            ? validProviderStatus
            : message.type === "EXECUTE"
            ? {
                status: "preview",
                adapter: "page-agent",
                values: { name: "Jamie Chen" },
                changedFields: 0,
              }
            : session,
      }),
    );
    render(<App runtime={panelRuntime} />);

    await user.click(
      await screen.findByRole("button", { name: /preview balanced/i }),
    );

    expect(
      screen.getByLabelText("Proposed field values"),
    ).toHaveTextContent("name");
    expect(
      screen.getByLabelText("Proposed field values"),
    ).toHaveTextContent("Jamie Chen");
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

  it("surfaces Page Agent fallback as an explicit approval and keeps warnings visible", async () => {
    const user = userEvent.setup();
    const session = {
      ...readySession(),
      error:
        "Page Agent stopped without leaving partial changes. You can retry.",
      fallbackOffer: {
        tabId: 7,
        windowId: 3,
        tabUrl: "https://forms.example.test/apply",
        documentId: "document-original",
        fieldManifestKey: "[]",
        strategy: readySession().strategies[1]!,
        reason: "Provider offline",
      },
      lastExecution: {
        tabId: 7,
        windowId: 3,
        tabUrl: "https://forms.example.test/apply",
        documentId: "document-original",
        fieldManifestKey: "[]",
        changedFields: 1,
        completedAt: "2026-07-26T12:00:00.000Z",
        adapter: "exact-fallback" as const,
        status: "filled" as const,
        warning: "Exact fill never submitted the form.",
      },
    };
    const panelRuntime = runtime(session);
    render(<App runtime={panelRuntime} />);

    expect(
      await screen.findByText(/exact fill never submitted/i),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /approve safe exact fill/i }),
    );

    expect(panelRuntime.sendMessage).toHaveBeenCalledWith({
      type: "EXECUTE_EXACT_FALLBACK",
    });
  });

  it("does not imply that a completed web submission can be undone", async () => {
    const session: ConnectorSession = {
      ...readySession(),
      lastExecution: {
        tabId: 7,
        windowId: 3,
        tabUrl: "https://forms.example.test/apply",
        documentId: "document-original",
        fieldManifestKey: "[]",
        changedFields: 1,
        completedAt: "2026-07-26T12:00:00.000Z",
        adapter: "page-agent",
        status: "submitted",
      },
    };
    render(<App runtime={runtime(session)} />);

    expect(
      await screen.findByText(/web submission cannot be reversed/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /undo last fill/i }),
    ).not.toBeInTheDocument();
  });
});
