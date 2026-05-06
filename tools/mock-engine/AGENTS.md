# tools/mock-engine

Mock execution engine. Replays YAML scenarios under `config/control-plane/` and emits the timeline events the cockpit expects.

## Scenarios

- Authoritative catalogs: `config/control-plane/event-catalog.yaml` + `config/control-plane/command-manifest.yaml`.
- Section A migration completed in Pass #37 (2026-05-05): mock scenarios moved to YAML.

## Tests

- `cargo test -p mock-engine` — 47/47 passing as of 2026-05-06.
- Enforces event-catalog parity + emission timing budget (≤ 5ms drift per slice 41 SLOs).

## Anti-patterns

- Inlining scenario data in Rust source instead of authoring it as YAML.
- Emitting events that are not in `event-catalog.yaml` (parity test will fail).
