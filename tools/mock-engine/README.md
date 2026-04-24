# `mock-engine`

Stub `vac serve --stdio` for local integration testing. Speaks line-delimited JSON-RPC 2.0 over stdio; scripted deterministic responses.

Until upstream VAC PR #1 lands, bridge integration tests spawn `mock-engine` instead of the real engine.

## Usage

```bash
cargo run -p mock-engine -- --stdio --profile assessor.rtd@1.0.0 --seed 42
```

Flags:
- `--stdio` — required; picks stdio transport.
- `--profile <id@version>` — advertised but not enforced.
- `--session-id <ulid>` — otherwise defaults to a fixed ULID for determinism.
- `--project <path>` — advertised only.
- `--seed <u64>` — stable RNG for message IDs.

## Supported methods

| Method | Response |
|---|---|
| `system.ping` | `{pong: true}` |
| `system.version` | `{bridge, engine}` |
| `message.submit` | `transcript.message_added` + 5× `transcript.delta` + `transcript.completed` + response |
| `message.cancel_stream` | `transcript.error` + response |
| `approval.approve` | `approval.resolved` + response |
| `approval.reject` | `approval.resolved` + response |
| `session.close` | `session.closed` + response |

Unknown method → JSON-RPC error `-32601 method not found`.

## Startup

Emits `session.ready` notification immediately on stdout.

## Log output

Logs to stderr (structured via `tracing`). `VAC_MOCK_LOG=debug cargo run -p mock-engine -- --stdio` for verbose.

## Phase 1 relevance

Plans 1.1–1.4 spawn this binary in integration tests. Plan 1.7 red-team cases at bridge layer use it to stand-in for engine.
