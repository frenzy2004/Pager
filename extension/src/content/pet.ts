export interface MochiPetController {
  host: HTMLDivElement;
  button: HTMLButtonElement;
  destroy(): void;
  setVisible(visible: boolean): void;
}

export function mountMochiPet(
  root: Document,
  onOpen: () => void,
): MochiPetController {
  const host = root.createElement("div");
  host.dataset.mochiConnector = "true";
  host.style.cssText = [
    "all:initial",
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:2147483646",
    "display:block",
  ].join(";");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = root.createElement("style");
  style.textContent = `
    :host { all: initial; }
    button {
      align-items: center;
      appearance: none;
      background: #1d1d1a;
      border: 0;
      border-radius: 24px;
      box-shadow: 0 16px 38px rgba(29, 29, 26, .28);
      color: #fffdf8;
      cursor: pointer;
      display: flex;
      font-family: Arial, sans-serif;
      gap: 9px;
      height: 54px;
      padding: 6px 15px 6px 6px;
      transition: transform 160ms ease, box-shadow 160ms ease;
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 19px 44px rgba(29,29,26,.34); }
    button:focus-visible { outline: 3px solid #7467f5; outline-offset: 3px; }
    .face {
      align-items: center;
      background: #7467f5;
      border: 2px solid #fffdf8;
      border-radius: 18px;
      display: flex;
      font-family: Georgia, serif;
      font-size: 22px;
      font-weight: 700;
      height: 38px;
      justify-content: center;
      position: relative;
      width: 38px;
    }
    .spark {
      align-items: center;
      background: #ffdf64;
      border: 2px solid #1d1d1a;
      border-radius: 50%;
      color: #1d1d1a;
      display: flex;
      font-size: 10px;
      height: 16px;
      justify-content: center;
      position: absolute;
      right: -5px;
      top: -5px;
      width: 16px;
    }
    .label { font-size: 12px; font-weight: 800; letter-spacing: .13em; }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }
  `;
  const button = root.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open Mochi");
  button.innerHTML = `
    <span class="face" aria-hidden="true">M<span class="spark">✦</span></span>
    <span class="label">MOCHI</span>
  `;
  button.addEventListener("click", onOpen);
  shadow.append(style, button);
  root.documentElement.append(host);

  return {
    host,
    button,
    destroy() {
      host.remove();
    },
    setVisible(visible) {
      host.style.display = visible ? "block" : "none";
    },
  };
}
