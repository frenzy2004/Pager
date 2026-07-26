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
