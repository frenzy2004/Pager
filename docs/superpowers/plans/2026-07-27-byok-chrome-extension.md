# Mochi BYOK Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a load-unpacked Chrome extension whose user enters one OpenAI key, optionally enters one Exa key, and can then capture context across tabs, receive three strategies, and fill forms through Alibaba Page Agent without sending extension AI traffic through Mochi's Vercel APIs.

**Architecture:** The Manifest V3 service worker becomes the trusted BYOK runtime: it restricts local credential storage, calls fixed OpenAI/Exa endpoints, coordinates multi-tab session state, and validates Page Agent requests. The side panel owns first-run setup and user controls, while content scripts remain credential-free and retain capture, field discovery, Page Agent, fallback, submission guard, and Undo behavior. Vercel remains the landing page, live embedded demo, current extension archive, and installation guide.

**Tech Stack:** Chrome Manifest V3 (Chrome 116+), TypeScript 5.9, React 19, Next.js 16, Vitest 4, Testing Library, Playwright 1.62, esbuild, JSZip, Zod 4, OpenAI Responses API, OpenAI Chat Completions API, Exa Search API, `page-agent@1.12.2`, Vercel.

## Global Constraints

- OpenAI is required; Exa is optional and its absence or failure must not block OpenAI-only analysis.
- The first-run setup asks only for provider keys; the fixed model is `gpt-5.6-sol`.
- User keys are stored only in `chrome.storage.local` after calling `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`; never use `chrome.storage.sync`.
- Raw keys never enter `ConnectorSession`, content scripts, page DOM, logs, runtime responses, Vercel requests, or built artifacts.
- Extension provider destinations are fixed to `https://api.openai.com/*` and `https://api.exa.ai/*`; no runtime message may choose a URL or model.
- Keep the existing global side panel, eight-capture `chrome.storage.session` tray, frozen viewport snipping, exactly three strategies, active-document validation, and bounded Page Agent execution.
- Review mutates nothing; Fill only cannot submit; Autopilot retains the cancellable three-second countdown and one guarded submission; Undo retains its current safety checks.
- The extension sends no analysis, connector-session, or Page Agent request to `mochi-overlay.vercel.app`.
- The Vercel page must say that the website alone cannot follow the user across tabs and that the installed extension requires the user's OpenAI key.
- Automated tests use fixture provider responses and never require or persist a real API key.
- Add a failing test before each behavior change, run it red, make the minimum implementation pass, and commit each coherent task.

---

## File and Interface Map

### New focused units

- `extension/src/shared/provider-settings.ts` — provider credential types, input validation, persisted validation state, and sanitized status conversion.
- `extension/src/shared/provider-settings.test.ts` — pure credential-state tests.
- `extension/src/providers/openai.ts` — fixed-origin OpenAI model check, Responses analysis call, response-text extraction, and sanitized provider errors.
- `extension/src/providers/openai.test.ts` — OpenAI request/response and error tests.
- `extension/src/providers/exa.ts` — fixed-origin optional key test and three-result moderated search.
- `extension/src/providers/exa.test.ts` — Exa request/fallback tests.
- `extension/src/providers/analysis.ts` — prompt/schema, OpenAI → optional Exa → OpenAI orchestration, and exact three-strategy normalization.
- `extension/src/providers/analysis.test.ts` — single-pass, research, invalid-output, and missing-personal-fact tests.
- `extension/src/providers/page-agent-policy.ts` — browser-safe validation and sanitization of Alibaba Page Agent's request envelope.
- `extension/src/providers/page-agent-policy.test.ts` — altered prompt/tool/model/step/body rejection tests.

### Existing units modified in place

- `extension/src/shared/protocol.ts` — typed field manifest, credential-status messages, and no raw-key response types.
- `extension/src/shared/session.ts` — parses new credential messages but keeps credentials outside session state.
- `extension/src/shared/chrome.ts` — restricted local provider storage; remove install-ID storage.
- `extension/src/background.ts` — remove Vercel connector authorization and call provider modules directly.
- `extension/src/background.test.ts` — provider setup, sender isolation, direct analysis, key clearing, and Page Agent direct-call coverage.
- `extension/src/sidepanel/App.tsx` — setup gate and Settings view.
- `extension/src/sidepanel/App.test.tsx` — first-run, invalid key, optional Exa, replace/retest/clear tests.
- `extension/src/sidepanel/styles.css` — setup/settings styling.
- `extension/static/manifest.json` — provider host permissions.
- `scripts/extension-artifacts.test.ts` — manifest and no-secret/no-Vercel-runtime assertions.
- `tests/e2e/connector.spec.ts` — real unpacked-extension BYOK and multi-tab workflow with intercepted provider endpoints.
- `src/components/demo/product-demo.tsx` — accurate extension/BYOK installation copy.
- `src/components/demo/product-demo.test.tsx` — copy and install-step contract.
- `README.md` and `docs/BUILD_LOG.md` — current BYOK architecture and verified release evidence.

