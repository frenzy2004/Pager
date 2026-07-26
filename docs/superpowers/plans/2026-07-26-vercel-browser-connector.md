# Mochi Vercel Browser Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Vercel-hosted Mochi experience plus a load-unpacked Chrome connector that follows the user across eligible tabs, collects up to eight viewport or region captures, and uses Alibaba Page Agent to fill the active page safely.

**Architecture:** The Next.js app remains the only backend and holds OpenAI/Exa credentials. A Manifest V3 service worker owns global session state, visible-tab capture, and fixed-origin network calls; a small content script renders the per-tab pet and frozen snip surface; a global Chrome side panel renders the shared capture tray and execution controls. The Page Agent bundle is injected only when the user executes a selected strategy.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, Playwright, Chrome Manifest V3, esbuild, JSZip, `page-agent@1.12.2`, OpenAI SDK, Vercel.

## Global Constraints

- Keep provider keys on Vercel; never serialize them into the connector.
- Pin the service worker to `https://mochi-overlay.vercel.app`; never proxy an arbitrary URL.
- Accept only top-level HTTP/HTTPS pages and never inspect password, hidden, file, payment, or one-time-code inputs.
- Capture only the visible viewport. Region snips must crop from one frozen frame.
- Store no more than eight bounded JPEG data URLs in `chrome.storage.session`.
- Review mode must not mutate the page; Fill only must not submit; Autopilot gets one submit after a three-second countdown.
- Use Page Agent for semantic execution. Exact-map DOM filling is only a deterministic fallback.
- Add a failing automated test before every behavior change, then make only that test pass.
- Commit after each coherent task.

---

## Task 1: Add the connector build and package toolchain

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/build-extension.mjs`
- Create: `scripts/package-extension.mjs`
- Create: `extension/static/manifest.json`
- Create: `extension/static/sidepanel.html`
- Create: `extension/src/background.ts`
- Create: `extension/src/content/content.ts`
- Create: `extension/src/content/agent.ts`
- Create: `extension/src/sidepanel/main.tsx`
- Create: `extension/src/sidepanel/styles.css`
- Test: `scripts/extension-artifacts.test.ts`

- [ ] Write an artifact test that runs the build and package scripts, parses `extension/dist/manifest.json`, opens `public/downloads/mochi-connector.zip`, and asserts:

```ts
expect(manifest).toMatchObject({
  manifest_version: 3,
  minimum_chrome_version: "116",
  permissions: expect.arrayContaining(["activeTab", "scripting", "sidePanel", "storage"]),
});
expect(zip.file("manifest.json")).not.toBeNull();
```

- [ ] Run `npx vitest run scripts/extension-artifacts.test.ts` and confirm it fails because the scripts do not exist.
- [ ] Install pinned development dependencies with `npm install --save-dev esbuild@0.28.1 jszip@3.10.1`.
- [ ] Add scripts:

```json
"build:extension": "node scripts/build-extension.mjs",
"package:extension": "npm run build:extension && node scripts/package-extension.mjs",
"verify": "npm run lint && npm run typecheck && npm test && npm run build && npm run package:extension"
```

- [ ] Make `build-extension.mjs` empty `extension/dist`, copy static files, and bundle:

```js
await build({ entryPoints: {
  background: "extension/src/background.ts",
  content: "extension/src/content/content.ts",
  agent: "extension/src/content/agent.ts",
  sidepanel: "extension/src/sidepanel/main.tsx",
}, bundle: true, format: "iife", outdir: "extension/dist", target: "chrome116" });
```

- [ ] Make `package-extension.mjs` zip every file under `extension/dist` into `public/downloads/mochi-connector.zip`.
- [ ] Add the minimum valid MV3 manifest with content matching on `http://*/*` and `https://*/*`, a module-free service worker, global `side_panel.default_path`, and no remote code.
- [ ] Run the focused test and confirm it passes.
- [ ] Commit: `build: add Chrome connector pipeline`.

## Task 2: Define and test the shared connector protocol

**Files:**

- Create: `extension/src/shared/protocol.ts`
- Create: `extension/src/shared/session.ts`
- Test: `extension/src/shared/session.test.ts`

