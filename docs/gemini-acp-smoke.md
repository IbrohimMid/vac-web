# Gemini CLI ACP — local smoke checklist

Local-bridge ships a `gemini-acp` provider that delegates to the
official Gemini CLI in ACP mode (`gemini --acp`, Gemini CLI 0.36+).
Unlike `claude-agent-acp`, Gemini CLI does not advertise an ACP-style
auth method itself — the bridge synthesises a Zed-style
`spawn-gemini-cli` terminal-auth method so the cockpit's reauth flow
launches `gemini` (no extra args) interactively for `gemini /auth`.

The bridge is the policy point. Terminal auth is hard-allowlisted to
`agent_id == "gemini-acp"` and the advertised command's basename must
match the configured agent command. ACP runtime flags (`--acp`,
`--experimental-acp`) are stripped from the auth invocation so the
login flow runs in interactive mode, not ACP server mode.

## Preflight (one-time)

```
which gemini && gemini --version
gemini --help | grep -iE 'acp|auth'
```

Expected: `gemini` resolves to `/usr/local/bin/gemini` (or your
preferred install), version >= 0.36, and `--acp` is listed (the
deprecated `--experimental-acp` flag is also accepted but `--acp` is
the canonical form).

## Run the bridge

```
VAC_WEB_ACP_DEBUG=1 \
VAC_WEB_AGENTS_CONFIG=/home/emp/Documents/VAC/vac-web/fixtures/agents.gemini-acp.toml \
RUST_LOG=info,local_bridge=debug,acp=debug \
cargo run -p local-bridge
```

## Run the cockpit

```
pnpm --filter @vac-web/web dev
```

Open http://localhost:5173 and:

1. **Create session** with profile `executor.code@1.0.0`.
2. Project root = `/home/emp/Documents/VAC/vac-web` (or another repo).
3. Confirm in `session.ready`:
   - `agent_id = gemini-acp`
   - `agent_kind = acp`
   - `auth_methods` includes an entry with `id = "spawn-gemini-cli"`
     and `type = "terminal"`. (Bridge synthesised this entry; Gemini
     CLI itself does not advertise it.)
4. **If not logged in**, click `Reauth: Login with Gemini CLI` in the
   cockpit. The bridge launches `gemini` (no `--acp`) in the
   bridge's terminal so you can complete `gemini /auth` interactively.
   The audit log records `terminal_auth_launch` with the command
   basename (`gemini`) and arg count — never the raw secret.
5. After login, send the smoke prompt from the composer:
   ```
   Gemini ACP smoke from VAC Web. Reply in one short sentence. Do not edit files. Do not run shell commands.
   ```

## Expected events

- `session.ready` (with `auth_methods` shown above)
- (if reauth flow) `session.auth_requested` → `session.auth_updated`
  with `auth_method_type = "terminal"`
- `transcript.delta` / `transcript.completed` from Gemini

## Failure modes (and what they mean)

- `auth.terminal_auth_not_allowed` — the agent is not on the
  bridge's terminal-auth allowlist. Currently only `gemini-acp` is
  allowlisted.
- `auth.command_invalid` — the advertised terminal-auth command's
  basename did not match the configured agent command, or args
  contained `--acp` / `--experimental-acp`. This is the harden gate
  that blocks a malicious adapter from advertising an arbitrary
  command.
- `auth.command_failed` — the auth command spawned but exited
  non-zero. Re-run with stderr visible (the bridge inherits stderr
  for terminal auth).

## What this milestone deliberately does **not** do

- It does not enable ACP `terminal/*` tool capability. Bridge-driven
  terminal auth and ACP terminal tools are two different surfaces;
  the latter remains disabled.
- It does not implement live `env_var` reauth (still fails with
  `auth.env_var_recreate_required`).
- It does not assume an interactive TTY for Gemini login. If your
  install requires a TTY, run the bridge from a real terminal.
