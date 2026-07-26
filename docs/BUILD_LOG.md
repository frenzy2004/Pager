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