### Units removed from the extension path

- `extension/src/shared/proof-of-work.ts`
- `extension/src/shared/proof-of-work.test.ts`

The Vercel demo analysis route remains available to the embedded demo; the extension simply stops using the connector session and Page Agent proxy routes.

---

### Task 1: Define restricted provider settings and credential messages

**Files:**

- Create: `extension/src/shared/provider-settings.ts`
- Create: `extension/src/shared/provider-settings.test.ts`
- Modify: `extension/src/shared/protocol.ts`
- Modify: `extension/src/shared/session.ts`
- Modify: `extension/src/shared/session.test.ts`
- Modify: `extension/src/shared/chrome.ts`
- Modify: `extension/src/background.test.ts`

**Interfaces:**

- Produces:

```ts
export type ValidationState = "untested" | "valid" | "invalid";

export interface ProviderValidation {
  status: ValidationState;
  checkedAt?: string;
}

export interface ProviderSettings {
  version: 1;
  openAIApiKey: string;
  openAIValidation: ProviderValidation;
  exaApiKey?: string;
  exaValidation?: ProviderValidation;
}

export interface ProviderStatus {
  configured: boolean;
  openAI: "missing" | ValidationState;
  exa: "missing" | ValidationState;
}

export function createUntestedProviderSettings(
  input: { openAIApiKey: string; exaApiKey?: string },
): ProviderSettings;
export function parseProviderSettings(value: unknown): ProviderSettings | null;
export function providerStatus(settings: ProviderSettings | null): ProviderStatus;
export function markProviderValidation(
  settings: ProviderSettings,
  provider: "openAI" | "exa",
  status: ValidationState,
  checkedAt: string,
): ProviderSettings;
```

- Extends `ChromeAdapter` with:

```ts
restrictLocalStorage(): Promise<void>;
getProviderSettings(): Promise<ProviderSettings | null>;
setProviderSettings(settings: ProviderSettings): Promise<void>;
clearProviderSettings(): Promise<void>;
```

- Extends `ConnectorMessage` with:

```ts
| { type: "GET_PROVIDER_STATUS" }
| {
    type: "SAVE_AND_TEST_PROVIDER_SETTINGS";
    openAIApiKey: string;
    exaApiKey?: string;
  }
| { type: "RETEST_PROVIDER_SETTINGS" }
| { type: "CLEAR_PROVIDER_SETTINGS" }
```

- [ ] **Step 1: Write failing pure-state tests**

```ts
it("trims keys, persists no empty Exa key, and reports untested", () => {
  const settings = createUntestedProviderSettings({
    openAIApiKey: "  sk-openai-test  ",
    exaApiKey: "   ",
  });
  expect(settings).toEqual({
    version: 1,
    openAIApiKey: "sk-openai-test",
    openAIValidation: { status: "untested" },
  });
  expect(providerStatus(settings)).toEqual({
    configured: false,
    openAI: "untested",
    exa: "missing",
  });
});

it("never places raw keys in sanitized status", () => {
  expect(JSON.stringify(providerStatus(validSettings))).not.toContain("sk-");
});
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `npx vitest run extension/src/shared/provider-settings.test.ts extension/src/shared/session.test.ts`

Expected: FAIL because the provider settings module and credential messages do not exist.

- [ ] **Step 3: Implement strict settings parsing and status conversion**

Accept trimmed keys from 8 to 512 characters, reject control characters, allow a missing/blank Exa value, require version `1`, and never export a masking helper that contains key fragments. `configured` is true only for persisted OpenAI status `valid`.

- [ ] **Step 4: Add credential message parsing tests**

```ts
expect(parseConnectorMessage({
  type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
  openAIApiKey: "sk-openai-test",
  exaApiKey: "exa-test",
})).toEqual({
  type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
  openAIApiKey: "sk-openai-test",
  exaApiKey: "exa-test",
});
expect(parseConnectorMessage({
  type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
  openAIApiKey: "x".repeat(513),
})).toBeNull();
```

- [ ] **Step 5: Implement restricted local storage in the adapter**

```ts
const PROVIDER_SETTINGS_KEY = "mochi-provider-settings";

