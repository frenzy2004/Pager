# Mochi BYOK Chrome Extension Design

**Date:** 2026-07-27

**Status:** Approved architecture; written-spec review pending

**Repository:** `frenzy2004/Pager`

## Decision

Mochi's cross-tab product is a Manifest V3 Chrome extension with a
bring-your-own-key setup. The user installs the extension, opens Mochi, enters
an OpenAI API key, optionally enters an Exa API key, and presses **Save & test**.
After that, Mochi captures context and fills forms without using the Mochi
Vercel deployment as an AI proxy.

The Vercel site remains the product landing page, live single-page demo,
extension download, and installation guide. It must state clearly that opening
the website alone does not add Mochi to other tabs.

## User Contract

1. Install the unpacked Mochi extension from the archive downloaded on Vercel.
2. Click the Mochi toolbar action or the injected pet.
3. On first use, enter:
   - an OpenAI API key, required;
   - an Exa API key, optional.
4. Press **Save & test**.
5. Capture the visible page or snip a region.
6. Switch tabs and capture again; the same context tray remains available.
7. Press **Analyze** to receive exactly three options.
8. Choose Review, Fill only, or Autopilot and let Alibaba Page Agent act on the
   active form.

No Mochi account, Vercel login, server token, model field, or additional setup
is required.

## Goals

- Keep the Mochi side panel and context tray available while the user switches
  eligible Chrome tabs.
- Make first-run setup a single obvious credential step.
- Store provider keys only in the current Chrome profile and keep them out of
  content scripts, screenshot session state, page DOM, logs, and Vercel.
- Call OpenAI and Exa directly from the extension service worker.
- Preserve the current eight-capture, multi-page context tray.
- Preserve the frozen-screen snipping interaction.
- Preserve exactly three strategies: Safe, Balanced, and Standout.
- Preserve Alibaba Page Agent execution, Review, Fill only, Autopilot,
  cancellation, deterministic fallback, target validation, submission guards,
  and Undo.
- Package a current connector ZIP into the Vercel build and make the
  installation instructions accurately describe the extension.

## Non-goals

- Chrome Web Store publication in this iteration.
- A Mochi account, billing system, hosted key vault, or cloud fallback.
- Syncing provider keys through a Chrome account.
- Supporting keys shared by a team or organization.
- Firefox, Safari, Edge-specific packaging, or mobile browsers.
- Full-scroll screenshot stitching.
- Running on `chrome://`, Chrome Web Store, extension, or other restricted
  pages.
- Exposing arbitrary provider base URLs, custom models, or model parameters in
  the setup UI.

## Chosen Approach

### Extension-only BYOK runtime

The connector's service worker owns provider credentials and provider network
calls. It uses the current public model configured in the bundle,
`gpt-5.6-sol`, for both screenshot analysis and Page Agent requests. The model
is intentionally not a first-run setting: the setup promise is "enter your key
and use Mochi."

This approach is preferred over:

- **Hybrid cloud/BYOK:** a mode selector and two auth paths would double the
  setup, error, and test surface without improving the personal-extension
  workflow.
- **Vercel-only credentials:** server-side keys are safer for a public product,
  but opening a website still cannot create a cross-tab browser experience and
  the connector remains dependent on Mochi's deployment and quota.

The accepted trade-off is that a standard API key stored in a local extension
is less secure than a server-held key. This build is therefore positioned as a
personal, unpacked extension. The setup UI must recommend a revocable key with
an appropriate project spending limit.

## Architecture

