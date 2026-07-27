# Mochi build log

This file records verified checkpoints, failures, and corrective decisions.

## 2026-07-26 — Repository and contract

- **Observed:** `frenzy2004/Pager` was an empty public repository with no
  commits; authenticated account `frenzy2004` has admin access.
- **Decision:** Build a Vercel-hosted interactive product slice on
  `agent/mochi-overlay`; keep the arbitrary-site Chrome extension as the next
  packaging step.
- **Decision:** Use OpenAI Responses API for screenshot vision and structured
  strategies, Exa Search for material public-information gaps, and Page Agent
  behind a browser adapter.
- **Secret handling:** Burner credentials will live only in ignored local/Vercel
  environment settings. They must never appear in commits or client bundles.
- **RED verified:** `npm test -- src/lib/mochi/files.test.ts
  src/lib/mochi/strategies.test.ts src/lib/mochi/action-driver.test.ts` failed
  with three expected missing-module errors for `files`, `strategies`, and
  `action-driver`.
- **Install note:** npm reported 12 high-severity transitive advisories. This is
  recorded for audit after the functional slice; no blind `--force` upgrade
  will be run because it can break pinned framework dependencies.
- **GREEN verified:** the first implementation exposed a real cancellation race:
  cancelling immediately after `execute()` happened before the countdown timer
  existed, so the test received `submitted`. The driver now records an early
  cancellation request. Fresh run: 3 test files passed, 10 tests passed.
- **API RED verified:** the route suite failed on the expected missing
  `src/app/api/analyze/route` module.
- **API GREEN verified:** demo fallback, malformed-packet rejection, and the
  three-screenshot limit pass. Fresh full run: 4 files passed, 13 tests passed;
  `tsc --noEmit` completed with zero errors.
- **Type correction:** the first typecheck rejected an unsafe array-to-tuple
  assertion for the three demo strategies. The generator now constructs an
  explicit three-item tuple, preserving the “exactly three” contract.
- **Secrets:** local burner keys were added to ignored `.env.local`; live
  provider behavior still needs an HTTP integration run.
- **Checkpoint note:** the first staged secret-scan command used `--cached`
  after the pattern, which Git rejected. It was immediately rerun as
  `git grep --cached`; zero tracked secret matches were found.

## 2026-07-26 — Live providers and product surface

- **OpenAI failure observed:** the first HTTP smoke packet used a tiny PNG that
  decoded locally but the API rejected as invalid image data (`400`). The live
  route correctly surfaced this as `502` instead of pretending demo success.
- **OpenAI verified:** a fresh 512×512 PNG request returned HTTP 200,
  `engine: openai`, exactly three ordered strategies, and `needs-input` for the
  unsupported identity field.
- **Exa verified:** a direct bounded `fast` search returned HTTP 200, three
  results, highlights, and a request ID.
- **Full provider chain verified:** a lead packet that materially required
  public research completed OpenAI → Exa → OpenAI with HTTP 200,
  `engine: openai+exa`, three strategies, and five attached sources.
- **UI RED verified:** the overlay and embedded-product suites first failed on
  missing components. The action-driver regression also proved blank model
  suggestions would overwrite existing user values.
- **UI GREEN verified:** the DOM driver now omits blank suggestions. The pet,
  context tray, strategy picker, three modes, review gate, form fill, and undo
  pass their interaction suites.
- **Harness corrections:** an initial component assertion used an unsupported
  matcher composition, and test cleanup was not globally registered. Both were
  test-harness issues; the received value already contained the correct product
  copy. Global cleanup and a direct value assertion fixed isolation.
- **React review:** replaced render-time ref initialization with lazy state,
  split the shared Mochi face into its own component, removed an unnecessary
  memo, and added semantic roles to labelled groups.
- **Fresh local verification:** 7 test files / 19 tests pass, TypeScript and
  ESLint report zero errors, and the Next.js 16 production build completes.
- **Browser verification:** desktop and 390×844 mobile layouts render with no
  framework overlay or browser errors. Live screenshot analysis rendered three
  routes; fill-only populated supported fields, left unknown email blank, and
  undo restored the form.