async restrictLocalStorage() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
},
async getProviderSettings() {
  const stored = await chrome.storage.local.get(PROVIDER_SETTINGS_KEY);
  return parseProviderSettings(stored[PROVIDER_SETTINGS_KEY]);
},
async setProviderSettings(settings) {
  await chrome.storage.local.set({ [PROVIDER_SETTINGS_KEY]: settings });
},
async clearProviderSettings() {
  await chrome.storage.local.remove(PROVIDER_SETTINGS_KEY);
},
```

Delete `getInstallId` and `setInstallId`; no connector authorization will need them.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run extension/src/shared/provider-settings.test.ts extension/src/shared/session.test.ts extension/src/background.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/shared/provider-settings.ts extension/src/shared/provider-settings.test.ts extension/src/shared/protocol.ts extension/src/shared/session.ts extension/src/shared/session.test.ts extension/src/shared/chrome.ts extension/src/background.test.ts
git commit -m "feat: add restricted BYOK provider settings"
```

### Task 2: Add fixed-origin OpenAI/Exa analysis providers

**Files:**

- Create: `extension/src/providers/openai.ts`
- Create: `extension/src/providers/openai.test.ts`
- Create: `extension/src/providers/exa.ts`
- Create: `extension/src/providers/exa.test.ts`
- Create: `extension/src/providers/analysis.ts`
- Create: `extension/src/providers/analysis.test.ts`
- Modify: `extension/src/shared/protocol.ts`

**Interfaces:**

- Consumes: `CaptureItem`, `Strategy`, `ProviderSettings`, and a typed field manifest from Task 1.
- Produces:

```ts
export const OPENAI_MODEL = "gpt-5.6-sol";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const OPENAI_MODEL_URL =
  "https://api.openai.com/v1/models/gpt-5.6-sol";
export const EXA_SEARCH_URL = "https://api.exa.ai/search";

export interface ProviderAnalysisInput {
  preset: Preset;
  taskHint: string;
  screenshots: CaptureItem[];
  fields: FieldDescriptor[];
}

export type ProviderFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export async function testOpenAIKey(
  apiKey: string,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<void>;
export async function askOpenAI(
  apiKey: string,
  input: ProviderAnalysisInput,
  evidence: ResearchSource[],
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<ModelAnalysis>;
export async function testExaKey(
  apiKey: string,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<void>;
export async function searchExa(
  query: string,
  apiKey: string,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<ResearchSource[]>;
export async function runProviderAnalysis(
  input: ProviderAnalysisInput,
  settings: ProviderSettings,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<{
  strategies: [Strategy, Strategy, Strategy];
  notice: string;
}>;
```

- [ ] **Step 1: Write failing OpenAI client tests**

```ts
it("tests only the fixed model URL and never serializes the key", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  await testOpenAIKey("sk-secret", fetcher, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.openai.com/v1/models/gpt-5.6-sol",
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer sk-secret" }),
    }),
  );
  expect(JSON.stringify(fetcher.mock.calls[0]?.[1]?.body ?? "")).not.toContain("sk-secret");
});

it.each([
  [401, "OpenAI rejected this key. Replace it in Settings."],
  [403, "This key cannot use Mochi's model."],
  [429, "OpenAI rate limit or project quota reached."],
])("maps %s without leaking provider bodies", async (status, message) => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response('{"error":{"message":"secret provider detail"}}', { status }),
  );
  await expect(
    testOpenAIKey("sk-secret", fetcher, new AbortController().signal),
  ).rejects.toThrow(message);
});
```

- [ ] **Step 2: Run OpenAI tests and verify red**

Run: `npx vitest run extension/src/providers/openai.test.ts`

Expected: FAIL because the provider client does not exist.

- [ ] **Step 3: Implement bounded OpenAI requests**

The Responses body must force:

```ts
{
  model: OPENAI_MODEL,
  max_output_tokens: 3000,
  reasoning: { effort: "low" },
  input: [{
    role: "user",
    content: [
      { type: "input_text", text: prompt },
      ...screenshots.map(({ dataUrl }) => ({
        type: "input_image",
        image_url: dataUrl,
        detail: "high",
      })),
    ],
  }],
  text: {
    format: {
      type: "json_schema",
      name: "mochi_analysis",
      strict: true,
      schema: MODEL_ANALYSIS_JSON_SCHEMA,
    },
  },
}
```

