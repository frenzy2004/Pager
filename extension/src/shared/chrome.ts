import type { ConnectorMessage, ConnectorSession } from "./protocol";
import {
  parseProviderSettings,
  type ProviderSettings,
} from "./provider-settings";

const SESSION_KEY = "mochi-session";
const INSTALL_ID_KEY = "mochi-install-id";
const PROVIDER_SETTINGS_KEY = "mochi-provider-settings";

export interface ActiveTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
}

export interface ChromeAdapter {
  broadcast(message: ConnectorMessage): Promise<void>;
  captureVisibleTab(windowId: number): Promise<string>;
  clearProviderSettings(): Promise<void>;
  executeAgent(tabId: number): Promise<void>;
  getInstallId(): Promise<string | null>;
  getProviderSettings(): Promise<ProviderSettings | null>;
  getSession(): Promise<ConnectorSession>;
  getTab(tabId: number): Promise<ActiveTab | null>;
  openPanel(windowId: number): Promise<void>;
  queryActiveTab(): Promise<ActiveTab | null>;
  restrictLocalStorage(): Promise<void>;
  sendTabMessage(tabId: number, message: ConnectorMessage): Promise<unknown>;
  setInstallId(installId: string): Promise<void>;
  setProviderSettings(settings: ProviderSettings): Promise<void>;
  setSession(session: ConnectorSession): Promise<void>;
  setSubmissionGuard(tabId: number, enabled: boolean): Promise<void>;
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
    async clearProviderSettings() {
      await chrome.storage.local.remove(PROVIDER_SETTINGS_KEY);
    },
    async executeAgent(tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["agent.js"],
      });
    },
    async getInstallId() {
      const stored = await chrome.storage.local.get(INSTALL_ID_KEY);
      const value = stored[INSTALL_ID_KEY];
      return typeof value === "string" ? value : null;
    },
    async getProviderSettings() {
      const stored = await chrome.storage.local.get(PROVIDER_SETTINGS_KEY);
      return parseProviderSettings(stored[PROVIDER_SETTINGS_KEY]);
    },
    async getSession() {
      const stored = await chrome.storage.session.get(SESSION_KEY);
      return stored[SESSION_KEY] as ConnectorSession;
    },
    async getTab(tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (
          typeof tab.id !== "number" ||
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
      } catch {
        return null;
      }
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
    async restrictLocalStorage() {
      await chrome.storage.local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
    },
    sendTabMessage(tabId, message) {
      return chrome.tabs.sendMessage(tabId, message);
    },
    async setInstallId(installId) {
      await chrome.storage.local.set({ [INSTALL_ID_KEY]: installId });
    },
    async setProviderSettings(settings) {
      await chrome.storage.local.set({
        [PROVIDER_SETTINGS_KEY]: settings,
      });
    },
    async setSession(session) {
      await chrome.storage.session.set({ [SESSION_KEY]: session });
    },
    async setSubmissionGuard(tabId, enabled) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (shouldBlock: boolean) => {
          const stateKey = "__mochiNativeSubmitGuard__";
          type GuardedWindow = Window & {
            [stateKey]?: {
              blockedRequestSubmit:
                typeof HTMLFormElement.prototype.requestSubmit;
              blockedSubmit: typeof HTMLFormElement.prototype.submit;
              originalRequestSubmit:
                typeof HTMLFormElement.prototype.requestSubmit;
              originalSubmit: typeof HTMLFormElement.prototype.submit;
            };
          };
          const guardedWindow = window as GuardedWindow;
          const existing = guardedWindow[stateKey];
          if (shouldBlock) {
            if (existing) return;
            const prototype = HTMLFormElement.prototype;
            const originalSubmit = prototype.submit;
            const originalRequestSubmit = prototype.requestSubmit;
            const blockedSubmit = function (this: HTMLFormElement) {
              return undefined;
            };
            const blockedRequestSubmit = function (
              this: HTMLFormElement,
              submitter?: HTMLElement | null,
            ) {
              void submitter;
              return undefined;
            };
            prototype.submit = blockedSubmit;
            prototype.requestSubmit = blockedRequestSubmit;
            Object.defineProperty(guardedWindow, stateKey, {
              configurable: true,
              value: {
                blockedRequestSubmit,
                blockedSubmit,
                originalRequestSubmit,
                originalSubmit,
              },
            });
            return;
          }
          if (!existing) return;
          if (
            HTMLFormElement.prototype.submit === existing.blockedSubmit
          ) {
            HTMLFormElement.prototype.submit = existing.originalSubmit;
          }
          if (
            HTMLFormElement.prototype.requestSubmit ===
            existing.blockedRequestSubmit
          ) {
            HTMLFormElement.prototype.requestSubmit =
              existing.originalRequestSubmit;
          }
          delete guardedWindow[stateKey];
        },
        args: [enabled],
      });
    },
  };
}