```text
┌──────────────────────── Chrome extension ────────────────────────┐
│                                                                  │
│  Global side panel                                               │
│  setup · captures · strategies · modes · errors · undo           │
│                 │ typed runtime messages                          │
│                 ▼                                                 │
│  Service worker                                                   │
│  credential vault · active-tab capture · shared session           │
│  analysis coordinator · OpenAI client · optional Exa client       │
│  Page Agent request policy                                        │
│          │                         │                               │
│          │ messages                │ HTTPS with user keys          │
│          ▼                         ├────────► api.openai.com        │
│  Per-tab content script           └────────► api.exa.ai            │
│  pet · snip · fields · Page Agent · exact fill · undo             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────── Vercel ──────────────────────────────┐
│ Landing page · demo · extension ZIP · accurate install guide     │
│ Never receives extension keys, captures, or Page Agent traffic   │
└──────────────────────────────────────────────────────────────────┘
```

### Credential store

A focused settings module owns this record:

```ts
interface ProviderSettings {
  version: 1;
  openAIApiKey: string;
  openAIValidation: {
    status: "untested" | "valid" | "invalid";
    checkedAt?: string;
  };
  exaApiKey?: string;
  exaValidation?: {
    status: "untested" | "valid" | "invalid";
    checkedAt?: string;
  };
}
```

- The service worker calls
  `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`
  during install and startup.
- Settings are stored in `chrome.storage.local`, never
  `chrome.storage.sync`.
- Content scripts cannot request or read raw settings.
- Runtime messages expose only credential status:

```ts
interface ProviderStatus {
  configured: boolean;
  openAI: "missing" | "untested" | "valid" | "invalid";
  exa: "missing" | "untested" | "valid" | "invalid";
}
```

- `configured` is true only when the persisted OpenAI validation status is
  `valid`. A previously successful test survives a Chrome restart.
- Any later OpenAI `401` or model-access failure marks the persisted OpenAI
  validation status `invalid` and locks provider actions until the key is
  replaced and tested again.
- **Clear keys** removes the settings record immediately. Captures remain local
  so the user can configure a new key without losing context.
- Errors and test results never echo key values or provider response bodies
  that might contain request headers.

### Side-panel setup

When no OpenAI key exists, the side panel shows a setup gate instead of the
mission controls:

- OpenAI API key password input, required.
- Exa API key password input, marked optional.
- A short local-storage warning and recommendation to use a revocable,
  spend-limited project key.
- **Save & test** primary action.
- A link to OpenAI's API-key page and a link to Exa's API-key page.

**Save & test** saves only after local validation, then asks the service worker
to test provider access. A valid OpenAI result opens the normal Mochi panel.
Missing or invalid optional Exa credentials never block OpenAI-only use.

The normal panel gains a small Settings button. Settings shows masked status,
**Retest**, **Replace keys**, and **Clear keys**. Raw saved keys are never sent
back to the side panel; replacement inputs start blank.

### OpenAI client

The service worker uses bounded `fetch` requests rather than exposing an SDK
client to page code.

- Base URL is fixed to `https://api.openai.com/v1`.
- Authorization is added only inside the service worker.
- The model is fixed to `gpt-5.6-sol`.
- Requests use an abort timeout and bounded input/output sizes.
- Screenshot analysis uses the Responses API with multimodal image inputs and
  a strict JSON schema.
- Page Agent uses the OpenAI-compatible Chat Completions endpoint required by
  `page-agent@1.12.2`.
- A test checks access to the fixed model. It does not generate user content.

Provider error mapping is stable and user-facing:

- `401`: "OpenAI rejected this key. Replace it in Settings."
- `403` or model-not-found: "This key cannot use Mochi's model."
- `429`: "OpenAI rate limit or project quota reached."
- timeout/offline: "Mochi could not reach OpenAI."
- malformed output: "OpenAI returned an invalid Mochi response. Try again."

### Optional Exa client

- Base URL is fixed to `https://api.exa.ai`.
- The API key is added as `x-api-key` only inside the service worker.
- Searches are limited to the existing fast, moderated, three-result contract.
- Exa runs only when OpenAI returns a non-empty public research query and an
  Exa key is configured.
- Exa failure falls back to the initial OpenAI analysis and shows a non-blocking
  "Public research was unavailable" notice.