- **Browser-tool note:** a text-based wait timed out even though the results had
  rendered; the accessibility snapshot and screenshot immediately confirmed
  the target heading. Subsequent checks used role snapshots.
- **Accessibility:** the first axe run found one WCAG AA contrast violation in
  three numbered badges and two ambiguous labelled groups. After correction,
  the rerun reports zero violations; gradient-backed text remains
  machine-inconclusive rather than a confirmed failure.

## 2026-07-26 — Release hardening

- **E2E RED verified:** the first Playwright run clicked the server-rendered pet
  before React hydration, so the event was lost. A hydration-ready guard made
  that state explicit; the second run then revealed the runner used
  `127.0.0.1` while Next dev served `localhost`, and Next logged a blocked
  cross-origin runtime request. Aligning the host restored hydration.
- **Mobile assertion correction:** the first bounds check sampled the bottom
  sheet during its entrance transform and measured the intentional off-screen
  starting frame. The test now polls until the animated sheet is inside the
  viewport, then checks every edge.
- **Suite isolation correction:** Vitest initially discovered
  `tests/e2e/mochi.spec.ts` and tried to execute Playwright hooks. The unit
  config now excludes the E2E, dependency, and build-output directories.
- **Dependency audit:** the first production audit found vulnerable transitive
  `postcss` and `sharp` versions under Next. Fixed releases were pinned through
  package overrides. A trial ESLint 10 upgrade produced a verified
  incompatibility in Next's React lint plugin, so ESLint 9 was retained and
  only its vulnerable `minimatch` transitive was overridden.
- **Fresh release gate:** `npm audit` reports zero vulnerabilities; ESLint and
  TypeScript report zero errors; 7 unit files / 19 tests pass; the Next.js
  production build passes; and Playwright reports 5 passing browser flows with
  1 intentional desktop skip for the mobile-only bounds scenario.

## 2026-07-26 — Production deployment

- **Project:** linked `moonlantern24-1017s-projects/mochi-overlay` and stored the
  OpenAI/Exa burner credentials as Vercel Production variables. Both provider
  keys are sensitive; the model name is non-sensitive.
- **Git integration note:** Vercel could not attach the GitHub repository
  because the authenticated Vercel account has no GitHub login connection.
  Direct authenticated CLI deployment succeeded and GitHub `main` remains the
  canonical source.
- **Cloud build:** Vercel installed the locked dependencies, compiled Next.js
  16.2.12, passed TypeScript, generated all static routes, and marked deployment
  `dpl_HL6LE7KpSuVwHd4ARCpyRiD5PXnK` Ready. Production is aliased at
  `https://mochi-overlay.vercel.app`.
- **Production browser suite:** the same deployed URL passed 5 Playwright flows
  with 1 intentional mobile-only skip in the desktop project.
- **Production provider smoke:** a real screenshot packet returned HTTP 200,
  `engine: openai`, exactly three strategies, a supported visible name, and
  `needs-input` for the absent email. A research-required lead packet returned
  HTTP 200, `engine: openai+exa`, three strategies, five sources, and
  `needs-input` for the absent contact.
- **Production visual/accessibility check:** the page and open overlay rendered
  without browser errors. Axe reported zero confirmed violations (gradient
  contrast remained manual-review/incomplete), and Vercel returned no error or
  5xx logs for the verification window.

## 2026-07-27 — Universal Chrome connector

- **Cross-tab behavior:** the Manifest V3 connector now injects Mochi on every
  normal HTTP/HTTPS tab and keeps one `chrome.storage.session` context tray in a
  Chrome side panel, so switching tabs does not lose Mochi or prior captures.
- **Capture workflow:** repeated viewport captures and frozen-frame region snips
  are capped at eight, normalized before storage, and protected against
  capture/Clear races. Page-controlled URL/title metadata is bounded before it
  reaches storage or analysis.
- **Execution adapter:** the shipped bundle pins Alibaba Page Agent `1.12.2`.
  Its proxy accepts only the pinned `AgentOutput` macro-tool contract; clicking,
  generated scripts, and implicit exact-fill fallback are disabled.
