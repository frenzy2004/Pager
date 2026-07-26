# Mochi Vercel Browser Connector Design

**Date:** 2026-07-26

**Status:** Approved for implementation

**Repository:** `frenzy2004/Pager`

## Decision

Mochi remains a Vercel product. A small Manifest V3 Chrome connector supplies
the browser capabilities that a hosted page cannot have: putting the pet on
normal websites, capturing the active tab, sharing a task session across tabs,
and allowing Page Agent to act on the active page.

The connector is not a second backend and is not an Electron application.
OpenAI and Exa credentials remain on Vercel.

## Goals

- Show the Mochi pet on every eligible HTTP/HTTPS tab after one connector
  installation.
- Keep one global Mochi side panel available while the user switches tabs.
- Capture the entire visible tab with one click.
- Offer an optional frozen-screen region snip based on AUNTIE-SUP's proven
  capture-then-crop interaction.
- Collect as many as eight captures from different pages in one browser-session
  tray.
- Send captures to Vercel only when the user presses Analyze.
- Return exactly three strategies and execute the selected strategy on the
  active page through Alibaba Page Agent.
- Preserve Review, Fill only, Autopilot, cancellation, unknown-value, and undo
  safeguards.
- Keep the existing Vercel demo fully functional without the connector.

## Non-goals

- Chrome Web Store publication in this iteration.
- Firefox, Safari, or mobile-browser packaging.
- Persisting screenshot pixels after Chrome restarts.
- Full-scroll-page stitching. "Capture page" means the complete visible
  viewport; "Snip area" crops a region from that frozen viewport.
- Acting inside cross-origin iframes or browser-internal pages.
- Bypassing CAPTCHA, anti-bot controls, website permissions, or terms.
- Unattended multi-tab navigation. The connector follows the user across tabs,
  but execution is bounded to the active tab.

## Platform Contract

- Manifest version: 3.
- Minimum Chrome version: 116.
- Eligible pages: top-level `http://*/*` and `https://*/*` documents.
- Restricted pages such as `chrome://`, the Chrome Web Store, extension pages,
  and unapproved `file://` pages show a clear unsupported-page notice.
- Required extension permissions: `activeTab`, `scripting`, `sidePanel`, and
  `storage`.
- Required host permissions: `http://*/*` and `https://*/*`.
- The connector bundles all executable JavaScript. It does not download remote
  code.

## Architecture

```text
┌────────────────────────── Vercel ──────────────────────────┐
│ Next.js product UI                                          │
│ /api/analyze → OpenAI vision → optional Exa → OpenAI refine │
│ connector download + onboarding                             │
└───────────────────────────▲──────────────────────────────────┘
                            │ HTTPS, no browser keys
┌───────────────────────────┴──────────────────────────────────┐
│ Chrome connector service worker                              │
│ active-tab lookup · captureVisibleTab · session state · fetch │
└──────────────▲──────────────────────────────▲─────────────────┘
               │ messages                     │ messages
┌──────────────┴───────────────┐  ┌───────────┴────────────────┐
│ Global side panel            │  │ Per-tab content script      │
│ shared tray · strategies     │  │ Shadow-DOM pet · field scan │
│ modes · progress · errors    │  │ frozen snip UI · Page Agent │
└──────────────────────────────┘  └────────────────────────────┘
```

### Vercel app

The existing app remains the canonical product and analysis service. It gains:

- an extension-aware API contract accepting up to eight bounded screenshots;
- a constrained OpenAI-compatible Page Agent route at
  `/api/page-agent/chat/completions`;
- optional source metadata (`sourceUrl`, `sourceTitle`, `capturedAt`) for each
  capture;
- a "Use Mochi across tabs" installation section;
- a downloadable connector archive at
  `/downloads/mochi-connector.zip`;
- connector setup instructions that do not expose provider keys.

### Connector service worker

The service worker is the trusted coordinator. It:

- opens the global side panel after a pet click;
- resolves the active tab and sends commands only to that tab;
- asks the content script to hide the pet before capture;
- calls `chrome.tabs.captureVisibleTab`;
- restores the pet even when capture fails;
- validates, stores, removes, and clears shared task state;
- forwards bounded analysis packets to the fixed Vercel origin;
- never accepts an arbitrary fetch URL from content scripts.

All message payloads use a discriminated union and are validated before side
effects.

### Per-tab content script

A small content script runs at `document_idle` in the top frame. It creates one
closed Shadow DOM root so host-page CSS cannot alter Mochi and Mochi CSS cannot
alter the host page.

It owns:

- the floating pet;
- the frozen screenshot selection UI;
- page field discovery;
- exact DOM event dispatch for deterministic fallback and undo;
- on-demand loading of the separately bundled Page Agent executor.

