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
driver on its embedded form. The same `ActionDriver` interface includes a lazy
[Alibaba Page Agent](https://github.com/alibaba/page-agent) adapter for the
extension/runtime version that can act on arbitrary webpages.

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
EXA_API_KEY=...
```

`POST /api/analyze` uses OpenAI Responses API vision with Zod Structured
Outputs. It makes one bounded Exa `fast` search only when the first analysis
identifies a material public-information gap, then asks OpenAI to refine the
same three strategies with those sources.

Keys are never prefixed with `NEXT_PUBLIC_`, never reach the browser, and are
ignored by Git.

## Page Agent bridge

`src/lib/mochi/page-agent-driver.ts` dynamically imports `page-agent` and
converts a selected strategy into a bounded DOM task. Empty/unknown values are
omitted, fill-only prohibits submission, and autopilot allows exactly one final
submit. The hosted page does not expose a browser-side model key, so it uses the
DOM driver instead.

A Chrome extension can create the driver with an OpenAI-compatible,
extension-owned runtime configuration:

```ts
const driver = await createPageAgentDriver({
  baseURL: extensionProxyUrl,
  model: extensionModel,
  apiKey: sessionCredential,
});
```

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

- Up to three PNG/JPEG/WebP screenshots are held in the open browser session.
- Unknown identity/contact facts stay blank instead of being invented.
- Public web research is cited and visually distinguished from draft wording.
- Review is the default action mode.
- The hosted demo never submits a third-party form.
- Mochi does not bypass CAPTCHAs, anti-bot controls, or website terms.
