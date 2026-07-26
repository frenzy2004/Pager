import type { ConnectorMessage } from "../shared/protocol";
import { discoverSafeFields } from "./fields";
import { mountMochiPet } from "./pet";
import { runFrozenSnip } from "./snip";

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | void;

export interface ContentRuntime {
  addMessageListener(listener: MessageListener): void;
  sendMessage(message: ConnectorMessage): Promise<unknown>;
}

interface InstallContentScriptOptions {
  document: Document;
  runtime: ContentRuntime;
}

export function installContentScript({
  document: pageDocument,
  runtime,
}: InstallContentScriptOptions) {
  const pet = mountMochiPet(pageDocument, () => {
    void runtime.sendMessage({ type: "OPEN_PANEL" });
  });

  runtime.addMessageListener((message, _sender, sendResponse) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message)
    ) {
      return;
    }

    if (message.type === "HIDE_PET") {
      pet.setVisible(false);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "SHOW_PET") {
      pet.setVisible(true);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "DISCOVER_FIELDS") {
      sendResponse({ fields: discoverSafeFields(pageDocument) });
      return;
    }
    if (
      message.type === "BEGIN_FROZEN_SNIP" &&
      "dataUrl" in message &&
      typeof message.dataUrl === "string"
    ) {
      void runFrozenSnip(message.dataUrl).then(
        (result) => sendResponse(result),
        (error: unknown) =>
          sendResponse({
            error:
              error instanceof Error
                ? error.message
                : "Mochi could not crop that capture.",
          }),
      );
      return true;
    }
  });

  return pet;
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  installContentScript({
    document,
    runtime: {
      addMessageListener(listener) {
        chrome.runtime.onMessage.addListener(listener);
      },
      sendMessage(message) {
        return chrome.runtime.sendMessage(message);
      },
    },
  });
}