It does not own credentials or cross-origin network access.

### Global side panel

The Chrome side panel is one extension page per browser window and remains open
while the active tab changes. It uses the Mochi visual system but is independent
of host-page CSS.

It owns:

- Capture page, Snip area, and Upload actions;
- the eight-item context tray;
- source metadata and removal controls;
- analysis progress and exactly three strategies;
- Review, Fill only, and Autopilot controls;
- cancellation, success, and undo states;
- clear-session and privacy explanations.

## Capture Flow

### Capture page

1. The user presses **Capture page** in the side panel.
2. The service worker resolves the active eligible tab.
3. The content script hides the injected pet and confirms the next animation
   frame.
4. The service worker captures the active tab as JPEG at quality 82.
5. The pet is restored in a `finally` path.
6. The image is downscaled, when needed, to a maximum edge of 1600 pixels.
7. JPEG quality is reduced in bounded steps until the resulting data URL is at
   most 850,000 bytes.
8. A capture record is stored and broadcast to every extension view.

### Snip area

1. The service worker captures the visible tab once using the same hide/capture
   sequence.
2. The content script paints that frozen image over the viewport.
3. The user drags a rectangle; the outside area is dimmed and the selection
   dimensions remain visible.
4. Mouse release crops from the original frozen image, not from a second
   capture.
5. `Escape`, a selection smaller than 8×8 CSS pixels, navigation, or tab closure
   cancels without adding context.

This mirrors AUNTIE-SUP's important reliability decision: freeze first, select
second, and crop from that same frame.

### Capture record

```ts
interface ConnectorCapture {
  id: string;
  name: string;
  dataUrl: string;
  sourceUrl: string;
  sourceTitle: string;
  capturedAt: string;
  width: number;
  height: number;
  kind: "viewport" | "region" | "upload";
}
```

The session holds at most eight records. A ninth capture is rejected with an
actionable message until one is removed. Captures are held in
`chrome.storage.session`, which provides a 10 MB in-memory quota and clears on
browser restart, extension reload, update, or disable.

## Shared Session and Tab Changes

```ts
interface ConnectorSession {
  version: 1;
  captures: ConnectorCapture[];
  taskHint: string;
  selectedStrategyId: "safe" | "balanced" | "standout";
  executionMode: "review" | "fill" | "autopilot";
}
```

- The service worker is the only writer.
- Side panels and content scripts receive immutable snapshots.
- `chrome.storage.onChanged` keeps any recreated view synchronized.
- Switching tabs updates the active-page title and field count without clearing
  captures.
- Opening another browser window exposes the same session tray, while the side
  panel open/closed state remains window-scoped.
- **Clear session** deletes capture pixels and resets task state immediately.

## Field Discovery

The active content script discovers visible, enabled:

- text-like `input` elements;
- `textarea` elements;
- `select` elements.

It excludes hidden, button, submit, reset, image, file, checkbox, and radio
controls in this iteration. Labels are resolved in this order:

1. associated `<label for>`;
2. wrapping `<label>`;
3. `aria-label`;
4. `aria-labelledby`;
5. placeholder;
6. name;
7. stable ordinal fallback.

Keys prefer `id`, then `name`, then a stable `field-N` identifier. The returned
manifest contains type, required state, and select options. Password and
one-time-code fields are always excluded.

## Analysis Flow

1. The side panel requests the active page manifest.
2. It sends task hint, source metadata, up to eight compressed images, and the
   field manifest to the service worker.
3. The service worker posts only to
   `https://mochi-overlay.vercel.app/api/analyze`.
4. Vercel validates the packet and performs the existing OpenAI → optional Exa
   → OpenAI flow.
5. The response must contain exactly `safe`, `balanced`, and `standout` in that
   order.
6. Unknown identity, contact, credential, employment, or financial facts remain
   empty with `needs-input`.

No screenshot leaves the browser before step 3.

## Page Agent Execution

Alibaba `page-agent@1.12.2` is bundled into a separate executor that is injected
only when the user chooses an action.

Page Agent receives an OpenAI-compatible `customFetch`. That function never
contacts a provider directly: it sends the bounded chat-completions packet to
the service worker, which forwards it only to
`https://mochi-overlay.vercel.app/api/page-agent/chat/completions`. The Vercel
route strips client model and authorization values, applies the server-selected
model, validates message/tool counts and payload size, and calls OpenAI with the
existing server-side credential.

The connector therefore uses Page Agent with the Vercel-hosted OpenAI runtime
without embedding a provider credential or accepting an arbitrary proxy URL.

Execution rules:

- Review returns a preview and makes no DOM changes.
- Fill only calls Page Agent with the selected non-empty field-value map and an
  explicit prohibition on submission, confirmation, or navigation.
- Autopilot waits through a cancellable three-second countdown, then allows one
  final submission after Page Agent verifies filled values.
- Page Agent is limited to 16 steps, the current tab, and the exact selected
  map.
- `ask_user` and arbitrary custom tools are disabled.
- A Page Agent failure stops and reports the error. It does not silently submit
  or switch to an unreviewed automation path.
- An exact deterministic DOM fallback may fill controls only when their keys
  match the selected map; it never submits.
- Undo restores every value changed by either execution path in the current
  document.

## Security and Privacy

- OpenAI and Exa keys remain server-side Vercel environment variables.
- The connector bundle contains no secret or access token and loads no remotely
  hosted executable code.
- The service worker accepts a closed set of message types.
- Cross-origin fetch is restricted to the fixed Mochi production origin.
- Host-page scripts cannot read the closed Shadow DOM or extension session
  storage.
- Captures are not synchronized to a Chrome account.
- Capture pixels clear on browser restart or explicit clear.
- Source URL/title metadata is sent only with Analyze.
- Autopilot remains opt-in and cancellable.

## Error Handling

- Unsupported page: explain the restriction and keep the tray usable.
- Missing content script after install/update: reinject once, then report.
- Capture permission failure: restore the pet and show Chrome's error.
- Capture larger than the bounded encoder target: reject without storing.
- Session quota failure: preserve existing captures and ask the user to remove
  one.
- Navigation during snip: cancel cleanly.
- Vercel failure: retain local captures and show the provider error.
- Malformed three-strategy response: reject instead of guessing.
- Page Agent failure: stop execution, retain strategy, and allow retry or exact
  fallback.

## Packaging and Installation

Root scripts:

```text
npm run extension:build
npm run extension:package
npm run extension:test
npm run test:e2e:extension
```

`extension:build` emits an unpacked connector at `extension/dist`.
`extension:package` creates
`public/downloads/mochi-connector.zip` from that exact output.

The Vercel installation section explains:

1. download and unzip;
2. open `chrome://extensions`;
3. enable Developer mode;
4. choose Load unpacked;
5. select the unzipped connector directory;
6. pin Mochi if desired.

## Testing

### Unit and component

- message validation rejects unknown and malformed commands;
- session reducer enforces eight captures and immutable updates;
- image bounds and size-budget decisions are deterministic;
- field discovery excludes sensitive and unsupported controls;
- Page Agent task construction omits empty values and respects each mode;
- side panel renders shared captures, three strategies, errors, and controls.

### Extension integration

A Playwright persistent Chromium context loads the unpacked connector and a
local production build. Tests prove:

- the pet appears on two separate HTTP tabs;
- switching tabs preserves the same tray;
- Capture page adds current-tab metadata and excludes the pet;
- repeated captures reach the bounded maximum;
- Snip area crops the frozen frame and `Escape` cancels;
- Review does not mutate;
- Fill changes supported fields and leaves unknown values blank;
- undo restores the page;
- Autopilot can be cancelled during countdown.

### Manual browser verification

Use a real Chrome window to:

- load the unpacked connector;
- click the pet;
- capture from at least two tabs;
- inspect both thumbnails and source labels;
- run live Vercel analysis;
- select a strategy;
- fill the active demo form;
- undo;
- inspect page and extension consoles for errors;
- capture desktop and side-panel screenshots for the build record.

## Acceptance Criteria

- The Vercel demo continues passing its existing unit and browser suites.
- The downloadable connector is built from committed source.
- Mochi is present on two eligible tabs without revisiting the Vercel page.
- One tray contains captures made on both tabs.
- Capture page and Snip area both work.
- The tray accepts eight bounded captures and rejects a ninth safely.
- Production analysis receives capture provenance and returns exactly three
  strategies.
- Alibaba Page Agent performs active-tab Fill only without submitting.
- Review, cancellation, unknown-value, and undo safeguards pass.
- No provider credential appears in tracked files or the extension archive.
- Lint, TypeScript, unit tests, extension tests, production build, and dependency
  audit complete with zero failures.

## Design Sources

- `frenzy2004/AUNTIE-SUP`: frozen screenshot, opaque selection surface, and
  crop-from-the-same-frame mechanics.
- Chrome Side Panel API: global panel continuity across tabs.
- Chrome Tabs API: `captureVisibleTab` and its two-calls-per-second bound.
- Chrome Storage API: 10 MB `storage.session` quota and browser-session
  lifecycle.
- Alibaba Page Agent: in-page DOM automation and optional multi-page extension
  architecture.