- **Safety boundary:** Review renders the exact proposed key/value map without
  mutation. Fill never submits. Autopilot requires one validated form boundary,
  a fresh worker authorization, and a cancellable countdown. Execution, Cancel,
  Clear, fallback, rollback, and Undo are bound to the original tab, document,
  and safe-field manifest.
- **Concurrency hardening:** delayed-storage regressions cover duplicate
  execution, Clear during capture/execution preflight, Cancel during exact fill,
  hidden-field rollback, and cancellation at the final success-commit window.
  Success is revalidated inside the serialized storage-write boundary.
- **Abuse controls:** connector sessions require proof of work plus a
  short-lived IP-bound HMAC token. Analyze and Page Agent have per-session
  quotas, bounded bodies, strict schemas, and the enabled Vercel WAF rule
  `Mochi AI API - 30 req/min/IP`.
- **Fresh release gate:** ESLint and TypeScript pass; 24 Vitest files / 118
  tests pass; the Next.js production build and packaged extension pass;
  Playwright reports 6 passing flows with 2 intentional skips for the
  desktop-only unpacked-extension scenario; `npm audit` reports zero
  vulnerabilities. An independent final code review returned GO with no
  remaining correctness or security blocker.

## 2026-07-27 — BYOK Chrome extension release

- **Private provider setup:** users enter their own OpenAI key inside the
  extension; Exa is optional. Keys stay in `chrome.storage.local`, are
  restricted to trusted extension contexts, and are never returned to content
  scripts, embedded in the bundle, or sent through the Mochi Vercel API.
- **Direct AI path:** screenshot analysis calls OpenAI directly. When public
  context is genuinely missing and Exa is configured, Mochi performs one
  bounded Exa search and gives the evidence back to OpenAI for refinement.
  Results remain constrained to exactly three strategies.
- **Direct action path:** Alibaba Page Agent `1.12.2` now uses the user's
  OpenAI key directly with the pinned `gpt-5.6-sol` model and Mochi's restricted
  macro-tool envelope. Fill still cannot submit, stays inside the reviewed form
  boundary, and preserves Undo.
- **Permission regression:** the first GitHub extension run exposed that
  generic provider host patterns were insufficient for repeated
  `captureVisibleTab` calls after switching tabs. Restoring Chrome's required
  `<all_urls>` permission fixed cross-tab capture while retaining explicit
  OpenAI and Exa hosts.
- **Fresh local gate:** ESLint and TypeScript pass; 28 Vitest files / 151 tests
  pass; the Next.js production build completes; and the packaged ZIP contains
  the provider hosts without bundled credentials or references to the Mochi
  server AI route.
- **Real Chromium gate:** GitHub Actions run `30240890136` passed the complete
  release gate on commit `4e022f98cfb409bc232a18263040388de5021501`.
  The unpacked-extension flow saved and tested OpenAI plus optional Exa keys,
  captured two tabs plus a region into one three-item tray, completed direct
  OpenAI → Exa → OpenAI analysis, rendered exactly three routes, ran direct
  Page Agent fill without submission, undid the fill, cleared keys without
  clearing captures, and observed zero Mochi server AI requests.
- **Production deployment:** Vercel deployment
  `dpl_Eg5Bi2GWsQWKPs6Eziz1mUfewCXQ` built successfully, is `Ready`, and is
  aliased at `https://mochi-overlay.vercel.app`. Its Vercel error-log window was
  empty. The in-app browser's enterprise network policy blocked an additional
  manual visit to that domain, so the release relies on the green real-Chromium
  gate rather than bypassing that policy.
- **Reproducible archive correction:** an authenticated production download
  contained the same seven files byte-for-byte as the local ZIP, but the ZIP
  hash differed because JSZip used the packaging time for every entry. A red
  artifact test captured the timestamp drift; the packager now sorts paths and
  fixes entry dates. Two independent local package runs now produce SHA-256
  `245485fedd88764ed1618aaa134a721a2c6351a9077451d111b853bfcd5c3f5b`.