- [ ] Write tests for empty state, capture insertion, newest-first removal, eight-item eviction, strategy selection, execution mode changes, and clearing.
- [ ] Run `npx vitest run extension/src/shared/session.test.ts` and confirm red.
- [ ] Define these public types:

```ts
export type ExecutionMode = "review" | "fill" | "autopilot";
export interface CaptureItem {
  id: string;
  dataUrl: string;
  sourceUrl: string;
  sourceTitle: string;
  capturedAt: string;
  kind: "viewport" | "region";
}
export interface ConnectorSession {
  captures: CaptureItem[];
  taskHint: string;
  strategies: Strategy[];
  selectedStrategyId: string | null;
  executionMode: ExecutionMode;
  status: "idle" | "capturing" | "analyzing" | "ready" | "executing" | "error";
  error: string | null;
}
```

- [ ] Export a discriminated `ConnectorMessage` union for state, capture, snip, analysis, fields, execute, cancel, undo, and Page Agent proxy messages.
- [ ] Implement pure `reduceSession(state, action)` and `parseConnectorMessage(value)` helpers; enforce eight captures and data-URL/source-length limits.
- [ ] Run the focused tests and commit: `feat: define connector session protocol`.

## Task 3: Raise the Vercel analysis contract to eight sourced captures

**Files:**

- Modify: `src/lib/mochi/schema.ts`
- Modify: `src/lib/mochi/types.ts`
- Modify: `src/app/api/analyze/route.ts`
- Modify: `src/app/api/analyze/route.test.ts`
- Modify: `src/components/mochi/context-tray.tsx`
- Modify: `src/components/mochi/mochi-overlay.tsx`
- Modify: `src/components/mochi/mochi-overlay.test.tsx`

- [ ] Add failing API/UI tests showing eight captures are accepted and a ninth is rejected or disabled.
- [ ] Replace bare screenshot strings at the connector boundary with:

```ts
const captureSchema = z.object({
  dataUrl: z.string().startsWith("data:image/").max(850_000),
  sourceUrl: z.string().url().max(2_048),
  sourceTitle: z.string().max(300),
  capturedAt: z.string().datetime(),
  kind: z.enum(["viewport", "region"]),
});
```

- [ ] Preserve backward compatibility for the hosted demo’s existing screenshot payload while normalizing both forms to analysis image inputs.
- [ ] Update every three-capture guard, label, and counter to eight.
- [ ] Run focused route and overlay tests, then commit: `feat: accept eight sourced captures`.

## Task 4: Add the fixed-origin Page Agent chat proxy

**Files:**

- Create: `src/app/api/page-agent/chat/completions/route.ts`
- Create: `src/app/api/page-agent/chat/completions/route.test.ts`
- Modify: `.env.example`

- [ ] Use the `openai-docs` skill to confirm the current Chat Completions request/response contract used by Page Agent.
- [ ] Add failing tests for missing server key, oversized body, malformed messages, client model stripping, authorization stripping, and a successful OpenAI-compatible response.
- [ ] Implement `POST` with a one-megabyte raw-body ceiling and a narrow Zod request schema. Do not accept a destination URL.
- [ ] Forward only validated `messages`, `tools`, `tool_choice`, `parallel_tool_calls`, and supported sampling/reasoning fields:

```ts
await client.chat.completions.create({
  ...safeRequest,
  model: process.env.PAGE_AGENT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
  stream: false,
});
```

- [ ] Add `PAGE_AGENT_MODEL` documentation without a real key.
- [ ] Run the focused route tests and commit: `feat: proxy Page Agent through Vercel`.

## Task 5: Implement field discovery, exact fallback filling, and undo

**Files:**

- Create: `extension/src/content/fields.ts`
- Create: `extension/src/content/fields.test.ts`
- Create: `extension/src/content/exact-driver.ts`
- Create: `extension/src/content/exact-driver.test.ts`

- [ ] Add jsdom tests covering text, email, textarea, select, radio, checkbox, disabled, hidden, password, file, OTP/autocomplete, payment-like names, React input events, exact mappings, unknown fields, and undo.
- [ ] Implement:

