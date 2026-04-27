# Stage X.5d — ACP Reauth Flow

**Status.** Slice 1 (auth metadata surfacing) shipped at
`753301eae273d1320f2bf7ab1cf51352eb2f8936`. Slice 2 (bridge-owned
`session.authenticate` action flow) is the current implementation
slice and lands the agent + env_var (soft) + audit + UI legs together.
Live adapter restart for `env_var` and the full `terminal` leg remain
deferred follow-ups; the cockpit's primary path — OAuth Claude Pro/Max
via `agent`-type method — is fully wired.

**Goal.** Make VAC Web show ACP auth state and a bridge-owned reauth
flow that mirrors Zed's adapter-managed login experience.

**Depends on.**

- Stage X.5b ACP client and Stage X.5c approval/permission bridge.
- The current `session.ready` transport path.
- The `@agentclientprotocol/claude-agent-acp` adapter fixture.

## 1. Problem

Zed already treats auth as an adapter concern: the adapter advertises
auth methods, the client renders the login affordance, and the user
reauthenticates through the adapter's Claude Code OAuth login flow
inside the IDE. VAC Web currently captures the initialize response but
does not expose the auth metadata to the user or a follow-up flow.

That leaves two gaps:

1. The cockpit cannot tell the user what auth mode the ACP adapter
   supports.
2. There is no bridge-owned place to route a reauth request when the
   adapter requires one.

## 2. Design target

VAC should surface ACP auth state at the same trust boundary as the
rest of the runtime:

- bridge captures `initialize.authMethods`;
- bridge forwards auth metadata through `session.ready`;
- web surfaces a compact auth badge and detail panel;
- reauth requests stay bridge-owned, not provider-owned;
- terminal ACP capability stays off; bridge-owned launcher metadata
  can still open the host Claude Code login flow without enabling
  `terminal/*`.

## 3. Proposed shape

### 3.1 Session metadata

`session.ready` should carry:

- `agent_id`
- `agent_kind`
- `auth_methods`

The web store keeps the current session auth metadata so the cockpit
can render it without re-querying the agent.

### 3.2 UI surfaces

- Topbar shows a compact auth badge for ACP sessions.
- Session picker shows the same status inline when the session is
  active.
- Memory rail shows the advertised auth methods and any notes the
  adapter includes.
- Active-session banner exposes a `ReauthAction` button row, one per
  advertised method, that issues `session.authenticate`. Disabled state
  reflects `authStatus === 'requesting'`; failure surface includes the
  stable error code and bridge message.

### 3.3 Reauth command

Cockpit command: `session.authenticate`. Bridge-owned dispatch via
`translator/mod.rs`. KNOWN_COMMANDS gate enforces the profile-layer
allowlist; the command never reaches the agent runtime when the
session is not ACP.

Bridge payload:

```json
{
  "auth_method_id": "claude-login"
}
```

The bridge owns audit + ServerEvent emission for every dispatch:

- `session.auth_requested` — `{ auth_method_id }`
- `session.auth_updated` — `{ auth_method_id, auth_method_type, status }`
- `session.auth_failed` — `{ auth_method_id, auth_method_type?, code, message, vars? }`

Behaviour matrix (implemented in `SessionHandle::authenticate_via_acp`):

| Case | Outcome |
| --- | --- |
| Non-ACP session | ack + event `auth.not_supported` |
| Missing `auth_method_id` | ack + event `auth.invalid_payload` |
| Method not in advertised list | ack + event `auth.method_not_advertised` |
| `terminal` method | if `_meta.terminal-auth` is absent: ack + event `auth.terminal_capability_disabled` (HOLD); if present: bridge launches the local login command and proxies its status |
| `env_var` method | ack + event `auth.env_var_recreate_required` carrying `vars` (soft path) |
| `agent` method | direct ACP `authenticate({ methodId })` passthrough; bridge proxies status |
| Adapter JSON-RPC failure | ack + event with classified bridge code (default `agent.protocol_error`) |

`agent`-type passthrough is the OAuth Claude Pro/Max path: the adapter
handles the browser OAuth / Claude Code login handshake itself; the
bridge only surfaces the lifecycle.

`terminal`-type auth is the adapter-advertised launcher path used when
the adapter provides `_meta.terminal-auth`. The bridge runs the
command locally, keeps `terminal/*` ACP off, and surfaces the result as
`session.auth_updated` / `session.auth_failed`.

For local dogfood on this repo, the bridge will also auto-fill
`CLAUDE_CODE_EXECUTABLE` with the host `claude` binary when the env var
is absent. That avoids the native SDK crash path we saw on this host
without changing the adapter contract.

`env_var` soft path tells the cockpit which env vars to recreate the
session with, but does not restart the adapter live. Live
restart/reinitialize lands as a follow-up commit because it requires
holding the `AcpRuntime` slot under a write lock, draining
watchdog/pump tasks, and re-spawning under the same `SessionHandle` —
worth its own slice with dedicated tests.

### 3.4 Cockpit store

`stores/session.ts` carries `authStatus`, `authError`, and
`lastAuthMethodId` alongside the existing `authMethods`. The handler
layer mirrors the three lifecycle events into those fields; the
ReauthAction component renders them.

## 4. Guardrails

- Do not enable `fs/read_text_file`, `fs/write_text_file`, or any
  `terminal/*` ACP capability to make reauth work.
- Do not move policy authority into the adapter.
- Do not permit mid-session agent switches.
- Do not reopen Stage K.
- Do not treat `ANTHROPIC_API_KEY` as the Claude ACP auth source for
  this flow; OAuth login through Claude Code is the source of truth.

## 5. Exit criteria

This plan is done when:

1. ACP sessions carry `auth_methods` into `session.ready`. ✅ (slice 1)
2. The cockpit visibly labels ACP auth state. ✅ (slice 1)
3. The bridge can distinguish "auth advertised" from "auth required". ✅ (slice 1)
4. The reauth command shape is documented and wired through the
   control plane. ✅ (slice 2)
5. Cockpit can issue `session.authenticate` for `agent`-type methods
   end-to-end (audit + events + UI). ✅ (slice 2)
6. `env_var` recreate path is surfaced as a soft, structured failure
   so cockpit can guide the user to recreate the session. ✅ (slice 2)
7. `terminal`-type methods are explicitly held off, not silently
   ignored. ✅ (slice 2)

The live `env_var` adapter restart and the full `terminal` capability
leg remain later milestones.
