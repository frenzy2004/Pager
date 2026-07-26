import { createChromeAdapter, type ActiveTab, type ChromeAdapter } from "./shared/chrome";
import { normalizeCapturedImage } from "./shared/image-policy";
import type {
  ConnectorMessage,
  ConnectorSession,
  PageAgentFetchResponse,
  Strategy,
} from "./shared/protocol";
import {
  createEmptySession,
  parseConnectorMessage,
  reduceSession,
} from "./shared/session";

export const MOCHI_ORIGIN = "https://mochi-overlay.vercel.app";
export const ANALYZE_URL = `${MOCHI_ORIGIN}/api/analyze`;
export const PAGE_AGENT_URL = `${MOCHI_ORIGIN}/api/page-agent/chat/completions`;

interface CoordinatorDependencies {
  chrome: ChromeAdapter;
  delay(milliseconds: number): Promise<void>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  normalizeImage(dataUrl: string): Promise<string>;
  now?: () => Date;
  randomId?: () => string;
}

function isEligibleTab(tab: ActiveTab | null): tab is ActiveTab {
  return Boolean(tab && /^https?:\/\//.test(tab.url));
}

function isStrategy(value: unknown): value is Strategy {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const strategy = value as Partial<Strategy>;
  return (
    (strategy.id === "safe" ||
      strategy.id === "balanced" ||
      strategy.id === "standout") &&
    typeof strategy.label === "string" &&
    typeof strategy.rationale === "string" &&
    typeof strategy.fields === "object" &&
    strategy.fields !== null
  );
}

export function createBackgroundCoordinator({
  chrome: chromeAdapter,
  delay,
  fetch: fetchFromVercel,
  normalizeImage,
  now = () => new Date(),
  randomId = () => crypto.randomUUID(),
}: CoordinatorDependencies) {
  async function loadSession(): Promise<ConnectorSession> {
    return (await chromeAdapter.getSession()) ?? createEmptySession();
  }

  async function saveSession(session: ConnectorSession) {
    await chromeAdapter.setSession(session);
    await chromeAdapter.broadcast({ type: "SESSION_UPDATED", session });
    return session;
  }

  async function activeTab() {
    const tab = await chromeAdapter.queryActiveTab();
    if (!isEligibleTab(tab)) {
      throw new Error(
        "Mochi works on normal HTTP and HTTPS pages. This tab is restricted.",
      );
    }
    return tab;
  }

  async function fail(error: unknown) {
    const message =
      error instanceof Error ? error.message : "Mochi could not finish.";
    await saveSession(
      reduceSession(await loadSession(), { type: "failed", error: message }),
    );
    return message;
  }

  async function captureActiveFrame(tab: ActiveTab) {
    try {
      await chromeAdapter.sendTabMessage(tab.id, { type: "HIDE_PET" });
      await delay(80);
      return await chromeAdapter.captureVisibleTab(tab.windowId);
    } finally {
      await chromeAdapter
        .sendTabMessage(tab.id, { type: "SHOW_PET" })
        .catch(() => undefined);
    }
  }

  async function captureViewport() {
    const tab = await activeTab();
    const current = await loadSession();
    await saveSession({
      ...current,
      error: null,
      status: "capturing",
    });

    try {
      const rawCapture = await captureActiveFrame(tab);
      const dataUrl = await normalizeImage(rawCapture);
      return saveSession(
        reduceSession(await loadSession(), {
          type: "capture-added",
          capture: {
            id: randomId(),
            dataUrl,
            sourceUrl: tab.url,
            sourceTitle: tab.title,
            capturedAt: now().toISOString(),
            kind: "viewport",
          },
        }),
      );
    } catch (error) {
      await fail(error);
      throw error;
    }
  }

  async function captureRegion() {
    const tab = await activeTab();
    const current = await loadSession();
    await saveSession({
      ...current,
      error: null,
      status: "capturing",
    });
    try {
      const frozenFrame = await captureActiveFrame(tab);
      const result = (await chromeAdapter.sendTabMessage(tab.id, {
        type: "BEGIN_FROZEN_SNIP",
        dataUrl: frozenFrame,
      })) as { dataUrl?: string; error?: string } | null;
      if (!result) {
        return saveSession({
          ...(await loadSession()),
          status: current.strategies.length > 0 ? "ready" : "idle",
        });
      }
      if (result.error || !result.dataUrl) {
        throw new Error(result.error ?? "Mochi could not crop that capture.");
      }
      const dataUrl = await normalizeImage(result.dataUrl);
      return saveSession(
        reduceSession(await loadSession(), {
          type: "capture-added",
          capture: {
            id: randomId(),
            dataUrl,
            sourceUrl: tab.url,
            sourceTitle: tab.title,
            capturedAt: now().toISOString(),
            kind: "region",
          },
        }),
      );
    } catch (error) {
      await fail(error);
      throw error;
    }
  }

  async function analyze() {
    const session = await loadSession();
    if (session.captures.length === 0) {
      throw new Error("Capture at least one page before analysis.");
    }
    const tab = await activeTab();
    const manifest = (await chromeAdapter.sendTabMessage(tab.id, {
      type: "DISCOVER_FIELDS",
    })) as { fields?: unknown[] };
    if (!manifest.fields?.length) {
      throw new Error("Mochi could not find safe form fields on this page.");
    }

    await saveSession(
      reduceSession(session, { type: "analysis-started" }),
    );
    const response = await fetchFromVercel(ANALYZE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preset: session.preset,
        taskHint: session.taskHint,
        screenshots: session.captures.map(
          ({ dataUrl, sourceUrl, sourceTitle, capturedAt, kind }) => ({
            dataUrl,
            sourceUrl,
            sourceTitle,
            capturedAt,
            kind,
          }),
        ),
        fields: manifest.fields,
      }),
    });
    const body = (await response.json()) as {
      error?: string;
      strategies?: unknown[];
    };
    if (!response.ok) {
      throw new Error(body.error ?? `Analysis failed (${response.status}).`);
    }
    if (
      body.strategies?.length !== 3 ||
      !body.strategies.every(isStrategy)
    ) {
      throw new Error("Vercel returned an invalid three-strategy response.");
    }

    return saveSession(
      reduceSession(await loadSession(), {
        type: "analysis-succeeded",
        strategies: body.strategies,
      }),
    );
  }

  async function fetchPageAgent(body: string): Promise<PageAgentFetchResponse> {
    const response = await fetchFromVercel(PAGE_AGENT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      bodyText: await response.text(),
    };
  }

  async function handle(rawMessage: unknown): Promise<unknown> {
    const message = parseConnectorMessage(rawMessage);
    if (!message) {
      throw new Error("Mochi ignored an invalid connector message.");
    }

    switch (message.type) {
      case "GET_SESSION":
        return loadSession();
      case "OPEN_PANEL": {
        const tab = await activeTab();
        await chromeAdapter.openPanel(tab.windowId);
        return { ok: true };
      }
      case "CAPTURE_VIEWPORT":
        return captureViewport();
      case "START_SNIP":
        return captureRegion();
      case "REMOVE_CAPTURE":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "capture-removed",
            captureId: message.captureId,
          }),
        );
      case "CLEAR_SESSION":
        return saveSession(createEmptySession());
      case "SET_PRESET":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "preset-changed",
            preset: message.preset,
          }),
        );
      case "SET_TASK_HINT":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "task-hint-changed",
            taskHint: message.taskHint,
          }),
        );
      case "SELECT_STRATEGY":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "strategy-selected",
            strategyId: message.strategyId,
          }),
        );
      case "SET_MODE":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "mode-changed",
            mode: message.mode,
          }),
        );
      case "ANALYZE":
        try {
          return await analyze();
        } catch (error) {
          await fail(error);
          throw error;
        }
      case "FETCH_PAGE_AGENT":
        return fetchPageAgent(message.body);
      default:
        throw new Error(`Mochi has not enabled ${message.type} yet.`);
    }
  }

  return { handle };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  const chromeAdapter = createChromeAdapter();
  const coordinator = createBackgroundCoordinator({
    chrome: chromeAdapter,
    delay,
    fetch,
    normalizeImage: normalizeCapturedImage,
  });

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    void chromeAdapter.setSession(createEmptySession());
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void coordinator.handle(message).then(
      (result) => sendResponse({ ok: true, result }),
      (error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Mochi could not finish.",
        }),
    );
    return true;
  });
}
