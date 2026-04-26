# Stage X.5d — ACP Reauth Flow

**Status.** Design plan. This slice starts from ACP `auth_methods`
surfacing and grows toward a Zed-style reauth affordance without
opening fs/terminal ACP capability yet.

**Goal.** Make VAC Web show ACP auth state and a bridge-owned reauth
flow that mirrors Zed's adapter-managed login experience.

**Depends on.**

- Stage X.5b ACP client and Stage X.5c approval/permission bridge.
- The current `session.ready` transport path.
- The `@agentclientprotocol/claude-agent-acp` adapter fixture.

## 1. Problem

Zed already treats auth as an adapter concern: the adapter advertises
auth methods, the client renders the login affordance, and the user
reauthenticates inside the IDE. VAC Web currently captures the
initialize response but does not expose the auth metadata to the user
or a follow-up flow.

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
- terminal auth remains out of scope until the terminal ACP capability
  is explicitly enabled.

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

### 3.3 Reauth command

Proposed cockpit command: `session.authenticate`.

Proposed bridge payload:

```json
{
  "auth_method_id": "openai",
  "input": {
    "AZURE_OPENAI_API_KEY": "...",
    "AZURE_OPENAI_ENDPOINT": "..."
  }
}
```

Bridge behavior by auth type:

- `agent`: adapter-managed auth, bridge surfaces the method and waits
  for the adapter to complete.
- `env_var`: bridge collects values, restarts the adapter with the new
  env, then sends the adapter's auth handshake.
- `terminal`: deferred until terminal ACP capability is enabled.

## 4. Guardrails

- Do not enable `fs/read_text_file`, `fs/write_text_file`, or any
  `terminal/*` ACP capability to make reauth work.
- Do not move policy authority into the adapter.
- Do not permit mid-session agent switches.
- Do not reopen Stage K.

## 5. Exit criteria

This plan is done when:

1. ACP sessions carry `auth_methods` into `session.ready`.
2. The cockpit visibly labels ACP auth state.
3. The bridge can distinguish "auth advertised" from "auth required".
4. The reauth command shape is documented and wired through the
   control plane.

The terminal-auth leg remains a later milestone.
