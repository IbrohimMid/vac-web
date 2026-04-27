# ACP Smoke Harness

VAC Web ACP smoke mode is intentionally chat-only. It exercises the
bridge-owned ACP transport path, debug capture, and prompt/cancel
round-trip without enabling filesystem or terminal capabilities.

## Prerequisites

- Claude smoke uses the ACP adapter package
  `@agentclientprotocol/claude-agent-acp` via the bundled fixture, not
  the global `claude --acp` CLI.
- Claude smoke uses the host's Claude Code OAuth session that backs
  the adapter; it does not gate on `ANTHROPIC_API_KEY`.
- On this machine, the bridge/test harness auto-resolves a host
  `claude` CLI into `CLAUDE_CODE_EXECUTABLE` when that env var is
  unset, so local smoke can avoid the native SDK binary path if needed.
- If the adapter advertises a Claude login method, complete that login
  flow once on the host before rerunning the smoke.
- OpenCode smoke still uses the `opencode` binary on `PATH`.
- Set `VAC_WEB_ACP_DEBUG=1` so the bridge mirrors ACP wire traffic as
  `acp.debug_message`.
- Point `VAC_WEB_AGENTS_CONFIG` at an ACP agent config for the
  provider you want to smoke.

## Example configs

Use the bundled fixtures:

- [fixtures/agents.claude-agent-acp.toml](../fixtures/agents.claude-agent-acp.toml)
- [fixtures/agents.opencode.toml](../fixtures/agents.opencode.toml)

## Commands

Claude smoke:

```bash
VAC_WEB_ACP_DEBUG=1 \
VAC_WEB_AGENTS_CONFIG=./fixtures/agents.claude-agent-acp.toml \
cargo test -p local-bridge claude_acp_smoke -- --ignored
```

OpenCode smoke:

```bash
VAC_WEB_ACP_DEBUG=1 \
VAC_WEB_AGENTS_CONFIG=./fixtures/agents.opencode.toml \
cargo test -p local-bridge opencode_acp_smoke -- --ignored
```

## Expected events

The smoke verifies the following bridge-visible sequence:

1. `session.ready`
2. `acp.debug_message` for the outgoing `session/prompt`
3. `transcript.delta`
4. `message.cancel_stream` ack
5. `transcript.completed` or `transcript.error`

The debug tap may also emit earlier `acp.debug_message` frames for
`initialize` and `session/new`; that is expected.

## Notes

- The harness stays chat-only by design.
- Unsupported ACP tool requests are still denied by the bridge and are
  not part of this smoke.
- If the provider exits or returns an error, the smoke should surface it
  as `transcript.error` rather than hanging.
