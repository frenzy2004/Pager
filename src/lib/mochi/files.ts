import { MAX_SCREENSHOT_DATA_URL_LENGTH } from "@/lib/mochi/image-limits";

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

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that screenshot."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not compress that screenshot.")),
      "image/jpeg",
      quality,
    );
  });
}

export async function normalizeScreenshotFile(file: File) {
  const original = await blobToDataUrl(file);
  if (original.length <= MAX_SCREENSHOT_DATA_URL_LENGTH) {
    return original;
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser could not compress that screenshot.");
  }

  const bitmap = await createImageBitmap(file);
  const initialScale = Math.min(
    1,
    1600 / Math.max(bitmap.width, bitmap.height),
  );
  let width = Math.max(1, Math.round(bitmap.width * initialScale));
  let height = Math.max(1, Math.round(bitmap.height * initialScale));

  try {
    for (let scaleAttempt = 0; scaleAttempt < 4; scaleAttempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Could not prepare that screenshot.");
      }
      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of [0.82, 0.68, 0.54, 0.42, 0.32]) {
        const normalized = await blobToDataUrl(
          await canvasToBlob(canvas, quality),
        );
        if (normalized.length <= MAX_SCREENSHOT_DATA_URL_LENGTH) {
          return normalized;
        }
      }
      width = Math.max(1, Math.round(width * 0.76));
      height = Math.max(1, Math.round(height * 0.76));
    }
  } finally {
    bitmap.close();
  }
  throw new Error("That screenshot is too detailed to fit in Mochi.");
}
