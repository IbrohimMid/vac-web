# Observability, audit, and operational SLOs (slice 41)

## Outcomes

* Every command and event the cockpit observes has a structured log
  entry with stable keys.
* Audit trails are append-only and survive process restarts.
* Health states are explicit (`ok`, `degraded`, `unavailable`) and
  surface in the UI through capability modules.
* Operational SLOs exist and are measurable from local logs.

## Structured logging

Every log line at INFO+ MUST include the following keys:

| Key | Type | Description |
| --- | --- | --- |
| `event` | string | Canonical event ID from `event-catalog.yaml`. |
| `session_id` | string \| null | Session URL or `null`. |
| `actor` | string | `user`, `agent`, `system`. |
| `severity` | string | From `errorTaxonomy.ts` (`info`, `warning`, ...). |
| `code` | string | Specific error code or empty string. |
| `latency_ms` | number | Time to handle the command (where applicable). |

Layer-specific keys may extend this set; they may not redefine these.

## Audit trail

* Owner: `apps/local-bridge/src/audit/`.
* Storage: append-only on disk; never overwritten.
* Reader: must support every version of the audit schema ever written
  (see `docs/data-contract-versioning.md`).
* Required for: `profile.denied`, `gate.override`, `gate.revoke_override`,
  `audit.write_failed`, `auth.unauthorized`, persistence write failures.

## Health states

Each durable subsystem reports a health state with these values:

* `ok` — all operations succeed within SLO.
* `degraded` — retries succeeding; user-visible latency or partial
  feature reduction.
* `unavailable` — feature is wired but cannot serve requests right now.
* `not_wired` — feature is not implemented; surfaces use
  `feature.not_wired` fallback (slice 02).

The Topbar status chip and Toast lane consume these via capability
modules.

## SLOs (initial set)

| Subsystem | SLO | Window |
| --- | --- | --- |
| Command translator | p99 latency ≤ 200ms for non-IO commands | rolling 1h |
| Persistence write | p99 latency ≤ 50ms; 0 unrecovered write failures | rolling 24h |
| Audit write | 0 dropped entries | always |
| Mock-engine event emission | timeline drift ≤ 5ms | per scenario |
| WebSocket reconnect | reconnect success ≤ 3s on transient drop | rolling 1h |

SLOs are validated by:

1. Local perf tests under `tools/perf/` (planned).
2. Synthetic scenarios in mock-engine with assertions on emission
   timing.

## Validation gates

* `cargo test -p local-bridge --lib` includes audit append-only tests.
* `cargo test -p mock-engine` enforces event-catalog parity.
* `pnpm --filter @vac-web/web test -- --run` enforces capability module
  classification.

## Anti-patterns to refuse

* Logging without `event` / `severity` keys.
* Surfaces inventing health states locally instead of consuming the
  capability module.
* Audit writes that are not append-only.
* SLO-tracking that depends on external services (this is a local-first
  cockpit).

## Backend SLO measurement harness (slice 41 R6, added 2026-05-06)

The structural budget validator `scripts/check-slo-budgets.mjs` (added in the 2026-05-06 closeout) ensures the `slos:` block in the slice plan is well-formed. The complementary measurement harness ships in `tools/perf/`:

- Run locally: `cargo run -p perf --release -- --duration 60 --output perf-results.json`
- Check against budgets: `node scripts/check-slo-measurements.mjs perf-results.json`
- CI: weekly cron in `.github/workflows/perf.yml` uploads results as artifacts.

Phase 1 ships with synthetic deterministic measurements (always within budget) to validate the contract end-to-end. Phase 2 replaces them with real per-subsystem drivers; see `docs/perf-test-plan.md` section 8 for the full plan.

Budgets live in `config/slo-budgets.yaml` (mirrored from `docs/plans/wiring/41-observability-slos.md::slos`).
