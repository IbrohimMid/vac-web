# Stage X.5 / X.6 — Real Claude Code ACP Verification Note

> **Update 2026-04-26 (research finding).** The Agent Client Protocol is
> a real, documented protocol with a public TypeScript SDK
> (`@agentclientprotocol/sdk`). Zed ships a Claude adapter
> (`@zed-industries/claude-code-acp`, now renamed to
> `@agentclientprotocol/claude-agent-acp`) that implements the Agent
> side of ACP and drives the Claude Code SDK underneath. **This is the
> path we should take**: VAC bridge becomes an ACP *Client*, spawns the
> packaged Agent, and speaks the official protocol. The
> `claude --print --output-format stream-json` adapter (previously §11
> recommendation) is now demoted to a fallback used only if the Agent
> binary cannot be installed in the target environment. See §12.

**Status.** Pre-implementation evidence collection. **No code changes** land
until every section below is filled in against a real `claude` binary. The
agent runtime design lock at [`../agent-runtime.md`](../agent-runtime.md) marks
the `--acp` flag as **PROVISIONAL**; this document is what removes that
marker.

**Baseline.** `d136b8a` — Stages X.1–X.4 locked.

**Why a verification gate exists.** The mock-acp scaffold (X.3) emits a
toy envelope (`{"type":"prompt","text":...}` ↔ `assistant_message_chunk`
+ `assistant_message_complete`). The real ACP wire format is whatever
the upstream `claude` CLI actually speaks. Until we observe it, any
permission-bridge / tool-translation code we write is fiction. So:
**capture envelopes first, code second.**

> Do **not** implement the Stage X.5 permission bridge or the Stage X.6
> handshake until the placeholders below carry real, copy-pasted output.

---

## 1. Local environment

| Field | Value |
| --- | --- |
| Operator | local agent (vac-web repo, run from inside Claude Code itself) |
| Date of capture | 2026-04-26 |
| Host OS | Linux 6.8.0-110-generic |
| Shell | bash |
| Working directory | `/home/emp/Documents/VAC/vac-web` |
| Network egress permitted? | unverified for this capture (offline-friendly checks only) |

## 2. Binary discovery

```bash
which claude
claude --version
```

Captured output:

```text
/usr/local/bin/claude
2.1.111 (Claude Code)
```

Notes:
- Binary is the Claude **Code** CLI 2.1.111 (npm install path under `/usr/local/bin/`).
- Auth state was not exercised here — `--version` and `--help` work without it.

## 3. Top-level help

```bash
claude --help
```

Captured output (truncated to the parts that matter for ACP routing —
full output is reproducible from a real local run):

```text
Usage: claude [options] [command] [prompt]

Claude Code - starts an interactive session by default, use -p/--print
for non-interactive output

Options:
  --add-dir <directories...>
  --agent <agent>
  --agents <json>                                   custom-agents JSON
  --allow-dangerously-skip-permissions
  --allowedTools, --allowed-tools <tools...>
  --append-system-prompt <prompt>
  --bare                                            minimal mode
  --betas <betas...>
  --brief                                           SendUserMessage tool
  --chrome / --no-chrome
  -c, --continue
  --dangerously-skip-permissions
  -d, --debug [filter]
  --debug-file <path>
  --disable-slash-commands
  --disallowedTools <tools...>
  --effort <level>
  --exclude-dynamic-system-prompt-sections
  --fallback-model <model>
  --file <specs...>
  --fork-session
  --from-pr [value]
  -h, --help
  --ide
  --include-hook-events                             stream-json hooks
  --include-partial-messages                        stream-json partials
  --input-format <format>                           text | stream-json
  --json-schema <schema>
  --max-budget-usd <amount>
  --mcp-config <configs...>
  --mcp-debug                                       [DEPRECATED]
  --model <model>
  -n, --name <name>
  --no-session-persistence
  --output-format <format>                          text | json | stream-json
  --permission-mode <mode>                          acceptEdits | auto |
                                                    bypassPermissions |
                                                    default | dontAsk | plan
  --plugin-dir <path>
  -p, --print
  --remote-control-session-name-prefix <prefix>
  --replay-user-messages
  -r, --resume [value]
  --session-id <uuid>
  --setting-sources <sources>
  --settings <file-or-json>
  --strict-mcp-config
  --system-prompt <prompt>
  --tmux
  --tools <tools...>
  --verbose
  -v, --version
  -w, --worktree [name]

Commands:
  agents          List configured agents
  auth            Manage authentication
  auto-mode       Inspect auto mode classifier configuration
  doctor          Auto-updater health
  install         Install Claude Code native build
  mcp             Configure and manage MCP servers
  plugin|plugins  Manage Claude Code plugins
  setup-token     Long-lived auth token
  update|upgrade  Check for updates
```