```ts
export function discoverSafeFields(root: Document): SafeField[];
export function applyExactValues(
  root: Document,
  values: Record<string, string | boolean>,
): { changed: UndoEntry[]; skipped: string[] };
export function undoExactValues(root: Document, entries: UndoEntry[]): void;
```

- [ ] Use native value setters plus bubbling `input` and `change` events so controlled forms update.
- [ ] Run focused tests and commit: `feat: discover and safely fill page fields`.

## Task 6: Implement the service-worker coordinator

**Files:**

- Replace: `extension/src/background.ts`
- Create: `extension/src/background.test.ts`
- Create: `extension/src/shared/chrome.ts`
- Create: `extension/src/shared/image-policy.ts`
- Test: `extension/src/shared/image-policy.test.ts`

- [ ] Add failing tests using an injected Chrome adapter for install setup, pet-click panel opening, capture hide/restore ordering, session persistence, active-tab errors, fixed analysis URL, and fixed Page Agent URL.
- [ ] Implement constants:

```ts
export const MOCHI_ORIGIN = "https://mochi-overlay.vercel.app";
export const ANALYZE_URL = `${MOCHI_ORIGIN}/api/analyze`;
export const PAGE_AGENT_URL = `${MOCHI_ORIGIN}/api/page-agent/chat/completions`;
```

- [ ] On `CAPTURE_VIEWPORT`, hide Mochi, wait for acknowledgment, call `captureVisibleTab`, restore in `finally`, normalize the JPEG, and add source metadata.
- [ ] Forward only JSON POST requests to the two constants above. Return `{ status, statusText, headers, bodyText }` for Page Agent.
- [ ] Persist validated global state in `chrome.storage.session`; broadcast state changes to side panels.
- [ ] Run focused tests and commit: `feat: coordinate connector sessions and captures`.

## Task 7: Build the per-tab pet and frozen region snip

**Files:**

- Replace: `extension/src/content/content.ts`
- Create: `extension/src/content/content.test.ts`
- Create: `extension/src/content/pet.ts`
- Create: `extension/src/content/snip.ts`
- Create: `extension/src/content/snip.test.ts`

- [ ] Add tests for one closed-shadow host, pet click messaging, temporary visibility, capture cancellation, normalized reverse-direction drags, and the returned crop rectangle.
- [ ] Mount a fixed bottom-right Mochi button inside a closed shadow root and send `OPEN_PANEL` when clicked.
- [ ] Implement AUNTIE-SUP’s frozen-frame interaction:

```ts
export function normalizeRect(start: Point, end: Point): Rect;
export async function runFrozenSnip(dataUrl: string): Promise<Rect | null>;
```

- [ ] The service worker captures once with the pet hidden; the content script then covers the viewport with that exact opaque image, lets the user drag a region, and returns CSS-pixel bounds with device-pixel ratio.
- [ ] Escape/right-click cancels, zero-size drags reject, and cleanup always restores the page.
- [ ] Run focused tests and commit: `feat: add persistent pet and frozen snipping`.

## Task 8: Build the global side panel

**Files:**

- Replace: `extension/src/sidepanel/main.tsx`
- Create: `extension/src/sidepanel/App.tsx`
- Replace: `extension/src/sidepanel/styles.css`
- Create: `extension/src/sidepanel/App.test.tsx`

- [ ] Add failing interaction tests for cross-tab shared state, Capture page, Snip area, remove/clear, Analyze, exactly three strategy cards, Review/Fill only/Autopilot, Execute, Cancel, Undo, and unsupported pages.
- [ ] Implement a compact side panel that subscribes to `SESSION_UPDATED`, requests `GET_SESSION` on mount, and sends typed messages for all controls.
- [ ] Show capture thumbnails with title, hostname, capture kind, and `n / 8`.
- [ ] Require a selected strategy before Execute and show the safeguards beside each mode.
- [ ] Run focused tests and commit: `feat: add global Mochi side panel`.

## Task 9: Inject and run Alibaba Page Agent on demand

