# apps/local-bridge

Rust axum WebSocket bridge. The runtime authority for translator, session, audit, profile, handoff dispatch, and capability classification.

## Layout

- `src/server.rs` — axum router + WS upgrade.
- `src/ws/` — WS message decode and dispatch.
- `src/translator/` — protocol command translation (39/39 emit sites migrated to structured logging in slice 41).
- `src/session/` — session manager, persistence, handle registry, executor binding.
- `src/audit/` — append-only audit trail (slice 29).
- `src/auth/` — auth + WS hardening (slice 21).
- `src/profile_layer/` — profile policy enforcement (slice 20).
- `src/handoff/` — assessor → executor handoff (Pass E1 audit + Pass E2 `spawn_executor_for_handoff`).
- `src/agent_runtime/` — ACP agent runtime + fs / terminal handlers.
- `src/notify/`, `src/notify.rs` — notify lane translation.
- `src/observability.rs` — structured logging glue (slice 41).
- `src/storage/` — persistence (sqlite + WAL).
- `src/workflows/` — workflow execution helpers.
- `src/config/` — runtime config loader.
- `src/capabilities.rs` — capability registry root.
- `src/tunnel.rs` — relay tunnel client.

## Key invariants

- All side-effect commands MUST emit an audit event.
- `compute_pin` always overrides client-supplied `repo_ref` / `base_commit_sha`; bridge owns pin identity.
- `feature.not_wired` returns `ok: false` with stable code (slice 02).
- Every module under `src/` (except `lib.rs`, `main.rs`, `generated/`) MUST be mapped in `config/capability-coverage.yaml`.
- Executor spawn errors use the typed `ExecutorSpawnError` variants; never panic on policy denial.

## Tests

- `cargo test -p local-bridge` — unit + integration.
- `cargo test --test handoff_dispatch` — handoff dispatch suite (4/4 passing as of 2026-05-06).
- `cargo test -p local-bridge --lib` includes audit append-only assertions.

## Anti-patterns

- Logging without `event` / `severity` / `session_id` keys.
- Mutating client-supplied pin identity instead of recomputing via `compute_pin`.
- Adding a module without an entry in `config/capability-coverage.yaml`.