Extract only `output[].content[]` items with `type === "output_text"`, parse JSON once, validate it with Zod, and map only sanitized status-specific errors. Use the caller's abort signal; the coordinator owns the timeout.

- [ ] **Step 4: Write failing Exa tests**

```ts
it("uses one moderated fast result to test an optional key", async () => {
  await testExaKey("exa-secret", fetcher, signal);
  expect(fetcher).toHaveBeenCalledWith(
    EXA_SEARCH_URL,
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-api-key": "exa-secret" }),
      body: JSON.stringify({
        query: "OpenAI",
        type: "fast",
        numResults: 1,
        moderation: true,
      }),
    }),
  );
});
```

- [ ] **Step 5: Implement the Exa client**

Use `type: "fast"`, `moderation: true`, at most three results, and highlight content bounded to 1,200 characters. Parse only `title`, `url`, `highlights`, and `text`.

- [ ] **Step 6: Write failing orchestration tests**

Cover: no Exa key makes one OpenAI call; a research query plus valid Exa makes OpenAI → Exa → OpenAI; Exa failure returns the first OpenAI result and fallback notice; missing strategies and unknown field keys are rejected; unsupported personal facts remain `needs-input`.

- [ ] **Step 7: Implement analysis prompt, schema, and normalization**

Port the existing prompt and normalization behavior from `src/lib/mochi/analyze-live.ts`, but return only exact field keys and exact strategy IDs in `safe`, `balanced`, `standout` order.

- [ ] **Step 8: Run provider tests**

Run: `npx vitest run extension/src/providers/openai.test.ts extension/src/providers/exa.test.ts extension/src/providers/analysis.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add extension/src/providers extension/src/shared/protocol.ts
git commit -m "feat: analyze context with local provider keys"
```

### Task 3: Wire provider setup and direct analysis into the service worker

**Files:**

- Modify: `extension/src/background.ts`
- Modify: `extension/src/background.test.ts`
- Modify: `extension/src/shared/chrome.ts`
- Delete: `extension/src/shared/proof-of-work.ts`
- Delete: `extension/src/shared/proof-of-work.test.ts`

**Interfaces:**

- Consumes provider modules and storage interfaces from Tasks 1–2.
- `createBackgroundCoordinator` keeps dependency injection:

```ts
interface CoordinatorDependencies {
  chrome: ChromeAdapter;
  delay(milliseconds: number): Promise<void>;
  fetch: ProviderFetch;
  normalizeImage(dataUrl: string): Promise<string>;
  now?: () => Date;
  randomId?: () => string;
}

handle(
  rawMessage: unknown,
  sender?: { id?: string; url?: string },
): Promise<unknown>;
```

- [ ] **Step 1: Replace server-token tests with failing BYOK tests**

Add coverage that:

```ts
await coordinator.handle({ type: "GET_PROVIDER_STATUS" }, sidePanelSender);
expect(result).toEqual({
  configured: false,
  openAI: "missing",
  exa: "missing",
});

await expect(
  coordinator.handle({
    type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
    openAIApiKey: "sk-secret",
  }, { id: extensionId, url: "https://host-page.test/form" }),
).rejects.toThrow("Mochi settings can only be changed from the extension.");
```

Also assert that a valid Save & test persists only after sanitized validation state is computed, invalid OpenAI remains locked, invalid Exa keeps OpenAI valid, Clear aborts an active request, Analyze calls OpenAI directly, and no call URL contains `mochi-overlay.vercel.app`.

- [ ] **Step 2: Run the focused background tests and verify red**

Run: `npx vitest run extension/src/background.test.ts`

Expected: FAIL against Vercel connector-session/analyze behavior.

- [ ] **Step 3: Implement provider setup handlers**

Accept credential mutations only when:

