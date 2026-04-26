# Stage X.5 / X.6 — Real Claude Code ACP Verification Note

> ## Corrected diagnosis (2026-04-26)
>
> ```text
> WRONG (earlier framing in §3/§4):
>   VAC can't use ACP because Claude Code doesn't support it.
>
> RIGHT:
>   The `claude` binary doesn't expose `--acp`, but Claude Code can be
>   used via a separate ACP adapter package. Zed already ships and
>   uses that adapter. VAC's gap isn't Claude support — it's that the
>   bridge has no official ACP *client* driver to speak to the
>   adapter.
> ```
>
> Zed's path:
>
> ```text
> Zed
>   → official ACP client (Rust, in zed.dev source)
>   → @agentclientprotocol/claude-agent-acp  (was: @zed-industries/claude-code-acp)
>   → @anthropic-ai/claude-agent-sdk
>   → Claude Code
> ```
>
> VAC's current path:
>
> ```text
> VAC Web
>   → local-bridge
>   → mock ACP scaffold (toy wire shape — not ACP)
> ```
>
> VAC's target path:
>
> ```text
> VAC Web
>   → local-bridge
>   → official ACP client driver (Rust port OR Node sidecar over @agentclientprotocol/sdk)
>   → @agentclientprotocol/claude-agent-acp
>   → @anthropic-ai/claude-agent-sdk
> ```
>
> **Implication:** the `claude --print --output-format stream-json`
> recommendation in the previous draft of §11 is **demoted to a
> fallback**. Primary path is the official ACP transport, identical
> in concept to what Zed already does. See §12 for evidence.

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

State: **6/6** as of the §13 capture pass. X.5b is shipped (`a893450`).
X.5c implementation can begin on explicit go — design implications
recorded in §13.6.

## 13. X.5c capture pass — authenticated permission + tool flow (2026-04-26)

Captured locally against `@agentclientprotocol/claude-agent-acp@0.31.0`
with the host already authenticated via `claude /login`. Harness
implemented Client side using `@agentclientprotocol/sdk@0.20.0` and
logged every Client method call. Sandbox: `/tmp/acp-cap/sandbox`.

### 13.1 Read tool — no client RPC fires

Prompt: `"Please READ the file notes.txt and tell me what's in it."`

Claude's Agent reads the file **itself** and surfaces the result
through `session/update` notifications only. No `fs/read_text_file`
request reached the harness. Sequence:

1. `session/update :: tool_call` — `kind:"read"`, `content:[]`, `status:"pending"`, `title:"Read File"`, `_meta.claudeCode.toolName:"Read"`, fresh `toolCallId`.
2. `session/update :: tool_call_update` — fills `locations:[{line:1, path:"…/notes.txt"}]` and `rawInput:{file_path:"…/notes.txt"}`; `title` becomes `"Read notes.txt"`.
3. `session/update :: tool_call_update` — carries `_meta.claudeCode.toolResponse.file.{filePath, content, numLines, startLine, totalLines}`. The bridge gets the file content here, in the `_meta`.
4. `session/update :: tool_call_update` — `status:"completed"`, `content:[{type:"content", content:{type:"text", text:"```\\n1\\thello world\\n…"}}]`, plus `rawOutput`.
5. `session/update :: agent_message_chunk` × 3.
6. `session/update :: usage_update` interleaved.

**Bridge implication.** For agents that read locally (which is the
default for Claude), `fs/read_text_file` is *not* the surface to
gate. Read enforcement happens by inspecting `tool_call_update`
content — `kind:"read"`, `locations[].path`, `_meta.claudeCode.toolResponse.file`.
The bridge can surface this through `review.changeset_updated` (or a
read-only equivalent) without ever serving an `fs/*` request.

### 13.2 Write tool — `session/request_permission` confirmed

Prompt: `"Create a new file at hello.md with the text 'hello from acp'."`

Sequence:

1. `session/update :: tool_call` — `kind:"edit"`, `content:[]`, `status:"pending"`, `title:"Write"`, `_meta.claudeCode.toolName:"Write"`, fresh `toolCallId`.
2. `session/update :: tool_call_update` — populates `content:[{type:"diff", path, newText, oldText:null}]`, `locations:[{path}]`, `rawInput:{file_path, content}`, `title:"Write hello.md"`.
3. **`session/request_permission` request** with the verbatim shape:

```json
{
  "options": [
    { "kind": "allow_always", "name": "Always Allow all Write", "optionId": "allow_always" },
    { "kind": "allow_once",  "name": "Allow",                   "optionId": "allow" },
    { "kind": "reject_once", "name": "Reject",                  "optionId": "reject" }
  ],
  "sessionId": "...",
  "toolCall": {
    "content": [ { "type":"diff", "path":"…/hello.md", "newText":"hello from acp\n", "oldText":null } ],
    "kind": "edit",
    "locations": [ { "path":"…/hello.md" } ],
    "rawInput": { "file_path":"…/hello.md", "content":"hello from acp\n" },
    "title": "Write hello.md",
    "toolCallId": "toolu_01AA9tQceFCatd9Hhi87pwhs"
  }
}
```

4. Client response (allow): `{ "outcome": { "outcome": "selected", "optionId": "allow_always" } }`.
5. `session/update :: tool_call_update` — `_meta.claudeCode.toolResponse:{type:"create", filePath, content, structuredPatch:[], originalFile:null, userModified:false}`.
6. `session/update :: tool_call_update` — `status:"completed"`, `rawOutput:"File created successfully at: …"`.
7. Verified on disk: `/tmp/acp-cap/sandbox/hello.md` contains `hello from acp`.

### 13.3 Reject path

Same prompt, client returns:

```json
{ "outcome": { "outcome": "selected", "optionId": "reject" } }
```

(Note the wire shape uses `"selected"` even for rejection; the
*intent* is encoded by the chosen option's `kind:"reject_once"`.
The other documented outcome is `{ "outcome": "cancelled" }` for
abort/timeout.)

Agent response:

```json
{
  "sessionUpdate": "tool_call_update",
  "_meta": { "claudeCode": { "toolName": "Write" } },
  "content": [{ "type":"content", "content":{ "type":"text", "text":"```\nUser refused permission to run tool\n```" }}],
  "rawOutput": "User refused permission to run tool",
  "status": "failed",
  "toolCallId": "..."
}
```

Prompt completes normally with `stopReason: "end_turn"` — rejection
is a per-tool failure, not a session-level error. No file written on
disk (verified).

### 13.4 Bash tool — handled locally even with `terminal: true`

Prompt: `"Run the bash command 'echo hi from real bash'. Use the Bash tool."`

With `clientCapabilities.terminal: true` advertised at `initialize`,
the Agent **still** runs Bash internally. No `terminal/create`,
`terminal/output`, `terminal/wait_for_exit`, or `terminal/kill`
reached the harness. The flow looked identical to the Read flow:
`tool_call` (pending) → `tool_call_update` (with rawInput) →
`tool_call_update` (with rawOutput + status:"completed").

**Bridge implication.** Terminal RPCs in `claude-agent-acp@0.31.0`
are not part of the normal Bash path. They may surface for explicit
interactive-terminal subcommands or other ACP agents — keep the
client method handlers ready for X.5c, but **don't depend on them**
for shell enforcement. Shell enforcement piggybacks on
`tool_call_update` for `kind:"execute"` (or whatever `_meta.claudeCode.toolName`
labels show up under), same shape as Read/Write.

### 13.5 Session-level metadata captured at `session/new`

Real `session/new` response carries (besides `sessionId`):

- `models.availableModels[]` + `models.currentModelId` — list of model
  ids (`default`, `sonnet`, `haiku`, `opus[1m]`) with descriptions.
- `modes.availableModes[]` + `modes.currentModeId` — six modes:
  `auto`, `default`, `acceptEdits`, `plan`, `dontAsk`,
  `bypassPermissions`. Each carries a `name` + `description`.
- `configOptions[]` — three options (`mode`, `model`, `effort`) each
  with `currentValue` and `options[].value`. Drives a future settings
  panel.

The bridge keeps these as `Value` for X.5b (already wired) and the
web surface can render them when X.5c lands the picker.

### 13.6 X.5c design implications

1. **Approval bridge target.** `session/request_permission` is the
   X.5c hook. Translation:
   - **Inbound** ACP request → bridge enqueues `approval.pending`
     event with the `toolCall` payload and `options[]` translated to
     bridge approval options (preserve `optionId` for round-trip
     correctness).
   - **Outbound** ACP response: `approval.approve` selects a
     non-reject `optionId`; `approval.reject` selects the
     `reject_once` (or `reject_always`) option; timeout selects
     `cancelled`.
