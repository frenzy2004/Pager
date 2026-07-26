import { describe, expect, it } from "vitest";

import {
  MAX_SCREENSHOT_BYTES,
  validateScreenshot,
} from "@/lib/mochi/files";

function fileOf(type: string, size = 12) {
  return new File([new Uint8Array(size)], "context.bin", { type });
}

describe("validateScreenshot", () => {
  it("accepts supported image files within the size limit", () => {
    expect(validateScreenshot(fileOf("image/png"))).toEqual({ ok: true });
    expect(validateScreenshot(fileOf("image/jpeg"))).toEqual({ ok: true });
    expect(validateScreenshot(fileOf("image/webp"))).toEqual({ ok: true });
  });

  it("rejects unsupported formats with a useful message", () => {
    expect(validateScreenshot(fileOf("application/pdf"))).toEqual({
      ok: false,
      error: "Use a PNG, JPEG, or WebP screenshot.",
    });
  });

  it("rejects files larger than the bounded upload size", () => {
    expect(
      validateScreenshot(fileOf("image/png", MAX_SCREENSHOT_BYTES + 1)),
    ).toEqual({
      ok: false,
      error: "Keep each screenshot under 6 MB.",
    });
  });
});

