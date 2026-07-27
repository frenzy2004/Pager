import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_AGENT_TOOL_PARAMETERS } from "../../src/lib/mochi/page-agent-contract";
import {
  buildPageAgentTask,
  PAGE_AGENT_SYSTEM_INSTRUCTIONS,
} from "../../src/lib/mochi/page-agent-task";
import { createBackgroundCoordinator } from "./background";
import { createEmptySession } from "./shared/session";
import type { ChromeAdapter } from "./shared/chrome";
import type { ProviderSettings } from "./shared/provider-settings";
import type { ConnectorSession } from "./shared/protocol";

const extensionId = "fljecmlbnknpeehjcffenmjjnenmkjea";
const sidePanelSender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/sidepanel.html`,
};
const testPageAgentSystemPrompt =
  "Alibaba Page Agent 1.12.2 background test system prompt";
const testPageAgentSystemPromptSha256 = createHash("sha256")
  .update(testPageAgentSystemPrompt)
  .digest("hex");

function fieldManifest(documentId = "document-original") {
  return {
    documentId,
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

function adapter(): ChromeAdapter {
  let stored = createEmptySession();
  let providerSettings: ProviderSettings | null = null;
  return {
    broadcast: vi.fn(),
    captureVisibleTab: vi
      .fn()
      .mockResolvedValue("data:image/jpeg;base64,Y2FwdHVyZQ=="),
    clearProviderSettings: vi.fn(async () => {
      providerSettings = null;
    }),
    executeAgent: vi.fn(),
    getProviderSettings: vi.fn(async () => providerSettings),
    getSession: vi.fn(async () => stored),
    getTab: vi.fn().mockResolvedValue({
      id: 7,
      windowId: 3,
      url: "https://forms.example.test/apply",
      title: "Application",
    }),
    openPanel: vi.fn(),
    queryActiveTab: vi.fn().mockResolvedValue({
      id: 7,
      windowId: 3,
      url: "https://forms.example.test/apply",
      title: "Application",
    }),
    restrictLocalStorage: vi.fn(),
    sendTabMessage: vi.fn(async (_tabId, message) => {
      if (message.type === "DISCOVER_FIELDS") {
        return fieldManifest();
      }
      if (message.type === "CANCEL_EXECUTION") {
        return { status: "cancelled" };
      }
      return { ok: true };
    }),
    setProviderSettings: vi.fn(async (settings) => {
      providerSettings = settings;
    }),
    setSession: vi.fn(async (session) => {
      stored = session;
    }),
    setSubmissionGuard: vi.fn().mockResolvedValue(undefined),
  };
}

function analyzedSession(
  executionMode: ConnectorSession["executionMode"] = "fill",
): ConnectorSession {
  return {
    ...createEmptySession(),
    executionMode,
    strategies: [
      {
        id: "safe",
        label: "Safe & precise",
        eyebrow: "Facts",
        rationale: "Use facts.",
        confidence: 0.9,
        accent: "sage",
        fields: {},
        sources: [],
      },
      {
        id: "balanced",
        label: "Balanced",
        eyebrow: "Best fit",
        rationale: "Use grounded confidence.",
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
        eyebrow: "Voice",
        rationale: "Use stronger voice.",
        confidence: 0.8,
        accent: "coral",
        fields: {},
        sources: [],
      },
    ],
    selectedStrategyId: "balanced",
    analysisTarget: {
      tabId: 7,
      windowId: 3,
      tabUrl: "https://forms.example.test/apply",
      documentId: "document-original",
      fieldManifestKey: JSON.stringify(fieldManifest().fields),
    },
    status: "ready",
  };
}

function providerAnalysisResponse() {
  return Response.json({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              pageSummary: "A one-field application.",
              gaps: [],
              researchQuery: null,
              strategies: [
                {
                  id: "safe",
                  label: "Safe & precise",
                  eyebrow: "Facts",
                  rationale: "Use verified facts.",
                  confidence: 0.9,
                  accent: "sage",
                  fields: [
                    {
                      key: "name",
                      value: "Jamie Chen",
                      status: "supported",
                      confidence: 1,
                      sourceIds: [],
                    },
                  ],
                },
                {
                  id: "balanced",
                  label: "Balanced",
                  eyebrow: "Best fit",
                  rationale: "Balance confidence and care.",
                  confidence: 0.86,
                  accent: "violet",
                  fields: [
                    {
                      key: "name",
                      value: "Jamie Chen",
                      status: "supported",
                      confidence: 1,
                      sourceIds: [],
                    },
                  ],
                },
                {
                  id: "standout",
                  label: "Standout",
                  eyebrow: "Voice",
                  rationale: "Use a memorable tone.",
                  confidence: 0.8,
                  accent: "coral",
                  fields: [
                    {
                      key: "name",
                      value: "Jamie Chen",
                      status: "supported",
                      confidence: 1,
                      sourceIds: [],
                    },
                  ],
                },
              ],
            }),
          },
        ],
      },
    ],
  });
}

async function configureOpenAI(chromeAdapter: ChromeAdapter) {
  await chromeAdapter.setProviderSettings({
    version: 1,
    openAIApiKey: "sk-openai-secret",
    openAIValidation: {
      status: "valid",
      checkedAt: "2026-07-27T04:00:00.000Z",
    },
  });
}

function validPageAgentBody() {
  const task = buildPageAgentTask(
    { fields: { name: { value: "Jamie Chen" } } },
    "fill",
  );
  const userPrompt = [
    "<instructions>",
    "<system_instructions>",
    PAGE_AGENT_SYSTEM_INSTRUCTIONS,
    "</system_instructions>",
    "</instructions>",
    "",
    "<agent_state>",
    "<user_request>",
    task,
    "</user_request>",
    "<step_info>",
    "Step 1 of 16 max possible steps",
    "Current time: 7/27/2026, 12:00:00 PM",
    "</step_info>",
    "</agent_state>",
    "",
    "<agent_history>",
    "</agent_history>",
    "",
    "<browser_state>",
    "Current Page: [Application](https://forms.example.test/apply)",
    "[1]<input name=name />",
    "</browser_state>",
    "",
    "",
  ].join("\n");
  return JSON.stringify({
    model: "client-model",
    messages: [
      { role: "system", content: testPageAgentSystemPrompt },
      { role: "user", content: userPrompt },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "AgentOutput",
          description: "You MUST call this tool every step!",
          parameters: PAGE_AGENT_TOOL_PARAMETERS,
        },
      },
    ],
    tool_choice: {
      type: "function",
      function: { name: "AgentOutput" },
    },
  });
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

  it("bounds hostile page metadata before persisting a capture", async () => {
    const chromeAdapter = adapter();
    vi.mocked(chromeAdapter.queryActiveTab).mockResolvedValue({
      id: 7,
      windowId: 3,
      url: `https://forms.example.test/apply?payload=${"x".repeat(4_000)}`,
      title: "T".repeat(2_000),
    });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await coordinator.handle({ type: "CAPTURE_VIEWPORT" });

    const capture = (await chromeAdapter.getSession()).captures[0]!;
    expect(capture.sourceUrl.length).toBeLessThanOrEqual(2_048);
    expect(capture.sourceUrl).toMatch(/^https:\/\/forms\.example\.test\//);
    expect(capture.sourceTitle).toHaveLength(300);
  });

  it("queues rapid captures below Chrome's two-per-second quota", async () => {
    const chromeAdapter = adapter();
    let clock = Date.parse("2026-07-26T12:00:00.000Z");
    const captureTimes: number[] = [];
    vi.mocked(chromeAdapter.captureVisibleTab).mockImplementation(async () => {
      captureTimes.push(clock);
      return "data:image/jpeg;base64,Y2FwdHVyZQ==";
    });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn(async (milliseconds: number) => {
        clock += milliseconds;
      }),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
      now: () => new Date(clock),
    });

    await coordinator.handle({ type: "CAPTURE_VIEWPORT" });
    await coordinator.handle({ type: "CAPTURE_VIEWPORT" });
    await coordinator.handle({ type: "CAPTURE_VIEWPORT" });

    expect(captureTimes).toHaveLength(3);
    expect(captureTimes[1] - captureTimes[0]).toBeGreaterThanOrEqual(500);
    expect(captureTimes[2] - captureTimes[1]).toBeGreaterThanOrEqual(500);
  });

  it("rejects a ninth capture without evicting existing context", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession({
      ...createEmptySession(),
      captures: Array.from({ length: 8 }, (_, index) => ({
        id: `capture-${index}`,
        dataUrl: "data:image/jpeg;base64,Y2FwdHVyZQ==",
        sourceUrl: `https://example.test/${index}`,
        sourceTitle: `Context ${index + 1}`,
        capturedAt: "2026-07-26T12:00:00.000Z",
        kind: "viewport" as const,
      })),
    });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(
      coordinator.handle({ type: "CAPTURE_VIEWPORT" }),
    ).rejects.toThrow("Remove one");

    expect(chromeAdapter.captureVisibleTab).not.toHaveBeenCalled();
    expect((await chromeAdapter.getSession()).captures).toHaveLength(8);
  });

  it("serializes concurrent eighth captures and rejects the loser", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession({
      ...createEmptySession(),
      captures: Array.from({ length: 7 }, (_, index) => ({
        id: `capture-${index}`,
        dataUrl: "data:image/jpeg;base64,Y2FwdHVyZQ==",
        sourceUrl: `https://example.test/${index}`,
        sourceTitle: `Context ${index + 1}`,
        capturedAt: "2026-07-26T12:00:00.000Z",
        kind: "viewport" as const,
      })),
    });
    let releaseCapture: (() => void) | undefined;
    vi.mocked(chromeAdapter.captureVisibleTab).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseCapture = () =>
            resolve("data:image/jpeg;base64,Y2FwdHVyZQ==");
        }),
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const first = coordinator.handle({ type: "CAPTURE_VIEWPORT" });
    const second = coordinator.handle({ type: "CAPTURE_VIEWPORT" });
    await vi.waitFor(() =>
      expect(chromeAdapter.captureVisibleTab).toHaveBeenCalledOnce(),
    );
    releaseCapture?.();

    await expect(first).resolves.toBeDefined();
    await expect(second).rejects.toThrow("Remove one");
    expect((await chromeAdapter.getSession()).captures).toHaveLength(8);
    expect(chromeAdapter.captureVisibleTab).toHaveBeenCalledOnce();
  });

  it("aborts a queued capture if the user switches tabs before Chrome captures", async () => {
    const chromeAdapter = adapter();
    let releaseDelay: (() => void) | undefined;
    const delay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseDelay = resolve;
        }),
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay,
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const pending = coordinator.handle({ type: "CAPTURE_VIEWPORT" });
    await vi.waitFor(() => expect(delay).toHaveBeenCalled());
    vi.mocked(chromeAdapter.queryActiveTab).mockResolvedValue({
      id: 9,
      windowId: 3,
      url: "https://other.example.test/",
      title: "Other",
    });
    releaseDelay?.();

    await expect(pending).rejects.toThrow("tab changed");
    expect(chromeAdapter.captureVisibleTab).not.toHaveBeenCalled();
    expect(chromeAdapter.sendTabMessage).toHaveBeenLastCalledWith(7, {
      type: "SHOW_PET",
    });
  });

  it("discards a capture if the tab changes while Chrome is capturing", async () => {
    const chromeAdapter = adapter();
    vi.mocked(chromeAdapter.queryActiveTab)
      .mockResolvedValueOnce({
        id: 7,
        windowId: 3,
        url: "https://forms.example.test/apply",
        title: "Application",
      })
      .mockResolvedValueOnce({
        id: 7,
        windowId: 3,
        url: "https://forms.example.test/apply",
        title: "Application",
      })
      .mockResolvedValue({
        id: 9,
        windowId: 3,
        url: "https://other.example.test/",
        title: "Other",
      });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(
      coordinator.handle({ type: "CAPTURE_VIEWPORT" }),
    ).rejects.toThrow("discarded");

    expect((await chromeAdapter.getSession()).captures).toHaveLength(0);
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

  it("does not resurrect a region capture after Clear cancels its snip", async () => {
    const chromeAdapter = adapter();
    let finishSnip:
      | ((value: { dataUrl: string }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "BEGIN_FROZEN_SNIP") {
          return new Promise((resolve) => {
            finishSnip = resolve;
          });
        }
        if (message.type === "CANCEL_SNIP") {
          return { status: "cancelled" };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const pendingCapture = coordinator.handle({ type: "START_SNIP" });
    await vi.waitFor(async () => {
      expect((await chromeAdapter.getSession()).captureLease).toMatchObject({
        kind: "region",
      });
    });
    await coordinator.handle({ type: "CLEAR_SESSION" });
    finishSnip?.({ dataUrl: "data:image/jpeg;base64,Y3JvcA==" });
    await pendingCapture;

    expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(7, {
      type: "CANCEL_SNIP",
    });
    expect(await chromeAdapter.getSession()).toEqual(createEmptySession());
  });

  it("does not let capture preflight overtake Clear", async () => {
    const chromeAdapter = adapter();
    const baseGetSession = vi
      .mocked(chromeAdapter.getSession)
      .getMockImplementation()!;
    let releasePreflight: (() => void) | undefined;
    let getSessionCalls = 0;
    vi.mocked(chromeAdapter.getSession).mockImplementation(async () => {
      getSessionCalls += 1;
      if (getSessionCalls === 1) {
        await new Promise<void>((resolve) => {
          releasePreflight = resolve;
        });
      }
      return baseGetSession();
    });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const capture = coordinator.handle({ type: "CAPTURE_VIEWPORT" });
    await vi.waitFor(() => expect(getSessionCalls).toBe(1));
    await coordinator.handle({ type: "CLEAR_SESSION" });
    releasePreflight?.();
    await capture;

    expect(chromeAdapter.captureVisibleTab).not.toHaveBeenCalled();
    expect(await chromeAdapter.getSession()).toEqual(createEmptySession());
  });

  it("reports provider status without returning raw settings", async () => {
    const chromeAdapter = adapter();
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    expect(
      await coordinator.handle(
        { type: "GET_PROVIDER_STATUS" },
        sidePanelSender,
      ),
    ).toEqual({
      configured: false,
      openAI: "missing",
      exa: "missing",
    });
  });

  it("accepts credential changes only from an extension view", async () => {
    const chromeAdapter = adapter();
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(
      coordinator.handle(
        {
          type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
          openAIApiKey: "sk-openai-secret",
        },
        {
          id: extensionId,
          url: "https://forms.example.test/apply",
        },
      ),
    ).rejects.toThrow(
      "Mochi settings can only be changed from the extension.",
    );
    expect(await chromeAdapter.getProviderSettings()).toBeNull();
  });

  it("saves valid OpenAI while treating invalid optional Exa as non-blocking", async () => {
    const chromeAdapter = adapter();
    const fetchMock = vi.fn(async (input: string) =>
      input.includes("api.exa.ai")
        ? new Response("invalid", { status: 401 })
        : new Response("{}", { status: 200 }),
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: fetchMock,
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
      now: () => new Date("2026-07-27T04:00:00.000Z"),
    });

    const status = await coordinator.handle(
      {
        type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
        openAIApiKey: "sk-openai-secret",
        exaApiKey: "exa-secret-key",
      },
      sidePanelSender,
    );

    expect(status).toEqual({
      configured: true,
      openAI: "valid",
      exa: "invalid",
    });
    expect(await chromeAdapter.getProviderSettings()).toMatchObject({
      openAIApiKey: "sk-openai-secret",
      openAIValidation: {
        status: "valid",
        checkedAt: "2026-07-27T04:00:00.000Z",
      },
      exaValidation: {
        status: "invalid",
        checkedAt: "2026-07-27T04:00:00.000Z",
      },
    });
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("clears provider keys without deleting captured context", async () => {
    const chromeAdapter = adapter();
    await configureOpenAI(chromeAdapter);
    await chromeAdapter.setSession({
      ...createEmptySession(),
      captures: [
        {
          id: "capture-1",
          dataUrl: "data:image/jpeg;base64,Y2FwdHVyZQ==",
          sourceUrl: "https://forms.example.test/apply",
          sourceTitle: "Application",
          capturedAt: "2026-07-27T04:00:00.000Z",
          kind: "viewport",
        },
      ],
    });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    expect(
      await coordinator.handle(
        { type: "CLEAR_PROVIDER_SETTINGS" },
        sidePanelSender,
      ),
    ).toEqual({
      configured: false,
      openAI: "missing",
      exa: "missing",
    });
    expect(await chromeAdapter.getProviderSettings()).toBeNull();
    expect((await chromeAdapter.getSession()).captures).toHaveLength(1);
  });

  it("posts extension analysis directly to OpenAI and never to Vercel", async () => {
    const chromeAdapter = adapter();
    await configureOpenAI(chromeAdapter);
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
    const fetchMock = vi.fn(
      async (input: string, init?: RequestInit) => {
        void input;
        void init;
        return providerAnalysisResponse();
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: fetchMock,
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await coordinator.handle({ type: "ANALYZE" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("mochi-overlay.vercel.app"),
      ),
    ).toBe(false);
    expect((await chromeAdapter.getSession()).strategies).toHaveLength(3);
  });

  it("sends validated Page Agent steps directly to OpenAI", async () => {
    const chromeAdapter = adapter();
    await configureOpenAI(chromeAdapter);
    await chromeAdapter.setSession(analyzedSession("fill"));
    const fetchMock = vi.fn(
      async (input: string, init?: RequestInit) => {
        void input;
        void init;
        return new Response('{"choices":[]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    let coordinator: ReturnType<typeof createBackgroundCoordinator>;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest();
        }
        if (message.type === "RUN_PAGE_AGENT") {
          await coordinator.handle({
            type: "FETCH_PAGE_AGENT",
            body: validPageAgentBody(),
            executionId: message.executionId,
          });
          return {
            status: "filled",
            adapter: "page-agent",
            values: { name: "Jamie Chen" },
            changedFields: 1,
          };
        }
        return { ok: true };
      },
    );
    coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: fetchMock,
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
      pageAgentSystemPromptSha256: testPageAgentSystemPromptSha256,
    });

    await coordinator.handle({ type: "EXECUTE" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        authorization: "Bearer sk-openai-secret",
        "content-type": "application/json",
      },
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("mochi-overlay.vercel.app"),
      ),
    ).toBe(false);
  });

  it("rejects a duplicate analysis without cancelling the in-flight result", async () => {
    const chromeAdapter = adapter();
    await configureOpenAI(chromeAdapter);
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
    let releaseAnalysis: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async () => {
      return new Promise<Response>((resolve) => {
        releaseAnalysis = resolve;
      });
    });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: fetchMock,
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const first = coordinator.handle({ type: "ANALYZE" });
    await vi.waitFor(async () => {
      expect((await chromeAdapter.getSession()).status).toBe("analyzing");
    });
    await expect(
      coordinator.handle({ type: "ANALYZE" }),
    ).rejects.toThrow("already analyzing");
    expect((await chromeAdapter.getSession()).status).toBe("analyzing");

    releaseAnalysis?.(providerAnalysisResponse());
    await first;
    expect((await chromeAdapter.getSession()).status).toBe("ready");
    expect((await chromeAdapter.getSession()).strategies).toHaveLength(3);
  });

  it("injects Alibaba Page Agent and enforces the autopilot countdown", async () => {
    const chromeAdapter = adapter();
    const analyzed = analyzedSession("autopilot");
    await chromeAdapter.setSession(analyzed);
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest();
        }
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
    expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: "RUN_PAGE_AGENT",
        strategy: analyzed.strategies[1],
        mode: "autopilot",
        executionId: expect.any(String),
      }),
    );
    expect((await chromeAdapter.getSession()).lastExecution).toMatchObject({
      tabId: 7,
      changedFields: 1,
    });
    expect((await chromeAdapter.getSession()).executionCountdown).toBeNull();
  });

  it("allows only one execution operation to claim the analyzed form", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("fill"));
    let finish:
      | ((value: {
          status: "filled";
          adapter: "page-agent";
          values: Record<string, string>;
          changedFields: number;
        }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") return fieldManifest();
        if (message.type === "RUN_PAGE_AGENT") {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const first = coordinator.handle({ type: "EXECUTE" });
    const second = coordinator.handle({ type: "EXECUTE" });

    await expect(second).rejects.toThrow("already executing");
    await vi.waitFor(() =>
      expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "RUN_PAGE_AGENT" }),
      ),
    );
    finish?.({
      status: "filled",
      adapter: "page-agent",
      values: { name: "Jamie Chen" },
      changedFields: 1,
    });
    await first;

    expect(chromeAdapter.executeAgent).toHaveBeenCalledOnce();
    expect(
      vi.mocked(chromeAdapter.sendTabMessage).mock.calls.filter(
        ([, message]) => message.type === "RUN_PAGE_AGENT",
      ),
    ).toHaveLength(1);
  });

  it("lets Clear invalidate an execution still discovering its target", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("fill"));
    let releaseDiscovery:
      | ((value: ReturnType<typeof fieldManifest>) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return new Promise((resolve) => {
            releaseDiscovery = resolve;
          });
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const executing = coordinator.handle({ type: "EXECUTE" });
    await vi.waitFor(() =>
      expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(7, {
        type: "DISCOVER_FIELDS",
      }),
    );
    const clearing = coordinator.handle({ type: "CLEAR_SESSION" });
    releaseDiscovery?.(fieldManifest());

    await expect(executing).rejects.toThrow("shared context changed");
    await expect(clearing).resolves.toEqual(createEmptySession());
    expect(chromeAdapter.executeAgent).not.toHaveBeenCalled();
    expect(await chromeAdapter.getSession()).toEqual(createEmptySession());
  });

  it("binds execution to its original tab and aborts after a tab switch", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("autopilot"));
    let delays = 0;
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn(async () => {
        delays += 1;
        if (delays === 1) {
          vi.mocked(chromeAdapter.queryActiveTab).mockResolvedValue({
            id: 9,
            windowId: 3,
            url: "https://other.example.test/",
            title: "Other",
          });
        }
      }),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(coordinator.handle({ type: "EXECUTE" })).rejects.toThrow(
      "tab changed",
    );
    expect(chromeAdapter.executeAgent).not.toHaveBeenCalled();
  });

  it("refuses to run an analyzed strategy on a different active form", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("fill"));
    vi.mocked(chromeAdapter.queryActiveTab).mockResolvedValue({
      id: 9,
      windowId: 3,
      url: "https://other.example.test/apply",
      title: "Other application",
    });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(coordinator.handle({ type: "EXECUTE" })).rejects.toThrow(
      "exact form",
    );
    expect(chromeAdapter.executeAgent).not.toHaveBeenCalled();
  });

  it("rechecks document identity after injection before sending a strategy", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("fill"));
    let documentId = "document-original";
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest(documentId);
        }
        if (message.type === "RUN_PAGE_AGENT") {
          return {
            status: "filled",
            adapter: "page-agent",
            changedFields: 1,
          };
        }
        return { ok: true };
      },
    );
    vi.mocked(chromeAdapter.executeAgent).mockImplementation(async () => {
      documentId = "document-reloaded";
    });
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(coordinator.handle({ type: "EXECUTE" })).rejects.toThrow(
      "form changed",
    );
    expect(chromeAdapter.sendTabMessage).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "RUN_PAGE_AGENT" }),
    );
  });

  it("sends cancellation to the tab where execution began", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("fill"));
    let finish:
      | ((value: {
          status: "cancelled";
          values: Record<string, string>;
          changedFields: number;
        }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest();
        }
        if (message.type === "RUN_PAGE_AGENT") {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        if (message.type === "CANCEL_EXECUTION") {
          return { status: "cancelled" };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const executing = coordinator.handle({ type: "EXECUTE" });
    await vi.waitFor(() =>
      expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "RUN_PAGE_AGENT" }),
      ),
    );
    vi.mocked(chromeAdapter.queryActiveTab).mockResolvedValue({
      id: 9,
      windowId: 3,
      url: "https://other.example.test/",
      title: "Other",
    });
    await coordinator.handle({ type: "CANCEL_EXECUTION" });
    finish?.({ status: "cancelled", values: {}, changedFields: 0 });
    await executing;

    expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(7, {
      type: "CANCEL_EXECUTION",
    });
    expect(chromeAdapter.sendTabMessage).not.toHaveBeenCalledWith(9, {
      type: "CANCEL_EXECUTION",
    });
  });

  it("does not report ready when Page Agent cancellation is unconfirmed", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("fill"));
    let finish:
      | ((value: {
          status: "cancelled";
          values: Record<string, string>;
          changedFields: number;
        }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest();
        }
        if (message.type === "RUN_PAGE_AGENT") {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        if (message.type === "CANCEL_EXECUTION") {
          return { error: "Page Agent stop failed" };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const executing = coordinator.handle({ type: "EXECUTE" });
    await vi.waitFor(() =>
      expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "RUN_PAGE_AGENT" }),
      ),
    );
    await expect(
      coordinator.handle({ type: "CANCEL_EXECUTION" }),
    ).rejects.toThrow("stop failed");
    expect(await chromeAdapter.getSession()).toMatchObject({
      status: "error",
      error: "Page Agent stop failed",
      executionLease: expect.objectContaining({ tabId: 7 }),
    });

    finish?.({ status: "cancelled", values: {}, changedFields: 0 });
    await executing;
  });

  it("blocks shared mutations during a run and makes Clear cancel first", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("fill"));
    let finish:
      | ((value: {
          status: "cancelled";
          values: Record<string, string>;
          changedFields: number;
        }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest();
        }
        if (message.type === "RUN_PAGE_AGENT") {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        if (message.type === "CANCEL_EXECUTION") {
          return { status: "cancelled" };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const executing = coordinator.handle({ type: "EXECUTE" });
    await vi.waitFor(async () => {
      expect((await chromeAdapter.getSession()).status).toBe("executing");
    });
    await expect(
      coordinator.handle({ type: "SET_MODE", mode: "review" }),
    ).rejects.toThrow("Cancel or finish");
    await coordinator.handle({ type: "CLEAR_SESSION" });
    expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(7, {
      type: "CANCEL_EXECUTION",
    });
    expect(await chromeAdapter.getSession()).toEqual(createEmptySession());

    finish?.({ status: "cancelled", values: {}, changedFields: 0 });
    await executing;
  });

  it("rejects stale proxy steps after an MV3 worker restart", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession({
      ...analyzedSession("fill"),
      status: "executing",
      executionLease: {
        executionId: "execution-stale",
        tabId: 7,
        windowId: 3,
        tabUrl: "https://forms.example.test/apply",
        documentId: "document-original",
        agentStarted: true,
      },
    });
    const restartedCoordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(
      restartedCoordinator.handle({
        type: "FETCH_PAGE_AGENT",
        body: '{"messages":[]}',
        executionId: "execution-stale",
      }),
    ).rejects.toThrow("no longer active");
  });

  it("clears a persisted execution lease after its original tab is gone", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession({
      ...analyzedSession("fill"),
      status: "executing",
      executionLease: {
        executionId: "execution-stale",
        tabId: 7,
        windowId: 3,
        tabUrl: "https://forms.example.test/apply",
        documentId: "document-original",
        agentStarted: true,
      },
    });
    vi.mocked(chromeAdapter.sendTabMessage).mockRejectedValue(
      new Error("No tab with id: 7"),
    );
    vi.mocked(chromeAdapter.getTab).mockResolvedValue(null);
    const restartedCoordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(
      restartedCoordinator.handle({ type: "CLEAR_SESSION" }),
    ).resolves.toEqual(createEmptySession());
    expect(await chromeAdapter.getSession()).toEqual(createEmptySession());
  });

  it("clears a persisted lease after a same-URL document reload", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession({
      ...analyzedSession("fill"),
      status: "executing",
      executionLease: {
        executionId: "execution-stale",
        tabId: 7,
        windowId: 3,
        tabUrl: "https://forms.example.test/apply",
        documentId: "document-original",
        agentStarted: true,
      },
    });
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest("document-reloaded");
        }
        return undefined;
      },
    );
    const restartedCoordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(
      restartedCoordinator.handle({ type: "CLEAR_SESSION" }),
    ).resolves.toEqual(createEmptySession());
    expect(await chromeAdapter.getSession()).toEqual(createEmptySession());
  });

  it("requires an explicit user action before using the exact-map fallback", async () => {
    const chromeAdapter = adapter();
    const analyzed = analyzedSession("fill");
    await chromeAdapter.setSession(analyzed);
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest();
        }
        if (message.type === "RUN_PAGE_AGENT") {
          return { error: "Provider offline" };
        }
        if (message.type === "RUN_EXACT_FALLBACK") {
          return {
            status: "filled",
            adapter: "exact-fallback",
            values: { name: "Jamie Chen" },
            changedFields: 1,
            warning: "User approved exact fill.",
          };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    await expect(coordinator.handle({ type: "EXECUTE" })).rejects.toThrow(
      "Provider offline",
    );
    expect((await chromeAdapter.getSession()).fallbackOffer).toMatchObject({
      tabId: 7,
      tabUrl: "https://forms.example.test/apply",
      strategy: analyzed.strategies[1],
    });
    expect(chromeAdapter.sendTabMessage).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "RUN_EXACT_FALLBACK" }),
    );

    await coordinator.handle({ type: "EXECUTE_EXACT_FALLBACK" });

    expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: "RUN_EXACT_FALLBACK",
        strategy: analyzed.strategies[1],
        executionId: expect.any(String),
      }),
    );
    expect((await chromeAdapter.getSession()).lastExecution).toMatchObject({
      adapter: "exact-fallback",
      changedFields: 1,
    });
  });

  it("never records exact fallback success after cancellation", async () => {
    const chromeAdapter = adapter();
    const analyzed = analyzedSession("fill");
    await chromeAdapter.setSession({
      ...analyzed,
      fallbackOffer: {
        ...analyzed.analysisTarget!,
        strategy: analyzed.strategies[1]!,
        reason: "Page Agent stopped.",
      },
    });
    let finish:
      | ((value: {
          status: "filled";
          adapter: "exact-fallback";
          changedFields: number;
        }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") return fieldManifest();
        if (message.type === "RUN_EXACT_FALLBACK") {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        if (message.type === "CANCEL_EXECUTION") {
          return { status: "cancelled" };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const executing = coordinator.handle({
      type: "EXECUTE_EXACT_FALLBACK",
    });
    await vi.waitFor(() =>
      expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "RUN_EXACT_FALLBACK" }),
      ),
    );
    await coordinator.handle({ type: "CANCEL_EXECUTION" });
    finish?.({
      status: "filled",
      adapter: "exact-fallback",
      changedFields: 1,
    });

    await expect(executing).resolves.toMatchObject({ status: "cancelled" });
    expect((await chromeAdapter.getSession()).lastExecution).toBeNull();
  });

  it("claims cancellation before its initial session read", async () => {
    const chromeAdapter = adapter();
    const analyzed = analyzedSession("fill");
    await chromeAdapter.setSession({
      ...analyzed,
      fallbackOffer: {
        ...analyzed.analysisTarget!,
        strategy: analyzed.strategies[1]!,
        reason: "Page Agent stopped.",
      },
    });
    const baseGetSession = vi
      .mocked(chromeAdapter.getSession)
      .getMockImplementation()!;
    let pauseNextSessionRead = false;
    let releaseCancellationRead: (() => void) | undefined;
    vi.mocked(chromeAdapter.getSession).mockImplementation(async () => {
      if (pauseNextSessionRead) {
        pauseNextSessionRead = false;
        await new Promise<void>((resolve) => {
          releaseCancellationRead = resolve;
        });
      }
      return baseGetSession();
    });
    let finish:
      | ((value: {
          status: "filled";
          adapter: "exact-fallback";
          changedFields: number;
        }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") return fieldManifest();
        if (message.type === "RUN_EXACT_FALLBACK") {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        if (message.type === "CANCEL_EXECUTION") {
          return { status: "cancelled" };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const executing = coordinator.handle({
      type: "EXECUTE_EXACT_FALLBACK",
    });
    await vi.waitFor(() =>
      expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "RUN_EXACT_FALLBACK" }),
      ),
    );
    pauseNextSessionRead = true;
    const cancelling = coordinator.handle({ type: "CANCEL_EXECUTION" });
    await vi.waitFor(() => expect(releaseCancellationRead).toBeTypeOf("function"));
    finish?.({
      status: "filled",
      adapter: "exact-fallback",
      changedFields: 1,
    });

    await expect(executing).resolves.toMatchObject({ status: "cancelled" });
    expect((await chromeAdapter.getSession()).lastExecution).toBeNull();
    releaseCancellationRead?.();
    await cancelling;
    expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(7, {
      type: "CANCEL_EXECUTION",
    });
    expect((await chromeAdapter.getSession()).lastExecution).toBeNull();
  });

  it("revalidates cancellation after a paused success-path session read", async () => {
    const chromeAdapter = adapter();
    const analyzed = analyzedSession("fill");
    await chromeAdapter.setSession({
      ...analyzed,
      fallbackOffer: {
        ...analyzed.analysisTarget!,
        strategy: analyzed.strategies[1]!,
        reason: "Page Agent stopped.",
      },
    });
    const baseGetSession = vi
      .mocked(chromeAdapter.getSession)
      .getMockImplementation()!;
    let pauseNextSessionRead = false;
    let releaseSuccessRead: (() => void) | undefined;
    vi.mocked(chromeAdapter.getSession).mockImplementation(async () => {
      if (pauseNextSessionRead) {
        pauseNextSessionRead = false;
        await new Promise<void>((resolve) => {
          releaseSuccessRead = resolve;
        });
      }
      return baseGetSession();
    });
    let finish:
      | ((value: {
          status: "filled";
          adapter: "exact-fallback";
          changedFields: number;
        }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") return fieldManifest();
        if (message.type === "RUN_EXACT_FALLBACK") {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        if (message.type === "CANCEL_EXECUTION") {
          return { status: "cancelled" };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const executing = coordinator.handle({
      type: "EXECUTE_EXACT_FALLBACK",
    });
    await vi.waitFor(() =>
      expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "RUN_EXACT_FALLBACK" }),
      ),
    );
    pauseNextSessionRead = true;
    finish?.({
      status: "filled",
      adapter: "exact-fallback",
      changedFields: 1,
    });
    await vi.waitFor(() => expect(releaseSuccessRead).toBeTypeOf("function"));

    await coordinator.handle({ type: "CANCEL_EXECUTION" });
    expect((await chromeAdapter.getSession()).lastExecution).toBeNull();
    releaseSuccessRead?.();

    await expect(executing).resolves.toMatchObject({ status: "cancelled" });
    expect((await chromeAdapter.getSession()).lastExecution).toBeNull();
  });

  it("keeps the execution lease until delayed Clear confirms rollback", async () => {
    const chromeAdapter = adapter();
    const analyzed = analyzedSession("fill");
    await chromeAdapter.setSession({
      ...analyzed,
      fallbackOffer: {
        ...analyzed.analysisTarget!,
        strategy: analyzed.strategies[1]!,
        reason: "Page Agent stopped.",
      },
    });
    const baseGetSession = vi
      .mocked(chromeAdapter.getSession)
      .getMockImplementation()!;
    let pauseNextSessionRead = false;
    let releaseClearRead: (() => void) | undefined;
    vi.mocked(chromeAdapter.getSession).mockImplementation(async () => {
      if (pauseNextSessionRead) {
        pauseNextSessionRead = false;
        await new Promise<void>((resolve) => {
          releaseClearRead = resolve;
        });
      }
      return baseGetSession();
    });
    let finish:
      | ((value: {
          status: "filled";
          adapter: "exact-fallback";
          changedFields: number;
        }) => void)
      | undefined;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") return fieldManifest();
        if (message.type === "RUN_EXACT_FALLBACK") {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        if (message.type === "CANCEL_EXECUTION") {
          return { status: "cancelled" };
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });

    const executing = coordinator.handle({
      type: "EXECUTE_EXACT_FALLBACK",
    });
    await vi.waitFor(() =>
      expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "RUN_EXACT_FALLBACK" }),
      ),
    );
    pauseNextSessionRead = true;
    const clearing = coordinator.handle({ type: "CLEAR_SESSION" });
    await vi.waitFor(() => expect(releaseClearRead).toBeTypeOf("function"));
    finish?.({
      status: "filled",
      adapter: "exact-fallback",
      changedFields: 1,
    });

    await expect(executing).resolves.toMatchObject({ status: "cancelled" });
    expect((await chromeAdapter.getSession()).executionLease).not.toBeNull();
    releaseClearRead?.();
    await clearing;
    expect(chromeAdapter.sendTabMessage).toHaveBeenCalledWith(7, {
      type: "CANCEL_EXECUTION",
    });
    expect(await chromeAdapter.getSession()).toEqual(createEmptySession());
  });

  it("retains Undo until the original document acknowledges restoration", async () => {
    const chromeAdapter = adapter();
    await chromeAdapter.setSession(analyzedSession("fill"));
    let undoConfirmed = false;
    vi.mocked(chromeAdapter.sendTabMessage).mockImplementation(
      async (_tabId, message) => {
        if (message.type === "DISCOVER_FIELDS") {
          return fieldManifest();
        }
        if (message.type === "RUN_PAGE_AGENT") {
          return {
            status: "filled",
            adapter: "page-agent",
            changedFields: 1,
          };
        }
        if (message.type === "RUN_UNDO") {
          return undoConfirmed ? { status: "undone" } : undefined;
        }
        return { ok: true };
      },
    );
    const coordinator = createBackgroundCoordinator({
      chrome: chromeAdapter,
      delay: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      normalizeImage: vi.fn(async (dataUrl) => dataUrl),
    });
    await coordinator.handle({ type: "EXECUTE" });

    await expect(coordinator.handle({ type: "UNDO" })).rejects.toThrow(
      "confirm Undo",
    );
    expect((await chromeAdapter.getSession()).lastExecution).not.toBeNull();

    undoConfirmed = true;
    await coordinator.handle({ type: "UNDO" });
    expect((await chromeAdapter.getSession()).lastExecution).toBeNull();
  });
});