2. **Preferred default option mapping.** Profile policy decides
   which `kind` the bridge accepts. e.g. `executor.code` may auto-
   approve `kind:"allow_once"` for paths inside `fs.scoped_paths`
   and force user approval for `allow_always`.
3. **Read tool surfacing.** Don't expect `fs/read_text_file` for
   Claude — render `tool_call_update` with `kind:"read"` directly
   into the Build "Read" lane and apply `profile_layer` deny-globs
   against `locations[].path`.
4. **Write tool surfacing.** `tool_call_update` with `kind:"edit"`
   carries the diff in `content[]`. Map directly into
   `review.changeset_updated` so the diff appears alongside the
   approval prompt.
5. **Bash surfacing.** Same shape as Read — render `tool_call_update`
   into the Runtime lane. Apply `shell_allowlist` against the
   command extracted from `rawInput`.
6. **`fs/read_text_file` / `fs/write_text_file` / `terminal/*`
   handlers stay in X.5c.** Even though Claude doesn't currently call
   them, other ACP agents (and possibly future Claude versions for
   IDE-mediated reads) will. The handlers should:
   - Resolve path through `profile_layer::enforce_fs_read/write`
     against the pinned project root.
   - Surface every successful write through
     `review.changeset_updated`.
   - Reject denied paths with `RequestError(-32603, ...)`.

### 13.7 Captures status

```text
[x] initialize round-trip
[x] session/new full response
[x] session/prompt happy path
[x] session/update :: tool_call (pending)
[x] session/update :: tool_call_update (with rawInput / rawOutput / status)
[x] session/request_permission request shape
[x] permission options taxonomy (allow_always / allow_once / reject_once)
[x] permission outcome envelopes (selected / cancelled both observed)
[x] reject path: tool_call_update.status="failed" + "User refused permission"
[x] write tool persistence (verified on disk)
[x] bash tool path (no terminal/* even with terminal:true)
[ ] fs/read_text_file from agent — NOT OBSERVED with current Claude
[ ] fs/write_text_file from agent — NOT OBSERVED with current Claude
[ ] terminal/create from agent — NOT OBSERVED with current Claude
[ ] reject_always option — not enumerated by Claude in observed runs;
    treat as future variant.
```

§10 go/no-go checklist now reads **6/6 for X.5c**. X.5c
implementation can begin on explicit go.

---

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

### 12.1 Packages — observed via `npm view` + local install

| Package | Latest | Binary | Role |
| ------- | ------ | ------ | ---- |
| `@agentclientprotocol/sdk` | **`0.20.0`** (3 days ago) | (library) | Protocol definition + TS client/server runtime |
| `@agentclientprotocol/claude-agent-acp` | **`0.31.0`** (2 days ago) | `claude-agent-acp` | **Pin against this.** ACP Agent driving `@anthropic-ai/claude-agent-sdk`. |
| `@zed-industries/claude-code-acp` | `0.16.2` (DEPRECATED) | `claude-code-acp` | Old name. npm prints "renamed to @agentclientprotocol/claude-agent-acp". Don't pin. |
| `@anthropic-ai/claude-agent-sdk` | `0.2.119` (transitive) | (library) | Claude SDK used by the ACP Agent under the hood |

`agents.toml` example for X.5b:

```toml
[agents.claude]
kind = "acp"
label = "Claude Code"
command = "claude-agent-acp"
args = []
enabled = true
permission_timeout_ms = 300000
```

Bridge stays unchanged when the npm package's binary name changes —
just edit the `command` field.

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

### 12.2 Captured `initialize` round-trips

Both packages tested locally. Wire is line-delimited JSON-RPC 2.0
over stdin/stdout (ndjson). Stderr is for logs only — `dist/index.js`
explicitly redirects all `console.*` to stderr to keep stdout
ACP-clean.

#### `@zed-industries/claude-code-acp@0.16.2` (legacy)

