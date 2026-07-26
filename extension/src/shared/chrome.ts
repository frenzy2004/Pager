import type { ConnectorMessage, ConnectorSession } from "./protocol";

const SESSION_KEY = "mochi-session";

export interface ActiveTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
}

export interface ChromeAdapter {
  broadcast(message: ConnectorMessage): Promise<void>;
  captureVisibleTab(windowId: number): Promise<string>;
  executeAgent(tabId: number): Promise<void>;
  getSession(): Promise<ConnectorSession>;
  openPanel(windowId: number): Promise<void>;
  queryActiveTab(): Promise<ActiveTab | null>;
  sendTabMessage(tabId: number, message: ConnectorMessage): Promise<unknown>;
  setSession(session: ConnectorSession): Promise<void>;
}

export function createChromeAdapter(): ChromeAdapter {
  return {
    async broadcast(message) {
      try {
        await chrome.runtime.sendMessage(message);
      } catch {
        // A side panel is not always open; state is still in storage.session.
      }
    },
    captureVisibleTab(windowId) {
      return chrome.tabs.captureVisibleTab(windowId, {
        format: "jpeg",
        quality: 82,
      });
    },
    async executeAgent(tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["agent.js"],
      });
    },
    async getSession() {
      const stored = await chrome.storage.session.get(SESSION_KEY);
      return stored[SESSION_KEY] as ConnectorSession;
    },
    openPanel(windowId) {
      return chrome.sidePanel.open({ windowId });
    },
    async queryActiveTab() {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (
        typeof tab?.id !== "number" ||
        typeof tab.windowId !== "number" ||
        !tab.url
      ) {
        return null;
      }
      return {
        id: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title ?? new URL(tab.url).hostname,
      };
    },
    sendTabMessage(tabId, message) {
      return chrome.tabs.sendMessage(tabId, message);
    },
    async setSession(session) {
      await chrome.storage.session.set({ [SESSION_KEY]: session });
    },
  };
}