**Files:**

- Replace: `extension/src/content/agent.ts`
- Create: `extension/src/content/agent.test.ts`
- Create: `src/lib/mochi/page-agent-task.ts`
- Create: `src/lib/mochi/page-agent-task.test.ts`
- Modify: `src/lib/mochi/action-driver.ts`
- Modify: `src/lib/mochi/action-driver.test.ts`

- [ ] Extract and test one shared task-builder contract from the hosted driver.
- [ ] Add failing connector tests asserting `new PageAgent(...)` receives `maxSteps: 16`, no API key, and a custom fetch that messages the service worker.
- [ ] Configure:

```ts
const agent = new PageAgent({
  model: "gpt-5.6-sol",
  baseURL: "https://mochi-overlay.vercel.app/api/page-agent",
  apiKey: "",
  maxSteps: 16,
  customFetch: proxyFetch,
});
```

- [ ] In Review mode, return discovered-field previews without `agent.execute`.
- [ ] In Fill only, instruct Page Agent to fill but never submit.
- [ ] In Autopilot, show a cancelable three-second countdown, permit one submit, and stop at sixteen steps.
- [ ] Disable `ask_user`; cancel via `AbortController`; retain exact-map fallback only when the selected strategy contains exact field values.
- [ ] Run focused tests and commit: `feat: execute strategies with Alibaba Page Agent`.

## Task 10: Publish connector onboarding in the Vercel app

**Files:**

- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/demo/product-demo.tsx`
- Modify: `src/components/demo/product-demo.test.tsx`
- Modify: `README.md`
- Modify: `docs/PRODUCT_SPEC.md`

- [ ] Add a failing component test for a visible “Use Mochi across tabs” section, download link, and three load-unpacked setup steps.
- [ ] Add the section without weakening the existing “no extension needed for this live demo” message.
- [ ] Link `/downloads/mochi-connector.zip`, explain Chrome 116+, and state that screenshots remain local until Analyze.
- [ ] Update README and product spec with build/package/install commands and Page Agent architecture.
- [ ] Run focused tests and commit: `feat: add connector download onboarding`.

## Task 11: Add and run real Chrome integration coverage

**Files:**

- Create: `e2e/fixtures/form-a.html`
- Create: `e2e/fixtures/context-b.html`
- Create: `e2e/connector.spec.ts`
- Modify: `playwright.config.ts`

- [ ] Launch persistent Chromium with:

```ts
args: [
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
];
```

- [ ] Test that the pet appears on two separate HTTP tabs, the same global session is visible after switching tabs, two viewport captures accumulate, a region snip can be dragged, analysis renders three strategies, Fill only updates the test form, and Undo restores it.
- [ ] Stub only the Vercel network boundary for deterministic CI; assert the Page Agent proxy was called during Execute.
- [ ] Run `npm run package:extension && npx playwright test e2e/connector.spec.ts`.
- [ ] Commit: `test: cover the connector across Chrome tabs`.

## Task 12: Verify, deploy, and click the production experience

**Files:**

- Modify: `docs/BUILD_LOG.md`

- [ ] Use `vercel:react-best-practices` to review changed TSX and fix findings.
- [ ] Run fresh gates:

```bash
npm run lint
npm run typecheck
npm test
npm run package:extension
npm run build
npm audit --audit-level=high
npx playwright test
```

- [ ] Inspect the zip for source maps, secrets, `.env` files, and unexpected hosts.
- [ ] Use the `superpowers:verification-before-completion` skill and record exact results in `docs/BUILD_LOG.md`.
- [ ] Commit: `docs: record connector verification`.
- [ ] Use the `superpowers:finishing-a-development-branch` skill to integrate the feature branch safely.
- [ ] Push the integrated commit to GitHub and deploy the saved source state to the existing Vercel project.
- [ ] Use browser automation to click the production landing page, download the zip, load `extension/dist` in Chrome, switch between two real tabs, capture multiple times, run a fill, and verify undo.
- [ ] Check the production deployment status and report the GitHub commit, Vercel URL, test counts, and any platform limitation.