- No Exa key means OpenAI-only analysis without an error.

## Data Flow

### First-run setup

1. The side panel requests `GET_PROVIDER_STATUS`.
2. The service worker returns status only.
3. The user enters keys and presses **Save & test**.
4. The side panel sends `SAVE_AND_TEST_PROVIDER_SETTINGS`.
5. The service worker validates length and shape, stores the settings in
   restricted local storage, and tests OpenAI plus optional Exa.
6. It returns sanitized status.
7. A valid OpenAI result unlocks the main side panel.

### Multi-page capture

The current capture and snip implementation remains unchanged:

1. Resolve the active eligible tab.
2. Hide the injected pet.
3. Capture the visible viewport.
4. Restore the pet in a `finally` path.
5. Normalize and store the image in `chrome.storage.session`.
6. Switch tabs and repeat up to eight total captures.

The global side panel and session tray remain available across tab switches.
Capture pixels still clear on Chrome restart, extension reload, update, disable,
or explicit **Clear all**.

### Analysis

1. Reject Analyze when OpenAI is not configured or not valid.
2. Discover and validate the active form manifest.
3. Load provider settings only inside the service worker.
4. Send the task hint, field manifest, and up to eight screenshots directly to
   the OpenAI Responses API.
5. Validate the structured result.
6. If it requests public research and Exa is configured, query Exa and make one
   refinement call to OpenAI with the returned evidence.
7. Normalize exactly Safe, Balanced, and Standout.
8. Store strategies and the exact active-document target in session storage.

Unknown personal facts remain empty and marked `needs-input`.

### Page Agent execution

Alibaba Page Agent remains bundled and runs only after the user selects a
strategy and action.

1. The active tab, URL, document ID, and field manifest must match the analyzed
   target.
2. Page Agent prepares its OpenAI-compatible request.
3. The content script passes the request to the service worker without a key.
4. A service-worker policy validates the exact two-message/tool envelope,
   Mochi task structure, step limit, selected field map, and execution lease.
5. The service worker strips provider-controlled fields, forces Mochi's model
   and bounds, and calls OpenAI directly.
6. The response returns to Page Agent without exposing credentials.

Review still makes no changes. Fill only cannot submit. Autopilot keeps the
three-second cancellation countdown and allows at most one guarded submission.
Undo restores values changed in the current document.

## Manifest and Network Policy

The extension keeps the page permissions required for the universal content
script and adds explicit provider access:

- `https://api.openai.com/*`
- `https://api.exa.ai/*`

The service worker accepts no arbitrary URL or base URL from a runtime message.
The extension bundles all executable JavaScript and loads no remote code.

## Vercel Product Changes

The landing page must:

- describe the product as a Chrome extension;
- use **Download Chrome extension** as the primary connector action;
- say "Install it, then enter your own OpenAI key inside Mochi";
- mark Exa as optional public-web research;
- remove "no browser API key" and "keys remain on Vercel" claims;
- explicitly say the website alone cannot follow the user into other tabs;
- retain concise unpacked-extension steps:
  download, unzip, open `chrome://extensions`, enable Developer mode, and
  choose **Load unpacked**;
- retain the live page demo as a separate, clearly labelled demo.

The production build must regenerate
`public/downloads/mochi-connector.zip` from the current extension source.

## Security and Privacy

- The user knowingly chooses the personal BYOK trade-off.
- OpenAI recommends server-side storage for standard API keys; the extension
  must display this limitation rather than claim browser storage is equivalent
  to a backend vault.
- Keys are local to the Chrome profile, not synced and not sent to Vercel.
- Only the service worker reads keys.
- Keys never enter `ConnectorSession`, runtime responses, Page Agent prompts,
  screenshot records, the DOM, console logs, analytics, or thrown error text.
- Provider URLs are constants.
- Credential messages are accepted only from Mochi extension views.
- The service worker reads keys for one provider operation at a time and does
  not keep a separate in-memory credential cache.
