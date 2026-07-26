import { MAX_CAPTURE_DATA_URL_LENGTH } from "./session";

export interface ImageDimensions {
  width: number;
  height: number;
}

export function fitImageWithin(
  width: number,
  height: number,
  maxEdge = 1600,
): ImageDimensions {
  const largest = Math.max(width, height);
  if (largest <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / largest;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export function selectCaptureQuality(dataUrlLength: number) {
  if (dataUrlLength <= 500_000) return 0.82;
  if (dataUrlLength <= 750_000) return 0.68;
  if (dataUrlLength <= MAX_CAPTURE_DATA_URL_LENGTH) return 0.54;
  return 0.42;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 32_768;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }

  return btoa(chunks.join(""));
}

export async function normalizeCapturedImage(dataUrl: string) {
  const source = await fetch(dataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(source);
  let dimensions = fitImageWithin(bitmap.width, bitmap.height);
  const qualities = [
    selectCaptureQuality(dataUrl.length),
    0.68,
    0.54,
    0.42,
    0.32,
  ].filter((quality, index, values) => values.indexOf(quality) === index);

  try {
    for (let scaleAttempt = 0; scaleAttempt < 3; scaleAttempt += 1) {
      const canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Chrome could not prepare the captured image.");
      }
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

      for (const quality of qualities) {
        const blob = await canvas.convertToBlob({
          type: "image/jpeg",
          quality,
        });
        const normalized = `data:image/jpeg;base64,${arrayBufferToBase64(
          await blob.arrayBuffer(),
        )}`;
        if (normalized.length <= MAX_CAPTURE_DATA_URL_LENGTH) {
          return normalized;
        }
      }

      dimensions = {
        width: Math.max(1, Math.round(dimensions.width * 0.78)),
        height: Math.max(1, Math.round(dimensions.height * 0.78)),
      };
    }
  } finally {
    bitmap.close();
  }

  throw new Error("That viewport is too detailed to fit in Mochi's tray.");
}