Findings that matter for Stage X.5:
- **No `--acp` flag** in the option list.
- **No `acp` subcommand** in the `Commands:` block.
- The closest machine-mode is `-p / --print` combined with
  `--input-format stream-json` and `--output-format stream-json`.
- A `--permission-mode` flag exists with the values
  `acceptEdits | auto | bypassPermissions | default | dontAsk | plan`
  — useful for X.5 design but NOT a wire-level permission protocol.
- `--mcp-config` is the closest thing to a "wire-level extension" point:
  Claude Code can connect to MCP servers, which is a distinct protocol
  from ACP.

## 4. ACP-specific help

Tried every shape suggested in the audit:

```bash
claude --acp --help        # treated `--acp` as unknown; help printed verbatim
claude acp --help          # treated `acp` as positional prompt; help printed verbatim
claude serve --help        # `serve` is not in the Commands: list either
```

Captured behavior:

```text
$ claude --acp --help
Usage: claude [options] [command] [prompt]
... (identical to `claude --help`; no ACP-specific section)

$ claude acp --help
Usage: claude [options] [command] [prompt]
... (identical; `acp` is parsed as a positional prompt token)
```

**Conclusion (negative result, recorded so we don't redo this):**

> Claude Code **2.1.111** does **not** expose an Agent Client Protocol
> mode. The PROVISIONAL marker on `--acp` in [`../agent-runtime.md`](../agent-runtime.md)
> is correct, and Stage X.6's "real handshake" cannot land against this
> binary as-is. Implementation must take a §11 fallback before X.5/X.6
> can be coded.

Practical implication: **mock-acp** stays as the X.3 driver subject
under test. X.5 design must target one of the §11 fallbacks rather
than a literal `--acp` invocation.

## 5. Stdin → stdout transcript capture

Goal: a single round-trip prompt under the real binary, captured to disk.

Suggested capture script (adjust to whatever §4 says):

```bash
mkdir -p /tmp/vac-acp-cap
script -q -c '
  printf "%s\n" "{\"type\":\"prompt\",\"text\":\"hello, what is 1+1?\"}" \
    | claude <ACP_ARGS_FROM_§4>
' /tmp/vac-acp-cap/session.log
```

Or, if a more structured handshake is required, use a tiny Rust/Node
harness — whatever lets us see the bytes verbatim.

Captured stdout (verbatim, including framing characters):

```text
<paste; if length-prefixed, include the byte counts>
```

Captured stderr (verbatim):

```text
<paste>
```

Exit status: `<n>`

## 6. Envelope inventory

For each distinct envelope shape observed, fill one row. Add rows as
needed.

| # | Direction | `type` / discriminator | Required fields | Optional fields | Notes |
| - | --------- | ---------------------- | ---------------- | ---------------- | ----- |
| 1 | server→client | _e.g. `session_started`_ | _e.g. `session_id`_ | _e.g. `model`_ | |
| 2 | server→client | _e.g. `assistant_message_chunk`_ | _e.g. `text`_ | | |
| 3 | server→client | _e.g. `assistant_message_complete`_ | | | |
| 4 | server→client | _permission/tool request_ | | | **critical for X.5** |
| 5 | client→server | _prompt_ | | | |
| 6 | client→server | _permission decision_ | | | |
| 7 | … | | | | |

For each envelope marked **critical for X.5**, paste the literal JSON
under §7 with the field meanings annotated.

## 7. Permission / tool envelope (Stage X.5 dependency)

This is the gate. Without it we cannot wire `approval.pending` ↔ ACP
modal-halt.

Captured request (server → bridge):

```json
<paste>
```

Captured grant (bridge → server):

```json
<paste>
```

Captured deny (bridge → server):

```json
<paste>
```

Open questions to record while you have the binary running:
- Does the request carry an opaque correlation id we must echo back?
- Is there a deadline / timeout in the request? What units?
- Does denial require a reason string?
- Does the server retry on timeout, or close the session?
- Does a denied request advance the transcript or rollback the turn?

## 8. Crash / error behavior

- Kill the child mid-stream (`SIGTERM`, `SIGKILL`). Exit code? Partial
  envelope in stdout?
- Send a malformed envelope. Does the child crash, error-line, or
  silently ignore?
- Exceed any documented limits (token / shell / file). What does the
  child emit?

Capture:

```text
<paste relevant fragments>
```

## 9. Decisions to lock before X.5/X.6 implementation

After the captures above, **record one-line decisions** here. These
become the X.5/X.6 design lock.

- Canonical ACP launch command:
  `<bin> <args…>`  →  _fill in_
- stdin framing: _line-JSON / length-prefixed / other_  →  _fill in_
- stdout framing: _same field_
- Permission request envelope discriminator: _fill in_
- Permission grant/deny envelope shape: _fill in_
- Default timeout we will enforce on the bridge side:
  _<= 5 min unless §7 says otherwise_
- Behavior on timeout: _auto-deny + audit_
- Behavior on child crash mid-permission: _treat as denied, transcript.error_
- ACP envelope set wired in X.5 (whitelist): _fill in_
- Anything outside that whitelist returns: _`agent.protocol_unsupported`_

## 10. Go / no-go for X.5/X.6

Updated after §12 research:

- [x] §2–§3 produce a stable ACP invocation
      → `claude-code-acp` from `@zed-industries/claude-code-acp@0.16.2`
      (renaming to `@agentclientprotocol/claude-agent-acp`).
- [x] §12.2 captures one round-trip without errors
      → `initialize` request + response captured verbatim.
- [x] §12.3 inventory covers every envelope we plan to map
      → 11 SessionUpdate variants + the four agent methods + the four
      client methods + permission/file/terminal RPCs.
- [x] §12.3 permission envelope documented at the schema level
      → `RequestPermissionRequest { sessionId, toolCall, options }` →
      `RequestPermissionResponse { outcome }`. **Live capture under
      auth still required before X.5b coding.**
- [ ] §8 failure modes captured against real Agent
      → next: kill mid-prompt, malformed JSON, auth failure.
- [x] §12.5 decision recorded.

State: **5/6.** Authority granted to plan X.5a–X.5c (see
[`./10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md)). Live
permission capture under a logged-in `claude` is the gate before X.5b
implementation begins.

## 11. ~~Fallback path — selected after §3/§4 captures~~ DEMOTED

The earlier recommendation (`claude --print --output-format stream-json`)
is **demoted to a fallback**. Reason: the Agent Client Protocol exists
as a documented standard with a published TypeScript SDK and a
ready-made Claude adapter. We should target the standard, not invent a
private one on top of stream-json.

The stream-json route is preserved here only as a contingency for
environments where the ACP adapter cannot be installed. If used, it
must wear the same `@agentclientprotocol/sdk` *shape* on the bridge
side so callers see one stable interface.

## 12. Official ACP path — research findings (2026-04-26)

### 12.1 Packages

| Package | Version observed | Role |
| ------- | ---------------- | ---- |
| `@agentclientprotocol/sdk` | `0.14.1` | Protocol definition + TS client/server runtime |
| `@zed-industries/claude-code-acp` | `0.16.2` | ACP Agent that drives Claude Code SDK |
| `@agentclientprotocol/claude-agent-acp` | (rename) | New name of the package above; migrate before pinning |
| `@anthropic-ai/claude-agent-sdk` | (transitive) | Claude SDK used by the ACP Agent under the hood |

The shipping CLI:

```bash
npm install -g @zed-industries/claude-code-acp
# observed deprecation:
#   "This package has been renamed to @agentclientprotocol/claude-agent-acp."
which claude-code-acp
# → <prefix>/bin/claude-code-acp
```

The binary entrypoint immediately calls `runAcp()` from
`acp-agent.js`, which wires `AgentSideConnection` from
`@agentclientprotocol/sdk` to stdin/stdout (ndjson stream).

### 12.2 Captured `initialize` round-trip

Sent (line-delimited JSON-RPC 2.0 over stdin):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":false}}}
```

Received (single line on stdout, formatted here for readability):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "promptCapabilities": { "image": true, "embeddedContext": true },
      "mcpCapabilities": { "http": true, "sse": true },
      "loadSession": true,
      "sessionCapabilities": {
        "fork": {},
        "list": {},
        "resume": {}
      }
    },
    "agentInfo": {
      "name": "@zed-industries/claude-code-acp",
      "title": "Claude Code",
      "version": "0.16.2"
    },
    "authMethods": [
      {
        "description": "Run `claude /login` in the terminal",
        "name": "Log in with Claude Code",
        "id": "claude-login"
      }
    ]
  }
}
```

This is the smoking gun: real ACP, real protocol version 1, real
JSON-RPC 2.0 framing over ndjson, working without auth (auth is only
needed at `prompt` time). Any X.5 design must match this.

### 12.3 `@agentclientprotocol/sdk` v0.14.1 method surface

Captured from `dist/acp.d.ts` and `schema/schema.json` shipped in the
installed package.

**Agent → Client requests** (Client implements):

| Method | Required params | Purpose |
| ------ | --------------- | ------- |
| `sessionUpdate` (notification) | `sessionId, update` | Streamed updates from agent. Tagged union — see §12.4. |
| `requestPermission` | `sessionId, toolCall, options` | **Modal halt** — agent waits for `outcome`. This is the X.5 bridge target. |
| `readTextFile` | `sessionId, path` (optional `line`, `limit`) | Agent asks editor to read on its behalf (deny-listed paths enforced client-side). |
| `writeTextFile` | `sessionId, path, content` | Same, write side. |
| `createTerminal` | `sessionId, command` (optional `args, cwd, env, outputByteLimit`) | Spawn a terminal under client supervision. |
| `terminalOutput` | — | Read terminal output. |
| `releaseTerminal` / `waitForTerminalExit` / `killTerminalCommand` | — | Lifecycle. |

**Client → Agent requests** (Agent implements):

| Method | Required params | Purpose |
| ------ | --------------- | ------- |
| `initialize` | `protocolVersion` | Capability handshake. Captured above. |
| `newSession` | `cwd, mcpServers` | Open a new session. Returns `sessionId`, optional `models`, `modes`, `configOptions`. |
| `loadSession` (capability-gated) | `sessionId, …` | Resume a stored session. |
| `setSessionMode` (optional) | — | Switch model mode. |
| `prompt` | `sessionId, prompt` | Send user turn; result carries `stopReason` + `usage`. |
| `cancel` (notification) | `sessionId` | Abort current turn. |

**`SessionUpdate` discriminator** (`update.sessionUpdate` field):

```text
user_message_chunk         agent_message_chunk         agent_thought_chunk
tool_call                  tool_call_update            plan
available_commands_update  current_mode_update         config_option_update
session_info_update        usage_update
```

Eleven variants. The mappings below tell us how to pump these into VAC
events without inventing semantics:

| ACP variant | VAC event |
| ----------- | --------- |
| `agent_message_chunk` | `transcript.delta` (existing) |
| `agent_thought_chunk` | `transcript.delta` with `kind="thought"` (new flag, optional) |
| `tool_call` / `tool_call_update` | drives `review.changeset_updated` + `runtime.job_log` depending on `ToolKind` |
| `plan` | `plan.updated` (existing in protocol catalog) |
| `available_commands_update` | informational — surface to Composer slash palette later |
| `current_mode_update` | informational — surface to Build agent lane |
| `usage_update` | `agents.lane_state` token-usage field (optional) |
| `session_info_update` | session metadata audit log only |

`requestPermission` arrives as a *separate* request (not a SessionUpdate
variant) and is the X.5 wire target — bridge's existing
`approval.pending` queue fills `outcome`.

### 12.4 Authentication

The Agent advertises one auth method id `"claude-login"` whose
description is `"Run \`claude /login\` in the terminal"`. The
Anthropic Claude Code CLI is the underlying transport; auth state is
shared with whatever credentials `claude` already has on disk. For
VAC's purposes this means:

- If the operator has run `claude /login` on the host, the ACP Agent
  will Just Work for prompts.
- If not, `prompt` will fail with an `authenticate` requirement; the
  bridge surfaces it as a notify-event and points the user at the
  CLI.

### 12.5 Decision (post-research)

We target the **official ACP** path:

1. Bridge becomes an ACP **Client** using a Rust port (or a small Node
   sidecar that re-uses `@agentclientprotocol/sdk` directly).
2. Bridge spawns `claude-code-acp` (or successor
   `@agentclientprotocol/claude-agent-acp`) as the configured `acp`
   agent in `agents.toml`. Args are resolved by the registry.
3. Bridge translates between ACP `SessionUpdate` / `requestPermission`
   / file-system / terminal RPCs and existing VAC events
   (`transcript.*`, `review.*`, `runtime.*`, `approval.*`).
4. Stream-json adapter from the demoted §11 stays as fallback only.

**Implication for X.5 / X.6:** the existing `mock-acp` driver was a
useful scaffold but the wire shape it speaks (`{type:"prompt", text}`
↔ `{type:"assistant_message_chunk", text}`) is **not ACP**. X.5a
re-targets the AcpDriver onto the real ACP wire. mock-acp can be
upgraded later to speak real ACP for offline tests; for now we keep it
to anchor the X.3 contract while X.5 work proceeds.

---

## Cross-links

- [`../agent-runtime.md`](../agent-runtime.md) — Stage X.0 design lock; PROVISIONAL marker on `--acp`.
- [`./10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md) — substage breakdown; X.5 / X.6 entries.
- [`../protocol.md`](../protocol.md) — bridge ↔ web envelope; the side that does **not** change in X.5/X.6.
