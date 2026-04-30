# `session/load` fixtures

These fixtures drive `mock-acp --load-session <dir>` for the Stage X6 native
resume tests. Each fixture is a directory containing an `events.jsonl` file.
Every non-empty line is parsed as a JSON object and dropped into the `update`
field of a `session/update` notification streamed to the bridge **before** the
`session/load` JSON-RPC response is returned. This mirrors the real ACP
contract where the agent re-streams session content during load.

## Layout

- `basic/events.jsonl` — a small replay sequence (user/agent message chunks)
  used by the happy-path native-resume tests.
- `unsupported/` — intentionally empty; pair with `--reject-load` to simulate
  agents that advertise `loadSession` but reject the call. (The directory is
  kept so test fixtures can pin a path even when no replay is expected.)

## Adding a new fixture

1. Create `<name>/events.jsonl`.
2. Each line is a JSON value matching ACP's `SessionUpdate` shape, e.g.:
   `{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}`
3. Reference it from a test as
   `--load-session tools/mock-acp/fixtures/load-session/<name>`.
