# tests/integration

Cross-crate integration tests. Brings up `local-bridge` + `mock-engine` and exercises end-to-end flows.

## Run

```bash
cargo test -p integration-tests
```

## Coverage

- Handoff dispatch (Pass E2): `tests/handoff_dispatch.rs` covers create → approve → spawn (4/4 passing).
- Translator parity: command-manifest round-trip.
- Audit append-only.
- Profile policy enforcement on protected actions.

## Notes

- Tests must be hermetic — no external network, no shared state across runs.
- Uses `tools/mock-acp` + `tools/mock-engine` to simulate agent + execution sides.
