# Mochi

Mochi is a screenshot-driven universal form assistant. A small animated pet
opens into a temporary overlay where you can paste, drop, or upload context.
Mochi reads the screenshot and current page, optionally researches public gaps,
creates three grounded strategies, and acts in one of three modes:

- **Review** — preview first, then approve the fill.
- **Fill only** — populate supported values and never submit.
- **Autopilot** — populate and submit after a cancellable countdown.

**Live product:** [mochi-overlay.vercel.app](https://mochi-overlay.vercel.app)

The Vercel-hosted build is a full interactive product slice with job
application, sales lead, and general-form missions. It uses a deterministic DOM
driver on its embedded form. The downloadable Manifest V3 Chrome connector
injects the Mochi pet into eligible tabs, keeps one global side panel, captures
up to eight page/region images, and bundles
[Alibaba Page Agent](https://github.com/alibaba/page-agent) for real page
execution.

## Run locally

Requirements: Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The complete UI works without provider keys and
honestly labels those responses as demo output.

## Enable live screenshot analysis

Add server-side values to `.env.local`:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-sol
PAGE_AGENT_MODEL=gpt-5.6-sol
EXA_API_KEY=...
MOCHI_CONNECTOR_SECRET=... # at least 32 random characters
```

`POST /api/analyze` uses OpenAI Responses API vision with Zod Structured
Outputs. It makes one bounded Exa `fast` search only when the first analysis
identifies a material public-information gap, then asks OpenAI to refine the
same three strategies with those sources.

Keys are never prefixed with `NEXT_PUBLIC_`, never reach the browser, and are
ignored by Git.

## Build and install the Chrome connector

```bash
npm run package:extension
```

This creates `extension/dist` for **Load unpacked** and
`public/downloads/mochi-connector.zip` for the Vercel download link. In Chrome
116 or newer:

1. unzip the archive;
2. open `chrome://extensions` and enable Developer mode;
3. choose **Load unpacked** and select the unzipped folder.

The pet appears on normal HTTP/HTTPS tabs. Capture page stores the visible
viewport; Snip area freezes that same frame and crops the dragged region.
Captures live in `chrome.storage.session` and do not leave Chrome until Analyze.

## Page Agent bridge

`extension/src/content/agent.ts` is built as a separate on-demand bundle. The
service worker injects it only after Execute. It uses 16 bounded Page Agent
steps, disables `ask_user` and generated script execution, honors review/fill/
autopilot submit boundaries, and can be cancelled or undone.

Its custom fetch sends the OpenAI-compatible request to the extension service
worker, which first obtains a short-lived signed connector session and then
forwards it only to
`/api/page-agent/chat/completions` on the fixed Mochi Vercel origin. The route
accepts only Alibaba Page Agent's single `AgentOutput` macro-tool contract,
ignores browser model/auth settings, applies the server model and key, and
forces tool-compatible GPT-5.6 reasoning settings. Per-session quotas and a
Vercel WAF IP rate limit bound usage. No provider credential is stored in the
extension.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The build log at [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) records verified
passes, failures, and corrective decisions instead of relying on optimistic
status claims.

## Privacy and safety boundaries

- Up to eight PNG/JPEG/WebP captures are held in the browser session.
- Unknown identity/contact facts stay blank instead of being invented.
- Public web research is cited and visually distinguished from draft wording.
- Review is the default action mode.
- Page Agent cannot click buttons; fill mode never submits, while Autopilot
  validates the exact field map before Mochi invokes one form submission.
- Cancellation restores the pre-run snapshot, and exact-map fallback requires
  a separate explicit approval.
- The hosted demo never submits a third-party form.
- Mochi does not bypass CAPTCHAs, anti-bot controls, or website terms.
