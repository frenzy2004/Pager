export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface SnipResult {
  dataUrl: string;
  rect: Rect;
}

type CropFunction = (dataUrl: string, rect: Rect) => Promise<string>;
let cancelActiveSnip: (() => void) | null = null;

export function cancelFrozenSnip() {
  cancelActiveSnip?.();
}

export function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

async function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Mochi could not read the frozen capture."));
    image.src = dataUrl;
  });
}

async function cropFrozenFrame(dataUrl: string, rect: Rect) {
  const image = await loadImage(dataUrl);
  const scaleX = image.naturalWidth / window.innerWidth;
  const scaleY = image.naturalHeight / window.innerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * scaleX));
  canvas.height = Math.max(1, Math.round(rect.height * scaleY));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Mochi could not crop that capture.");
  }
  context.drawImage(
    image,
    Math.round(rect.x * scaleX),
    Math.round(rect.y * scaleY),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function runFrozenSnip(
  dataUrl: string,
  { crop = cropFrozenFrame }: { crop?: CropFunction } = {},
): Promise<SnipResult | null> {
  cancelFrozenSnip();
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.dataset.mochiSnipOverlay = "true";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "cursor:crosshair",
      `background-image:url(${JSON.stringify(dataUrl)})`,
      "background-position:0 0",
      "background-repeat:no-repeat",
      "background-size:100vw 100vh",
      "user-select:none",
      "touch-action:none",
    ].join(";");
    const selection = document.createElement("div");
    selection.style.cssText = [
      "position:absolute",
      "display:none",
      "border:2px solid #ffdf64",
      "background:rgba(116,103,245,.12)",
      "box-shadow:0 0 0 9999px rgba(16,16,15,.45)",
      "pointer-events:none",
    ].join(";");
    const hint = document.createElement("div");
    hint.textContent = "Drag to capture · Esc to cancel";
    hint.style.cssText = [
      "position:absolute",
      "top:18px",
      "left:50%",
      "transform:translateX(-50%)",
      "background:#1d1d1a",
      "color:#fffdf8",
      "border-radius:999px",
      "padding:10px 16px",
      "font:700 13px Arial,sans-serif",
      "letter-spacing:.02em",
      "box-shadow:0 12px 28px rgba(0,0,0,.25)",
      "pointer-events:none",
    ].join(";");
    overlay.append(selection, hint);
    document.documentElement.append(overlay);

    let start: Point | null = null;
    let settled = false;

    const cleanup = () => {
      overlay.remove();
      window.removeEventListener("keydown", onKeyDown);
      if (cancelActiveSnip === cancel) {
        cancelActiveSnip = null;
      }
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    cancelActiveSnip = cancel;
    const render = (rect: Rect) => {
      selection.style.display = "block";
      selection.style.left = `${rect.x}px`;
      selection.style.top = `${rect.y}px`;
      selection.style.width = `${rect.width}px`;
      selection.style.height = `${rect.height}px`;
    };

    overlay.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      cancel();
    });
    overlay.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      start = { x: event.clientX, y: event.clientY };
      render(normalizeRect(start, start));
    });
    overlay.addEventListener("pointermove", (event) => {
      if (!start || settled) return;
      render(normalizeRect(start, { x: event.clientX, y: event.clientY }));
    });
    overlay.addEventListener("pointercancel", cancel);
    overlay.addEventListener("pointerup", (event) => {
      if (!start || settled) return;
      const rect = normalizeRect(start, {
        x: event.clientX,
        y: event.clientY,
      });
      if (rect.width < 8 || rect.height < 8) {
        cancel();
        return;
      }
      settled = true;
      cleanup();
      void crop(dataUrl, rect).then(
        (cropped) => resolve({ dataUrl: cropped, rect }),
        reject,
      );
    });
    window.addEventListener("keydown", onKeyDown);
  });
}
