import { describe, expect, it, vi } from "vitest";

import { normalizeRect, runFrozenSnip } from "./snip";

describe("frozen snip", () => {
  it("normalizes drags in every direction", () => {
    expect(
      normalizeRect({ x: 320, y: 240 }, { x: 100, y: 80 }),
    ).toEqual({
      x: 100,
      y: 80,
      width: 220,
      height: 160,
    });
  });

  it("crops from the exact frozen frame and removes the overlay", async () => {
    const crop = vi.fn().mockResolvedValue(
      "data:image/jpeg;base64,Y3JvcA==",
    );
    const pending = runFrozenSnip(
      "data:image/jpeg;base64,ZnJhbWU=",
      { crop },
    );
    const overlay = document.querySelector<HTMLElement>(
      "[data-mochi-snip-overlay]",
    )!;

    expect(overlay.style.backgroundImage).toContain(
      "data:image/jpeg;base64,ZnJhbWU=",
    );
    overlay.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 300,
        clientY: 240,
      }),
    );
    overlay.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 100,
        clientY: 80,
      }),
    );
    overlay.dispatchEvent(
      new MouseEvent("pointerup", {
        bubbles: true,
        clientX: 100,
        clientY: 80,
      }),
    );

    await expect(pending).resolves.toMatchObject({
      dataUrl: "data:image/jpeg;base64,Y3JvcA==",
      rect: { x: 100, y: 80, width: 200, height: 160 },
    });
    expect(crop).toHaveBeenCalledWith(
      "data:image/jpeg;base64,ZnJhbWU=",
      { x: 100, y: 80, width: 200, height: 160 },
    );
    expect(
      document.querySelector("[data-mochi-snip-overlay]"),
    ).toBeNull();
  });

  it("cancels with Escape and rejects zero-size selections", async () => {
    const crop = vi.fn();
    const escaped = runFrozenSnip("data:image/jpeg;base64,ZnJhbWU=", {
      crop,
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape" }),
    );
    await expect(escaped).resolves.toBeNull();

    const empty = runFrozenSnip("data:image/jpeg;base64,ZnJhbWU=", { crop });
    const overlay = document.querySelector<HTMLElement>(
      "[data-mochi-snip-overlay]",
    )!;
    overlay.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 20, clientY: 20 }),
    );
    overlay.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 20, clientY: 20 }),
    );

    await expect(empty).resolves.toBeNull();
    expect(crop).not.toHaveBeenCalled();
  });
});