```ts
sender?.id === extensionId &&
sender.url?.startsWith(`chrome-extension://${extensionId}/`)
```

`SAVE_AND_TEST_PROVIDER_SETTINGS` creates untested settings, tests OpenAI, tests Exa only when present, persists `checkedAt` states, and returns only `ProviderStatus`. `RETEST_PROVIDER_SETTINGS` loads raw settings inside the worker and repeats the tests. `CLEAR_PROVIDER_SETTINGS` increments a credential revision, aborts active provider controllers, clears storage, and returns missing status.

- [ ] **Step 4: Replace Vercel analysis with direct provider analysis**

Remove `MOCHI_ORIGIN`, `ANALYZE_URL`, `CONNECTOR_SESSION_URL`, connector token/install ID/proof-of-work state, and request retry logic. `analyze()` loads a valid OpenAI setting, runs `runProviderAnalysis`, preserves the existing context-generation race checks, and stores only the three strategies.

- [ ] **Step 5: Restrict storage on install and startup**

```ts
async function initializeExtension() {
  await chromeAdapter.restrictLocalStorage();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  if (!(await chromeAdapter.getSession())) {
    await chromeAdapter.setSession(createEmptySession());
  }
}

chrome.runtime.onInstalled.addListener(() => void initializeExtension());
chrome.runtime.onStartup.addListener(() => void initializeExtension());
void chromeAdapter.restrictLocalStorage();
```

Pass `sender` through the runtime listener to `coordinator.handle`.

- [ ] **Step 6: Remove proof-of-work files and run focused tests**

Run: `npx vitest run extension/src/background.test.ts extension/src/shared/provider-settings.test.ts extension/src/shared/session.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/background.ts extension/src/background.test.ts extension/src/shared/chrome.ts extension/src/shared/proof-of-work.ts extension/src/shared/proof-of-work.test.ts
git commit -m "feat: run BYOK analysis in the extension"
```

### Task 4: Validate and send Page Agent requests directly to OpenAI

**Files:**

- Create: `extension/src/providers/page-agent-policy.ts`
- Create: `extension/src/providers/page-agent-policy.test.ts`
- Modify: `extension/src/providers/openai.ts`
- Modify: `extension/src/providers/openai.test.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background.test.ts`
- Modify: `extension/src/content/agent.ts`
- Modify: `extension/src/content/agent.test.ts`

**Interfaces:**

- Produces:

```ts
export async function sanitizePageAgentRequest(
  rawBody: string,
): Promise<{
  messages: Array<{ role: "system" | "user"; content: string }>;
  tools: unknown[];
  tool_choice: { type: "function"; function: { name: "AgentOutput" } };
  parallel_tool_calls: false;
  max_completion_tokens: 1200;
  model: typeof OPENAI_MODEL;
  reasoning_effort: "none";
  stream: false;
  verbosity: "low";
}>;

