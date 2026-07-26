import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  installContentScript,
  type ContentRuntime,
} from "./content";

function runtime(): ContentRuntime & {
  listener?: (
    message: unknown,
    sender: unknown,
    sendResponse: (value: unknown) => void,
  ) => boolean | void;
} {
  const value: ReturnType<typeof runtime> = {
    addMessageListener(listener) {
      value.listener = listener;
    },
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  };
  return value;
}

describe("per-tab Mochi content script", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <label for="name">Full name</label>
      <input id="name" name="name" />
    `;
    document
      .querySelectorAll("[data-mochi-connector]")
      .forEach((element) => element.remove());
  });

  it("mounts one isolated pet and opens the global panel on click", async () => {
    const connectorRuntime = runtime();
    const controller = installContentScript({
      document,
      runtime: connectorRuntime,
    });

    expect(controller.host.shadowRoot).toBeNull();
    expect(
      document.querySelectorAll("[data-mochi-connector]"),
    ).toHaveLength(1);

    controller.button.click();
    expect(connectorRuntime.sendMessage).toHaveBeenCalledWith({
      type: "OPEN_PANEL",
    });
  });

  it("hides/restores the pet and returns the safe field manifest", async () => {
    const connectorRuntime = runtime();
    const controller = installContentScript({
      document,
      runtime: connectorRuntime,
    });
    const responses: unknown[] = [];

    connectorRuntime.listener?.(
      { type: "HIDE_PET" },
      {},
      (value) => responses.push(value),
    );
    expect(controller.host.style.display).toBe("none");

    connectorRuntime.listener?.(
      { type: "SHOW_PET" },
      {},
      (value) => responses.push(value),
    );
    expect(controller.host.style.display).not.toBe("none");

    connectorRuntime.listener?.(
      { type: "DISCOVER_FIELDS" },
      {},
      (value) => responses.push(value),
    );
    expect(responses.at(-1)).toEqual({
      fields: [
        {
          key: "name",
          label: "Full name",
          type: "text",
          required: false,
        },
      ],
    });
  });
});
