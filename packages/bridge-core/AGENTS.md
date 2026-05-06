# packages/bridge-core

Rust shared primitives used by `apps/local-bridge`, `apps/relay-service`, and tools.

## Scope

- Common error types, log keys, capability ids, message envelope helpers.
- Stable API: changes here ripple through the workspace; bump cautiously and update consumers in the same PR.

## Tests

- `cargo test -p bridge-core`.

## Anti-patterns

- Adding async primitives that depend on tokio runtime here — keep this crate runtime-agnostic where possible.
- Importing from `apps/*` (would cycle).
