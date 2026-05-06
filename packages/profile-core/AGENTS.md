# packages/profile-core

Rust profile evaluation engine. Enforces `CapabilityProfile` policy decisions used by `apps/local-bridge` (slice 20).

## API surface

- `evaluate(profile, action, context) -> Decision`.
- Decisions are deterministic; no IO inside the evaluator.
- Returns `Allow`, `Deny { reason }`, or `RequiresApproval { reason }`.

## Tests

- `cargo test -p profile-core` — table-driven; cover allow / deny / requires_approval branches.

## Anti-patterns

- Performing IO (filesystem, network, env-read) inside `evaluate`.
- Caching decisions in the evaluator — caching is the caller's concern.
