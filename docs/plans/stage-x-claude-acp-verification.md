# Stage X.5 / X.6 — Real Claude Code ACP Verification Note

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

- [x] §2–§4 produce a stable ACP invocation
      → **negative result**: no `--acp` in 2.1.111. §11 fallback selected.
- [ ] §5 captures one round-trip without errors
      → **next task**: capture `claude --print --output-format stream-json` round-trip.
- [ ] §6 inventory has every envelope we plan to map
- [ ] §7 permission envelope is documented (request + grant + deny)
- [ ] §8 covers at least two failure modes
- [ ] §9 decisions are filled in

If every box is checked → X.5 implementation can begin.
If any are open → keep this note, do not write code yet.

**Current state: 1/6. Do not start X.5.**

## 11. Fallback path — selected after §3/§4 captures

§3/§4 confirm Claude Code 2.1.111 has no `--acp`. Three viable paths:

1. **`--print` + `stream-json` adapter (recommended).**
   Drive Claude with:
   ```bash
   claude --print \
     --input-format stream-json \
     --output-format stream-json \
     --include-partial-messages \
     --include-hook-events \
     --permission-mode dontAsk \
     [--add-dir <project_root>]
   ```
   Wrap this behind a tiny adapter subprocess that translates between
   our internal ACP-shaped envelope (the one mock-acp speaks today)
   and Claude's stream-json events. The `dontAsk` permission-mode + a
   bridge-side approval queue gives us the §7 path.
   - Pros: native Claude binary, no version pin.
   - Cons: stream-json schema is Anthropic-private; capture in §6/§7
     before coding. `dontAsk` semantics need inspection — does it deny
     silently, or does it surface a hook/event we can trap?

2. **MCP server route.** Run Claude with `--mcp-config` pointing at a
   local MCP server hosted by `local-bridge`. The bridge's MCP server
   becomes the permission/tool boundary; Claude calls our tools, we
   approve/deny.
   - Pros: MCP is a documented protocol; approval semantics are explicit.
   - Cons: inverts the topology — Claude is the parent, bridge is a
     server. Doesn't match the X.0 "bridge spawns ACP child" model.

3. **Wrapper subprocess.** Same shape as path 1 but the adapter is a
   distinct binary (`vac-claude-adapter`) we ship, configured via
   `agents.toml` like any other agent. Cleanest separation; highest
   maintenance cost.

**Decision (provisional, requires sign-off before X.5 starts):** path 1
inline inside the bridge's existing AcpDriver, with `dontAsk` +
`--permission-mode` reserved for the X.5 permission bridge. Switch to
path 3 only if path 1 introduces a circular dependency on Anthropic
schema changes.

Whichever fallback is chosen, **rewrite §4–§7 against the chosen
transport** before considering X.5 implementable. §5–§7 captures
against `--print --output-format stream-json` are the next concrete
task.

---

## Cross-links

- [`../agent-runtime.md`](../agent-runtime.md) — Stage X.0 design lock; PROVISIONAL marker on `--acp`.
- [`./10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md) — substage breakdown; X.5 / X.6 entries.
- [`../protocol.md`](../protocol.md) — bridge ↔ web envelope; the side that does **not** change in X.5/X.6.
