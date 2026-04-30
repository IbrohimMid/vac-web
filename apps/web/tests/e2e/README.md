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
