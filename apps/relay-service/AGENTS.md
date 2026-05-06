# apps/relay-service

Rust relay service for cross-host bridge tunneling.

## Purpose

Provides an out-of-process tunnel endpoint so the local bridge can be reached from another machine without exposing the WS port directly. Used by `apps/local-bridge/src/tunnel.rs` as the upstream.

## Layout

- `src/main.rs` — entry point + axum router.
- `Cargo.toml` — depends on `bridge-core` for shared types.

## Tests

- `cargo test -p relay-service`.

## Operational notes

- Reads relay config from `config/vac.yaml` `relay:` block.
- Audit-aware: forwards audit headers without rewriting them.
- Auth model is identical to direct-WS connections (slice 21); reject if signature is missing.
