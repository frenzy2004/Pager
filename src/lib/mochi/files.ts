export const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type ScreenshotValidation =
  | { ok: true }
  | { ok: false; error: string };

export function validateScreenshot(file: File): ScreenshotValidation {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return {
      ok: false,
      error: "Use a PNG, JPEG, or WebP screenshot.",
    };
  }

  if (file.size > MAX_SCREENSHOT_BYTES) {
    return {
      ok: false,
      error: "Keep each screenshot under 6 MB.",
    };
  }

  return { ok: true };
}

