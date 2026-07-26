import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBackgroundCoordinator } from "./background";
import { createEmptySession } from "./shared/session";
import type { ChromeAdapter } from "./shared/chrome";
import type { ConnectorSession } from "./shared/protocol";

function adapter(): ChromeAdapter {
  let stored = createEmptySession();
  return {
    broadcast: vi.fn(),
    captureVisibleTab: vi
      .fn()
      .mockResolvedValue("data:image/jpeg;base64,Y2FwdHVyZQ=="),
    executeAgent: vi.fn(),
    getSession: vi.fn(async () => stored),
    openPanel: vi.fn(),
    queryActiveTab: vi.fn().mockResolvedValue({
      id: 7,
      windowId: 3,
      url: "https://forms.example.test/apply",
      title: "Application",
    }),
    sendTabMessage: vi.fn(async (_tabId, message) => {
      if (message.type === "DISCOVER_FIELDS") {
        return {
          fields: [
            {
              key: "name",
              label: "Full name",
              type: "text",
              required: true,
            },
          ],
        };
      }
      return { ok: true };
    }),
    setSession: vi.fn(async (session) => {
      stored = session;
    }),
  };
}

describe("background coordinator", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("opens the side panel for the active tab", async () => {
    const chromeAdapter = adapter();
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await coordinator.handle({ type: "OPEN_PANEL" });

    expect(chromeAdapter.openPanel).toHaveBeenCalledWith(3);
  });

  it("hides and always restores the pet around a visible-tab capture", async () => {
    const chromeAdapter = adapter();
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await coordinator.handle({ type: "CAPTURE_VIEWPORT" });

    expect(chromeAdapter.sendTabMessage).toHaveBeenNthCalledWith(
      1,
      7,
      { type: "HIDE_PET" },
    );
    expect(chromeAdapter.captureVisibleTab).toHaveBeenCalledWith(3);
    expect(chromeAdapter.sendTabMessage).toHaveBeenNthCalledWith(
      2,
      7,
      { type: "SHOW_PET" },
    );
    expect((await chromeAdapter.getSession()).captures[0]).toMatchObject({
      sourceUrl: "https://forms.example.test/apply",
      sourceTitle: "Application",
      kind: "viewport",
    });
  });

  it("restores the pet even when Chrome capture fails", async () => {
    const chromeAdapter = adapter();
    vi.mocked(chromeAdapter.captureVisibleTab).mockRejectedValue(
      new Error("Chrome refused capture"),
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(
      coordinator.handle({ type: "CAPTURE_VIEWPORT" }),
    ).rejects.toThrow("Chrome refused capture");
    expect(chromeAdapter.sendTabMessage).toHaveBeenLastCalledWith(
      7,
      { type: "SHOW_PET" },
    );
  });

  it("freezes one captured frame, crops it in-page, and stores a region", async () => {
    const chromeAdapter = adapter();
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "BEGIN_FROZEN_SNIP") {
          return {
            dataUrl: "data:image/jpeg;base64,Y3JvcA==",
            rect: { x: 20, y: 30, width: 400, height: 220 },
          };
        }
        return { ok: true };
      },
    );
    const normalizeImage = vi.fn(async (dataUrl) => dataUrl);
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage,
    });

    await coordinator.handle({ type: "START_SNIP" });

    expect(chromeAdapter.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(chromeAdapter.sendTabMessage).toHaveBeenNthCalledWith(
      3,
      7,
      {
        type: "BEGIN_FROZEN_SNIP",
        dataUrl: "data:image/jpeg;base64,Y2FwdHVyZQ==",
      },
    );
    expect(normalizeImage).toHaveBeenCalledWith(
      "data:image/jpeg;base64,Y3JvcA==",
    );
    expect((await chromeAdapter.getSession()).captures[0]).toMatchObject({
      kind: "region",
    });
  });

  it("posts analysis and Page Agent calls only to fixed Vercel routes", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession({
      ...createEmptySession(),
      captures: [
        {
          id: "capture-1",
          dataUrl: "data:image/jpeg;base64,Y2FwdHVyZQ==",
          sourceUrl: "https://forms.example.test/apply",
          sourceTitle: "Application",
          capturedAt: "2026-07-26T12:00:00.000Z",
          kind: "viewport",
        },
      ],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            strategies: [
              {
                id: "safe",
                label: "Safe & precise",
                eyebrow: "Facts",
                rationale: "Use verified facts.",
                confidence: 0.9,
                accent: "sage",
                fields: {},
                sources: [],
              },
              {
                id: "balanced",
                label: "Balanced",
                eyebrow: "Best fit",
                rationale: "Balance confidence and care.",
                confidence: 0.86,
                accent: "violet",
                fields: {},
                sources: [],
              },
              {
                id: "standout",
                label: "Standout",
                eyebrow: "Voice",
                rationale: "Use a memorable tone.",
                confidence: 0.8,
                accent: "coral",
                fields: {},
                sources: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('{"choices":[]}', { status: 200 }),
      );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: fetchMock,
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await coordinator.handle({ type: "ANALYZE" });
    await coordinator.handle({
      type: "FETCH_PAGE_AGENT",
      body: '{"messages":[]}',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://mochi-overlay.vercel.app/api/analyze",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://mochi-overlay.vercel.app/api/page-agent/chat/completions",
    );
  });

  it("injects Alibaba Page Agent and enforces the autopilot countdown", async () => {
    const chromeAdapter = adapter();
    const analyzed: ConnectorSession = {
      ...createEmptySession(),
      executionMode: "autopilot" as const,
      strategies: [
        {
          id: "safe" as const,
          label: "Safe & precise" as const,
          eyebrow: "Facts",
          rationale: "Use facts.",
          confidence: 0.9,
          accent: "sage" as const,
          fields: {},
          sources: [],
        },
        {
          id: "balanced" as const,
          label: "Balanced" as const,
          eyebrow: "Best fit",
          rationale: "Use grounded confidence.",
          confidence: 0.88,
          accent: "violet" as const,
          fields: {
            name: {
              value: "Jamie Chen",
              status: "supported" as const,
              confidence: 1,
              sourceIds: [],
            },
          },
          sources: [],
        },
        {
          id: "standout" as const,
          label: "Standout" as const,
          eyebrow: "Voice",
          rationale: "Use stronger voice.",
          confidence: 0.8,
          accent: "coral" as const,
          fields: {},
          sources: [],
        },
      ],
      selectedStrategyId: "balanced" as const,
      status: "ready" as const,
    };
    await chromeAdapter.setSession(analyzed);
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "RUN_PAGE_AGENT") {
          return {
            status: "submitted",
            adapter: "page-agent",
            values: { name: "Jamie Chen" },
            changedFields: 1,
          };
        }
        return { ok: true };
      },
    );
    const delay = vi.fn().mockResolvedValue(undefined);
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay,
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await coordinator.handle({ type: "EXECUTE" });

    expect(delay).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenNthCalledWith(1, 1_000);
    expect(chromeAdapter.executeAgent).toHaveBeenCalledWith(7);
    expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(7, {
      type: "RUN_PAGE_AGENT",
      strategy: analyzed.strategies[1],
      mode: "autopilot",
    });
    expect((await chromeAdapter.getSession()).lastExecution).toMatchObject({
      tabId: 7,
      changedFields: 1,
    });
    expect((await chromeAdapter.getSession()).executionCountdown).toBeNull();
  });
});
