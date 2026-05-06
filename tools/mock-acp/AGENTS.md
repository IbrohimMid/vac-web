# tools/mock-acp

Mock ACP (Agent Communication Protocol) harness. Used by integration tests + local dev.

## Run

```bash
cargo run -p mock-acp -- --scenario <name>
```

## Tests

- `cargo test -p mock-acp`.

## Notes

- Scenarios share the YAML format with `tools/mock-engine`.
- Produces deterministic timing (slice 41 SLO: ≤ 5ms drift per scenario step).
