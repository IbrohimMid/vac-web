# Multi-provider runbook

Local-bridge can run more than one ACP agent at once. The cockpit
renders a provider picker on `Sessions → Create session` so each
session can target a specific agent without mutating the global default
or restarting the bridge between providers.

This runbook is the operator-facing summary. For the per-provider deep
dive read [`gemini-acp-smoke.md`](./gemini-acp-smoke.md) and
[`acp-smoke.md`](./acp-smoke.md). The protocol shape is documented in
[`agent-runtime.md`](./agent-runtime.md).

## Pieces

- **Fixture** — [`fixtures/agents.multi.toml`](../fixtures/agents.multi.toml).
  Ships Claude Agent ACP as the default and Gemini CLI ACP as the
  opt-in. Both run in `dialect = "zed-acp"` with `cwd_mode =
  "project-root"` and a tight `env_allow` list.
- **Welcome frame** — every WS connection now receives an
  `available_agents: [{id,label,kind,default}]` array that mirrors the
  bridge's enabled `AgentRuntimeRegistry`. Disabled agents are
  filtered out before the field hits the wire.
- **Cockpit picker** — `SessionPicker` renders an `<select aria-label="Agent">`
  whenever the welcome advertises one or more agents. The default flag
  controls the initial selection. The picker forwards `agent_id` in
  the `session.create` payload only when non-empty so the legacy
  single-binary shim path stays back-compatible.
- **Ack timeout** — `transport/correlation.ts` now defaults to **90s**
  (`DEFAULT_ACK_TIMEOUT_MS`) so a cold ACP `initialize` (Gemini OAuth
  warm-up, large prompt cache, etc.) does not surface as `ack timeout:
  cmd_*` while the bridge is still genuinely waiting on the agent.

## Run the bridge with multi-provider

```
VAC_AGENTS_FILE=fixtures/agents.multi.toml \
  cargo run --release -p local-bridge
```

(Or set `VAC_AGENTS_FILE` in the systemd/launchd unit you already use.)

Verify the registry was loaded:

```
curl -s http://127.0.0.1:38500/api/version | jq .
```

Then connect the cockpit (or `wscat`) and confirm the welcome frame
contains `available_agents` with both `claude-acp` and `gemini-acp`.

## Pre-step per provider (one-time)

| Provider     | Pre-step                                     | Notes                                                           |
| ------------ | -------------------------------------------- | --------------------------------------------------------------- |
| `claude-acp` | `npx -y @agentclientprotocol/claude-agent-acp` once | First spawn caches the package; bridge then re-uses it. |
| `gemini-acp` | `gemini` (interactive) → `/auth`             | OAuth credential lands in `~/.gemini/oauth_creds.json`.         |

Running these once before the first session avoids the long initial
boot. The 90s ack timeout absorbs the residual cost on subsequent
cold starts.

## Pick an agent in the cockpit

1. Open the cockpit in the browser.
2. `Sessions` → `Create session`.
3. The **Agent** dropdown shows every advertised agent. The default
   is preselected (Claude in `agents.multi.toml`).
4. Pick `Gemini CLI ACP` only when you want Gemini for that session.
   Leaving the default keeps the existing Claude Code flow.
5. Submit. The bridge routes `session.create` to the chosen agent.

## Common errors

### `ack timeout: cmd_*` on first Gemini session

What: cockpit gives up on `session.create` while the bridge still has
the ACP `initialize` request in flight.

Mitigation:

1. Confirm `gemini auth login` was run (the OAuth blob exists in
   `~/.gemini/oauth_creds.json`). Without it the agent stalls on
   browser auth and never acks.
2. Confirm the FE bundle includes `DEFAULT_ACK_TIMEOUT_MS = 90_000`
   (rebuild `apps/web` after pulling Stage X.5e+).
3. If Gemini genuinely takes >90s on the first run, bump the constant
   for that deployment instead of paper-tigering it via per-call
   overrides.

### `Profile: unknown` on the orphan session row after a timeout

The ack timeout aborts the FE wait, but the bridge can still finish
spawning the agent and end up with a session row the cockpit never
binds to. Symptoms: row shows `profile=unknown`, `clients=0`,
`status=active`.

Resolution: send `session.close` for that `session_id` (e.g. via the
Sessions row "Close" action once it lands, or via `wscat` echo). The
reaper sweeps idle sessions but `session.close` is faster.

### `agent.not_registered` on `session.create`

The FE sent an `agent_id` the bridge does not know. Either the
fixture file the bridge loaded doesn't list that agent, or the agent
is disabled. Compare the welcome frame's `available_agents` against
the payload.

### `auth.terminal_auth_not_allowed`

Terminal auth is hard-allowlisted to `gemini-acp`. If you renamed the
fixture id (e.g. `gemini-cli` instead of `gemini-acp`) the allowlist
will reject the reauth attempt. Keep the canonical id.

## Adding a third provider

1. Copy a fixture entry in `agents.multi.toml`. Keep `kind = "acp"`
   and an explicit `enabled = true`.
2. Make sure `command` is on `PATH` of the bridge process and that
   `env_allow` covers any tokens / config dirs the agent needs.
3. Restart the bridge. The new entry shows up in the welcome frame
   automatically; the cockpit picker updates on next reconnect.
4. If the agent expects a specific reauth UX, check the per-provider
   smoke doc — terminal-auth allowlist changes are bridge-side and
   need a new commit, not just a fixture edit.
