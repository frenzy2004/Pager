import { createRoot } from "react-dom/client";

import { App, type SidePanelRuntime } from "./App";
import "./styles.css";

const runtime: SidePanelRuntime = {
  addMessageListener(listener) {
    const chromeListener = (message: unknown) => {
      listener(message as Parameters<typeof listener>[0]);
    };
    chrome.runtime.onMessage.addListener(chromeListener);
    return () => chrome.runtime.onMessage.removeListener(chromeListener);
  },
  sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  },
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<App runtime={runtime} />);
}
