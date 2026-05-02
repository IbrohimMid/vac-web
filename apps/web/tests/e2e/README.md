# Sweep cockpit end-to-end suite (P5)

This directory hosts the Playwright suite that exercises the assessment /
sweep cockpit in `ReadinessHub` and friends.

## Layout

- `mock-bridge.ts` — in-process WebSocket mock that speaks the subset of
  the bridge protocol the cockpit needs (handshake, `session/new`,
  `assessment.list_runs` / `run` / `sweep.run` / `sweep.cancel`, plus
  scripted `assessment.*` event playback). Each spec wires a fresh
  bridge through the page's `globalThis.__vacBridgeOverride` hook.
- `fixtures/` — canned event sequences for the runs/sweeps the specs
  assert on. Keep these stable; specs match on event ordering and on
  user-facing strings rendered from these payloads.
- `sweep-cockpit.spec.ts` — 8 specs covering the cockpit happy paths
  and the failure surfaces introduced in P2 / P2-extend.

## Specs

| # | Spec name | What it asserts |
|---|-----------|-----------------|
| 1 | `lists historical runs after handshake` | `assessment.list_runs` ack populates the runs table; rows render in newest-first order. |
| 2 | `selecting a run loads its findings` | Clicking a run row triggers `assessment.fetch_report`; the detail pane shows the canned findings + verdict. |
| 3 | `running a single-family assessment shows live progress` | `Run` button issues `assessment.run`; mock bridge streams `progress` + `finding_added` events; UI advances the progress label. |
| 4 | `sweep run streams progress per family` | `Run sweep` issues `assessment.sweep.run`; multiple `sweep.progress` events update the active sweep row. |
| 5 | `cancelling a sweep transitions it to cancelled` | Clicking Cancel on an active sweep issues `sweep.cancel`; status badge flips to `cancelled` after `sweep.completed`. |
| 6 | `list_runs failure shows banner + retry` | Bridge replies with `error.code = persistence.disabled`; banner renders with `Retry` and `Dismiss`; clicking Retry re-issues the request. |
| 7 | `query_failed event surfaces in the failure stack` | After a successful list, an `assessment.query_failed` event with `code=assessment.query_failed` is pushed; banner mentions "event log" reason. |
| 8 | `worker_output_rejected events surface as warnings` | A v1 envelope with `schema_version: 99` triggers an `assessment.worker_output_rejected` event; the run detail pane shows the rejection chip with the `schema_version_unsupported` code. |

## Running

```bash
# one-time browser download
pnpm exec playwright install chromium

# run the whole suite
pnpm -C apps/web e2e

# run one spec, with the inspector
pnpm -C apps/web exec playwright test sweep-cockpit -g "sweep run" --debug
```

The Playwright web server in `playwright.config.ts` runs `vite build`
first, so the suite always exercises the production bundle.

## Why a custom mock bridge

The real bridge needs a paired ACP worker, persistence on disk, and
outbound network access. None of that is reproducible inside CI on a
fresh runner. The mock bridge is a small TS class that spawns a WS
server on `127.0.0.1:0`, replies to the documented messages, and
streams scripted events. It uses the same `protocol-rs`-derived TS
types the real client uses, so any drift in the protocol surfaces as
a compile error in CI long before the suite runs.

## Testid contract (N4)

The sweep cockpit exposes a small, intentional set of stable
`data-testid` hooks for end-to-end and visual-regression tests.
Keep this list in sync with `ReadinessHub.tsx`,
`RunAssessmentDrawer.tsx`, `AssessmentDiff.tsx`, `AssessmentReportDetail.tsx`,
`FindingsList.tsx`, `RunDetailsCard.tsx`, and `main.tsx`.

| testid | Where | What it points at |
|--------|-------|-------------------|
| `run-assessment-sweep-button` | `main.tsx` (Readiness surface header) | The primary "Run sweep" CTA that opens `RunAssessmentDrawer`. |
| `run-assessment-drawer` | `RunAssessmentDrawer.tsx` | The drawer `<aside role="dialog">`. Lets specs scope queries to the open drawer. |
| `assessment-agent-select` | drawer | `<select>` for picking the assessment agent. |
| `assessment-family-${id}` | drawer | One radio input per family (`rtd`, `security`, `cost`, `all`, ...). The id suffix is the family id. |
| `assessment-depth-${id}` | drawer | One button per depth preset (`quick`, `standard`, `deep`, ...). |
| `assessment-run-submit` | drawer footer | The drawer's primary submit button. |
| `assessment-family-select` | `ReadinessHub.tsx` header | Inline `<select>` for the single-family quick-run path. |
| `run-assessment-button` | hub header | Inline "Run {family}" button next to the family select. |
| `assessment-cancel-button` | hub header | Cancel button shown while the active run is `running`. |
| `assessment-query-error-banner` | hub header | The `role="alert"` stack rendered when `queryErrors` are non-empty. |
| `assessment-query-error-retry` | inside the banner | Retry CTA on a recoverable query failure. |
| `assessment-active-run-select` | hub body | `<select>` for switching the active run. |
| `assessment-sweep-row` | sweep history timeline | One row per sweep. Carries `data-sweep-id` for disambiguation. |
| `assessment-sweep-cancel-button` | sweep row | Cancel button on a `running` sweep row. |
| `assessment-run-row` | recent assessments timeline | One row per run. Carries `data-run-id` for disambiguation. |
| `assessment-diff-view` | `AssessmentDiff.tsx` root | The 4-tab diff shell (resolved / persistent / regressed / new). |
| `assessment-report-detail` | `AssessmentReportDetail.tsx` outer shell | The two-column report view. |
| `assessment-findings-list` | `FindingsList.tsx` root scroll container | The virtualized findings list viewport used by both hub and report views. |
| `assessment-provenance-chip` | `ReadinessHub.tsx` verdict header + `RunDetailsCard.tsx` | The shared provenance chip showing index vs event-log fallback. |
| `assessment-worker-output-rejection` | inside the report shell (N3) | The warn-tone banner rendered when `assessment.worker_output_rejected` lands for the visible run. Carries the Replay + Dismiss CTAs. |

### Why testids and not text

Text selectors are still used for assertions about *what the cockpit
renders* ("the row says `TLS missing on staging endpoint`", "the
banner mentions persistence", "finding text streams in"). Testids are
used for navigation — "click the Run button", "click the Cancel button
on the running sweep". If a spec is selecting an action element by
text, that's a refactor target.