export async function completePageAgent(
  apiKey: string,
  safeBody: SafePageAgentRequest,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<PageAgentFetchResponse>;
```

- [ ] **Step 1: Write failing request-policy tests**

Create one captured valid Page Agent request fixture, then mutate it to prove rejection of:

- a third message;
- a changed system prompt hash;
- missing Mochi system instructions;
- a seventh task line or step 17;
- field maps over 30 keys or values over 6,000 characters;
- a tool other than the exact `AgentOutput` schema;
- a body over 250,000 bytes;
- a client-supplied URL, authorization, model, stream, or extra tool.

```ts
const safe = await sanitizePageAgentRequest(JSON.stringify(validEnvelope));
expect(safe).toMatchObject({
  model: "gpt-5.6-sol",
  parallel_tool_calls: false,
  max_completion_tokens: 1200,
  reasoning_effort: "none",
  stream: false,
  verbosity: "low",
});
```

- [ ] **Step 2: Run policy tests and verify red**

Run: `npx vitest run extension/src/providers/page-agent-policy.test.ts`

Expected: FAIL because the browser-side policy does not exist.

- [ ] **Step 3: Port the existing route policy without Node APIs**

Port the strict request schema and six-line task validation from `src/app/api/page-agent/chat/completions/route.ts`. Use `crypto.subtle.digest("SHA-256", ...)` for the fixed Page Agent system-prompt hash, and `canonicalJson` plus the existing fixed tool-schema hash. Return a newly constructed safe object; never spread the client body.

- [ ] **Step 4: Add failing direct Page Agent HTTP tests**

Assert `completePageAgent` calls only `https://api.openai.com/v1/chat/completions`, adds the key only as `Authorization`, returns status/body/selected safe headers, maps 401/403/429 without provider details, and never retries with a stale key.

- [ ] **Step 5: Implement direct Page Agent completion**

Use the sanitized request object and return only:

```ts
{
  status: response.status,
  statusText: response.statusText,
  headers: {
    "content-type": response.headers.get("content-type") ?? "application/json",
  },
  bodyText: await response.text(),
}
```

- [ ] **Step 6: Replace background Page Agent proxying**

`FETCH_PAGE_AGENT` keeps execution-lease and active-tab checks, loads a valid OpenAI setting, sanitizes the content-script body, calls OpenAI directly, rechecks execution state, and cancels the page executor if the tab changed. Delete all connector-token retry behavior.

- [ ] **Step 7: Keep content Page Agent credential-free**

Retain `apiKey: ""`, `customFetch`, `maxSteps: 16`, disabled click/ask/script tools, exact model, and existing execution controls. Add a test proving no `sk-` value or provider key message reaches `createAgent`.

- [ ] **Step 8: Run focused Page Agent tests**

Run: `npx vitest run extension/src/providers/page-agent-policy.test.ts extension/src/providers/openai.test.ts extension/src/background.test.ts extension/src/content/agent.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add extension/src/providers/page-agent-policy.ts extension/src/providers/page-agent-policy.test.ts extension/src/providers/openai.ts extension/src/providers/openai.test.ts extension/src/background.ts extension/src/background.test.ts extension/src/content/agent.ts extension/src/content/agent.test.ts
git commit -m "feat: run Page Agent with the user's OpenAI key"
```

### Task 5: Add first-run setup and Settings to the side panel

**Files:**

- Modify: `extension/src/sidepanel/App.tsx`
- Modify: `extension/src/sidepanel/App.test.tsx`
- Modify: `extension/src/sidepanel/styles.css`

**Interfaces:**

- Consumes the four provider-setting runtime messages and `ProviderStatus`.
- Adds no raw-key read message; replacement fields always initialize as empty.

- [ ] **Step 1: Write failing setup interaction tests**

```tsx
it("shows one required OpenAI key and optional Exa key on first use", async () => {
  render(<App runtime={runtimeWithStatus({
    configured: false,
    openAI: "missing",
    exa: "missing",
  })} />);
  expect(await screen.findByLabelText(/openai api key/i)).toHaveAttribute("type", "password");
  expect(screen.getByLabelText(/exa api key.*optional/i)).toHaveAttribute("type", "password");
  expect(screen.queryByRole("button", { name: /analyze context/i })).not.toBeInTheDocument();
});

it("sends keys once and unlocks only after valid OpenAI status", async () => {
  await user.type(screen.getByLabelText(/openai api key/i), "sk-test");
  await user.click(screen.getByRole("button", { name: /save & test/i }));
  expect(runtime.sendMessage).toHaveBeenCalledWith({
    type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
    openAIApiKey: "sk-test",
  });
  expect(await screen.findByRole("button", { name: /capture page/i })).toBeVisible();
});
```

Also cover invalid OpenAI, absent/invalid Exa still unlocking OpenAI-only use, Settings open/close, Retest, Replace keys, Clear keys, no raw saved-key display, and sanitized errors.

- [ ] **Step 2: Run side-panel tests and verify red**

Run: `npx vitest run extension/src/sidepanel/App.test.tsx`

Expected: FAIL because the panel always renders mission/capture controls.

- [ ] **Step 3: Implement provider-status bootstrap**

On mount, request `GET_PROVIDER_STATUS` and `GET_SESSION` independently. Render a small loading shell until status resolves. If `configured` is false, render `ProviderSetup`; otherwise render the current Mochi workflow.

- [ ] **Step 4: Implement setup and Settings UI**

Use password inputs with autocomplete disabled, local controlled values, and clear them after each request. Copy:

- "Add your own key"
- "OpenAI is required. Exa is optional public-web research."
- "Stored only in this Chrome profile and sent directly to the provider."
- "For this personal unpacked extension, use a revocable project key with a spending limit."

Settings shows status words only, not suffixes or key fragments. `Clear keys` returns immediately to setup but preserves capture session state.

- [ ] **Step 5: Add compact styles**

Reuse Mochi's current colors, rounded controls, status lights, and typography. Ensure all inputs and actions are keyboard accessible, error text uses `role="alert"`, and links open in a new tab.

- [ ] **Step 6: Run component and type tests**

Run: `npx vitest run extension/src/sidepanel/App.test.tsx`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/sidepanel/App.tsx extension/src/sidepanel/App.test.tsx extension/src/sidepanel/styles.css
git commit -m "feat: add BYOK setup to the Mochi panel"
```

### Task 6: Update manifest, packaging, landing page, and documentation

**Files:**

- Modify: `extension/static/manifest.json`
- Modify: `scripts/extension-artifacts.test.ts`
- Modify: `src/components/demo/product-demo.tsx`
- Modify: `src/components/demo/product-demo.test.tsx`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/BUILD_LOG.md`

**Interfaces:**

- Manifest must retain page matches and add:

```json
"host_permissions": [
  "http://*/*",
  "https://*/*",
  "https://api.openai.com/*",
  "https://api.exa.ai/*"
]
```

- [ ] **Step 1: Write failing artifact and landing-copy tests**

```ts
expect(manifest.host_permissions).toEqual(expect.arrayContaining([
  "https://api.openai.com/*",
  "https://api.exa.ai/*",
]));
expect(backgroundBundle).not.toContain("mochi-overlay.vercel.app/api/");
expect(allArchiveText).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
```

```tsx
expect(screen.getByText(/enter your own openai key inside mochi/i)).toBeInTheDocument();
expect(screen.getByText(/website alone cannot follow you into other tabs/i)).toBeInTheDocument();
expect(screen.getByText(/exa is optional/i)).toBeInTheDocument();
expect(screen.queryByText(/no browser api key/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `npx vitest run scripts/extension-artifacts.test.ts src/components/demo/product-demo.test.tsx`

Expected: FAIL on old server-backed manifest/copy.

- [ ] **Step 3: Update the manifest**

Keep Manifest V3, Chrome 116, global side panel, content scripts, and bundled code. Declare fixed provider hosts explicitly. Do not add externally connectable pages or remote code.

- [ ] **Step 4: Rewrite connector onboarding**

Primary action: **Download Chrome extension**.

Badges: **CHROME 116+**, **8 CAPTURES**, **YOUR OPENAI KEY**.

Installation steps:

1. Download and unzip.
2. Open `chrome://extensions`, enable Developer mode, and Load unpacked.
3. Open Mochi, enter OpenAI key, optionally enter Exa, and press Save & test.

Keep "No extension needed for this live demo" only beside the embedded Vercel demo so it cannot be confused with the cross-tab product.

- [ ] **Step 5: Update README and environment guidance**

Document that `.env.local` keys configure only the separate Vercel live demo. Replace the Page Agent bridge section with the direct service-worker flow, local-key warning, optional Exa behavior, key clearing, and build/install instructions. Remove `MOCHI_CONNECTOR_SECRET` from the required extension instructions but leave any server-route compatibility variable in `.env.example` clearly marked legacy/demo-only if the route remains.

- [ ] **Step 6: Build and run focused tests**

Run: `npm run package:extension`

Run: `npx vitest run scripts/extension-artifacts.test.ts src/components/demo/product-demo.test.tsx`

Expected: PASS and regenerate `public/downloads/mochi-connector.zip`.

- [ ] **Step 7: Commit**

```bash
git add extension/static/manifest.json scripts/extension-artifacts.test.ts src/components/demo/product-demo.tsx src/components/demo/product-demo.test.tsx README.md .env.example docs/BUILD_LOG.md public/downloads/mochi-connector.zip
git commit -m "docs: publish the BYOK Chrome onboarding"
```

### Task 7: Replace connector E2E fixtures with the complete BYOK workflow

**Files:**

- Modify: `tests/e2e/connector.spec.ts`
- Modify: `playwright.config.ts` only if the existing extension project cannot intercept service-worker requests deterministically.
- Modify: `docs/BUILD_LOG.md`

**Interfaces:**

- Uses the built unpacked extension at `extension/dist`.
- Provider fixtures intercept only:
  - `https://api.openai.com/v1/models/gpt-5.6-sol`
  - `https://api.openai.com/v1/responses`
  - `https://api.openai.com/v1/chat/completions`
  - `https://api.exa.ai/search`

- [ ] **Step 1: Rewrite the E2E test to fail against the server-backed build**

Delete connector-session and Mochi Vercel API routes. Add:

```ts
await panel.getByLabel(/openai api key/i).fill("sk-e2e-openai");
await panel.getByLabel(/exa api key.*optional/i).fill("exa-e2e");
await panel.getByRole("button", { name: /save & test/i }).click();
await expect(panel.getByRole("button", { name: /capture page/i })).toBeVisible();
```

Record every network URL and assert at the end:

```ts
expect(observedUrls.some((url) =>
  url.includes("mochi-overlay.vercel.app/api/")
)).toBe(false);
```

- [ ] **Step 2: Run the extension E2E and verify red**

Run: `npm run build && npx playwright test tests/e2e/connector.spec.ts --project=chromium`

Expected: FAIL because first-run setup and direct provider traffic are absent.

- [ ] **Step 3: Add deterministic provider fixtures**

The first Responses call returns a strict analysis with `researchQuery`; Exa returns one source; the second Responses call returns three sourced strategies. Chat Completions retains the existing two-step `AgentOutput` fixture that types `Jamie Chen` and finishes without submission.

- [ ] **Step 4: Cover the full browser story**

In one persistent Chromium context:

1. Setup and test OpenAI + Exa.
2. Open profile and form fixture tabs.
3. Confirm pet presence in both tabs.
4. Capture profile, switch tabs, capture form, and snip form.
5. Confirm `3 / 8` persists.
6. Analyze and confirm exactly three strategy cards.
7. Review changes nothing.
8. Fill only through real bundled Page Agent and confirm no navigation/submission.
9. Undo and confirm original empty field.
10. Clear keys and confirm Analyze is locked while captures remain.
11. Confirm no Mochi Vercel API request.

- [ ] **Step 5: Run the E2E twice**

Run: `npx playwright test tests/e2e/connector.spec.ts --project=chromium --repeat-each=2`

Expected: 2 PASS with no flake.

- [ ] **Step 6: Record evidence and commit**

Append exact commands/results to `docs/BUILD_LOG.md`.

```bash
git add tests/e2e/connector.spec.ts playwright.config.ts docs/BUILD_LOG.md
git commit -m "test: verify the complete BYOK connector flow"
```

### Task 8: Full verification, production deployment, and acceptance audit

**Files:**

- Modify: `docs/BUILD_LOG.md`
- Generated: `extension/dist/**`
- Generated: `public/downloads/mochi-connector.zip`

**Interfaces:**

- The production landing page is `https://mochi-overlay.vercel.app/`.
- The production archive is `https://mochi-overlay.vercel.app/downloads/mochi-connector.zip`.

- [ ] **Step 1: Run the complete repository gate**

Run: `npm run verify`

Expected: lint, typecheck, all Vitest tests, production build, and all built E2E tests PASS.

- [ ] **Step 2: Run credential and old-runtime leak scans**

```bash
rg -n "mochi-overlay\\.vercel\\.app/api/|CONNECTOR_SESSION_URL|MOCHI_CONNECTOR_SECRET|solveProofOfWork|getInstallId|setInstallId" extension extension/dist
rg -n "sk-[A-Za-z0-9_-]{8,}|exa-[A-Za-z0-9_-]{8,}" extension/dist public/downloads
```

Expected: no extension runtime or credential hit. Documentation/test fixture hits must be reviewed explicitly and cannot appear in built artifacts.

- [ ] **Step 3: Inspect the packaged archive**

Run:

```bash
unzip -t public/downloads/mochi-connector.zip
unzip -p public/downloads/mochi-connector.zip manifest.json
shasum -a 256 public/downloads/mochi-connector.zip
```

Expected: valid archive, MV3 manifest with provider hosts, and a recorded SHA-256.

- [ ] **Step 4: Update final build evidence**

Append every verification command, exit status, test count, archive hash, and any corrective decision to `docs/BUILD_LOG.md`; rerun `npm run verify` if the log change affects validation.

- [ ] **Step 5: Commit and push the verified source**

```bash
git add docs/BUILD_LOG.md public/downloads/mochi-connector.zip
git commit -m "chore: record verified BYOK release"
git push origin main
```

- [ ] **Step 6: Verify Vercel deployment**

Wait for the deployment containing the pushed commit. Inspect its status and build logs. Open production and click through:

- **Download Chrome extension**;
- the three installation steps;
- visible BYOK/optional Exa copy;
- explicit website-versus-extension explanation.

Download the production ZIP, run `unzip -t`, inspect its manifest, and compare its SHA-256 with the verified local archive.

- [ ] **Step 7: Run the requirement-by-requirement acceptance audit**

For every acceptance criterion in `docs/superpowers/specs/2026-07-27-byok-chrome-extension-design.md`, record authoritative evidence:

- code path;
- unit/component/E2E test;
- built artifact inspection;
- production URL or downloaded artifact.

Any missing or indirect evidence keeps the release incomplete and must trigger a corrective test/code/deploy cycle.

- [ ] **Step 8: Mark the goal complete only after the audit passes**

Confirm clean `git status`, production deployment on the verified commit, matching archive hash, and no remaining acceptance gap.