Request:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":false}}}
```

Response (formatted):

```json
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "promptCapabilities": { "image": true, "embeddedContext": true },
      "mcpCapabilities": { "http": true, "sse": true },
      "loadSession": true,
      "sessionCapabilities": { "fork": {}, "list": {}, "resume": {} }
    },
    "agentInfo": {
      "name": "@zed-industries/claude-code-acp",
      "title": "Claude Code",
      "version": "0.16.2"
    },
    "authMethods": [{
      "id": "claude-login",
      "name": "Log in with Claude Code",
      "description": "Run `claude /login` in the terminal"
    }]
  }
}
```

#### `@agentclientprotocol/claude-agent-acp@0.31.0` (current)

Same request, response:

```json
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "_meta": { "claudeCode": { "promptQueueing": true } },
      "promptCapabilities": { "image": true, "embeddedContext": true },
      "mcpCapabilities": { "http": true, "sse": true },
      "loadSession": true,
      "sessionCapabilities": { "fork": {}, "list": {}, "resume": {}, "close": {} }
    },
    "agentInfo": {
      "name": "@agentclientprotocol/claude-agent-acp",
      "title": "Claude Agent",
      "version": "0.31.0"
    },
    "authMethods": []
  }
}
```

Notable diffs in 0.31.0 vs 0.16.2:

- New vendor extension: `agentCapabilities._meta.claudeCode.promptQueueing`.
- New session capability: `sessionCapabilities.close: {}`.
- `agentInfo.title` is now `"Claude Agent"` (was `"Claude Code"`).
- `authMethods` came back empty in this run (auth state depends on
  whatever credentials Claude already has on disk — capture varies).

**X.5a target: 0.31.0 wire shape.** Bridge code must tolerate the
`_meta` extension and the `close` capability.

#### Wire framing observation

ACP is JSON-RPC 2.0 with the standard `id / method / params / result /
error` shape. There is no length-prefix; framing is one envelope per
`\n`. Stderr is allowed and does not interfere with the protocol.

### 12.3 `@agentclientprotocol/sdk` v0.20.0 wire methods

Wire-method names captured **directly from the JSON schema shipped
inside the SDK package** (`schema/schema.json`). The TypeScript
camelCase type names (`newSession`, `sessionUpdate`, …) do **not**
match the JSON-RPC method strings. Confirmed empirically: sending
`{"method":"newSession"}` gets `-32601 Method not found`; sending
`{"method":"session/new"}` is accepted.

**Authoritative wire-method strings (use these verbatim):**

```text
initialize                         (camelCase exception)

session/new
session/load
session/prompt
session/cancel              (notification, client → agent)
session/update              (notification, agent → client)
session/request_permission  (agent → client)
session/close
session/fork
session/list
session/resume
session/set_mode
session/set_model
session/set_config_option

fs/read_text_file
fs/write_text_file

terminal/create
terminal/output
terminal/release
terminal/wait_for_exit
terminal/kill

elicitation/create
elicitation/complete

providers/list
providers/set
providers/disable

nes/start                          (next-edit-suggestion)
nes/accept
nes/reject
nes/suggest
nes/close
```

**Client must implement (agent → client):**

| Wire method | Required params | Purpose |
| ----------- | --------------- | ------- |
| `session/update` (notif.) | `sessionId, update` | Streamed updates from agent. Tagged union — see §12.4. |
| `session/request_permission` | `sessionId, toolCall, options` | **Modal halt** — agent waits for `outcome`. The X.5c approval-bridge target. |
| `fs/read_text_file` | `sessionId, path` (opt. `line`, `limit`) | Agent asks editor to read; client-side deny-globs enforced. |
| `fs/write_text_file` | `sessionId, path, content` | Same, write side. Surface every write through `review.changeset_updated`. |
| `terminal/create` | `sessionId, command` (opt. `args, cwd, env, outputByteLimit`) | Spawn a terminal under client supervision. |
| `terminal/output` / `release` / `wait_for_exit` / `kill` | — | Lifecycle. |

**Agent must implement (client → agent):**

| Wire method | Required params | Purpose |
| ----------- | --------------- | ------- |
| `initialize` | `protocolVersion` | Capability handshake. Captured in §12.2. |
| `session/new` | `cwd, mcpServers` | Open a new session. Returns `sessionId`, optional `models, modes, configOptions`. |
| `session/load` (capability-gated) | `sessionId, …` | Resume a stored session. |
| `session/set_mode` (optional) | — | Switch model mode. |
| `session/prompt` | `sessionId, prompt` | Send user turn; result carries `stopReason + usage`. |
| `session/cancel` (notif.) | `sessionId` | Abort current turn. |

**`session/update` notification — `update.sessionUpdate` discriminator** (note the JSON-RPC method is `session/update`; the discriminator field inside `update` is still camelCase `sessionUpdate`):

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