- The user can remove credentials with **Clear keys** or by uninstalling the
  extension.
- Captures leave the browser only when **Analyze** is pressed, and then go
  directly to OpenAI. Public research queries go directly to Exa only when it
  is configured and needed.

## Error Handling

- Missing OpenAI key: show setup and keep capture actions unavailable until
  configuration succeeds.
- Invalid OpenAI key: keep replacement inputs visible and do not unlock
  Analyze or Page Agent.
- Invalid optional Exa key: save OpenAI, mark Exa invalid, and continue without
  research.
- Provider quota or rate limit: preserve captures and strategies and show a
  retryable error.
- Offline/timeout: preserve all local state.
- Key cleared during an operation: increment a credential revision, abort the
  active provider request, and do not retry with stale credentials.
- Malformed OpenAI strategy output: reject instead of guessing.
- Exa failure: retain initial OpenAI result and show a non-blocking notice.
- Tab or document changes: stop before touching the new page.
- Page Agent policy rejection: stop execution and offer only the current exact
  fill fallback.

## Testing

Implementation follows test-driven development.

### Unit and component tests

- Provider settings validation, restricted storage, masking, save, status,
  test, replace, and clear behavior.
- Proof that settings never enter session state or normal runtime snapshots.
- OpenAI request construction, fixed endpoint/model, structured response
  parsing, timeouts, and sanitized error mapping.
- Exa optional/missing/valid/invalid/failure flows.
- Two-pass OpenAI → Exa → OpenAI analysis and three-strategy normalization.
- Page Agent request-policy rejection of altered prompts, tools, models,
  execution IDs, and step limits.
- Side-panel first-run gate, successful setup transition, Settings controls,
  and invalid-key states.
- Landing-page copy and download link.
- Manifest provider host permissions.
- ZIP packaging contents and absence of embedded keys.

### Extension end-to-end tests

Use a real unpacked extension in a persistent Chromium context and intercept
provider endpoints with deterministic fixtures:

1. First open shows setup.
2. Invalid OpenAI key remains blocked with a useful message.
3. Valid OpenAI plus absent Exa unlocks Mochi.
4. Valid OpenAI plus valid Exa shows both configured.
5. The side panel remains usable across two normal tabs.
6. Capture one viewport in each tab and see both items in one tray.
7. Analyze returns exactly three fixture-backed strategies.
8. Review changes nothing.
9. Fill only invokes the bundled Alibaba Page Agent path and never submits.
10. Undo restores the original form values.
11. Clear keys immediately blocks new analysis and Page Agent calls.
12. No intercepted Vercel API request occurs during extension analysis or
    execution.

Live provider calls are not part of automated verification because repository
tests must not require or expose a user's secret. **Save & test** is the
user-controlled live credential check.

### Release verification

- Run lint, typecheck, unit/component tests, production build, and extension
  end-to-end tests.
- Inspect the packaged manifest and archive.
- Load the built unpacked extension and click through setup, multi-tab capture,
  three-option analysis, Fill only, and Undo with intercepted provider
  fixtures.
- Deploy Vercel, download the production archive, compare it with the verified
  build artifact, and click through the production installation section.

## Acceptance Criteria

- A new user can install Mochi, enter one OpenAI key, test it, and reach the
  capture UI without configuring Vercel.
- Exa is visibly optional and its absence never blocks Mochi.
- Mochi and its shared capture tray work while switching between eligible tabs.
- Multiple captures from different pages feed one analysis.
- Extension AI and Page Agent traffic goes to OpenAI/Exa and never to Mochi's
  Vercel API.
- Exactly three strategies are produced.
- Page Agent performs bounded form filling and Undo works.
- No user-provided API key is present in the extension bundle, Vercel
  deployment, session state, content script, DOM, or logs.
- The Vercel landing page accurately explains installation and the BYOK
  requirement.
- The packaged extension and deployed download pass the complete verification
  suite.
