# Stage X.5c.2 — Tool Activity Observation Mapping

**Status.** Design doc. **No implementation in this commit.** Awaits
re-audit before code lands.

**Goal.** Map the agent-emitted ACP `session/update` notifications
(`tool_call`, `tool_call_update`, `plan`, `usage_update`,
`available_commands_update`, `current_mode_update`,
`session_info_update`, `config_option_update`,
`agent_thought_chunk`) onto existing VAC events so Build's Review,
Runtime, Activity, Plan, and Agents lanes can render them.

**Non-goal — bright line.** X.5c.2 is **observe-only**. It does not:

- enable `clientCapabilities.fs.readTextFile` on initialize,
- enable `clientCapabilities.fs.writeTextFile` on initialize,
- enable `clientCapabilities.terminal` on initialize,
- block, cancel, or rewrite shell/read execution,
- mutate Claude's `permission-mode` / `mode`,
- claim preventive enforcement of any kind.

Preventive control on read/shell is **X.5c.3** (HOLD until a
sandbox / mode-hardening spike runs). X.5c.2 surfaces what the agent
has *already* decided to do.

---

## 1. Inputs (already wired in X.5b)

The bridge already subscribes to the agent's `session/update`
broadcast in `SessionHandle::spawn_acp` and currently maps two
variants:

```text
agent_message_chunk    → transcript.delta {delta}
agent_thought_chunk    → transcript.delta {delta, kind:"thought"}
```

Everything else is logged at debug. X.5c.2 widens this list.

The captured wire shapes (verified locally against
`@agentclientprotocol/claude-agent-acp@0.31.0` — see
[`stage-x-claude-acp-verification.md` §13](./stage-x-claude-acp-verification.md))
are stable enough to map without further upstream work.

## 2. Variant → VAC event mapping

| ACP `update.sessionUpdate` | VAC event | Lane | Notes |
| -------------------------- | --------- | ---- | ----- |
| `tool_call` | `tool.observed` | Activity | Initial signal that a tool will run. `status:"pending"`. |
| `tool_call_update` (kind:`read`) | `tool.updated` | Context / Activity | `_meta.claudeCode.toolResponse.file.{filePath, content, numLines, totalLines}` carries result; bridge surfaces path + content hash, not raw bytes. |
| `tool_call_update` (kind:`edit`) | `tool.updated` + `review.changeset_updated` | Review | `content[]` carries the diff (`type:"diff", path, newText, oldText`). Map directly into the review surface; `approved_by_approval_id` set when correlatable. |
| `tool_call_update` (kind:`execute` / Bash) | `tool.updated` + `runtime.job_log` | Runtime / Activity | `rawInput.command` → log line; `rawOutput` → bounded log content. |
| `tool_call_update` (`status:"failed"`) | `tool.failed` | Activity (severity Warn) | Includes the `User refused permission to run tool` rejection path. **Task-level failure, never session-level.** |
| `plan` | `plan.updated` | Plan | Pass-through structure; bridge wraps with session metadata. |
| `available_commands_update` | _ignored_ at X.5c.2 | — | Future Composer slash-palette feed. Out of scope. |
| `current_mode_update` | _ignored_ at X.5c.2 | — | Surfaces in Agents lane later. |
| `usage_update` | `agents.lane_state` (token usage) | Agents | Only when telemetry is present; never fabricate values (Build red-team B12). |
| `session_info_update` | audit-only | — | Goes to `AuditFacility`, not the WS. |
| `config_option_update` | _ignored_ at X.5c.2 | — | Settings panel feed; later. |

## 3. Internal DTO

Don't lob raw ACP payload at web stores. Normalize first:

```rust
pub struct ObservedToolActivity {
    pub session_id: String,        // VAC session id
    pub agent_id: String,
    pub agent_kind: AgentKind,     // always Acp at X.5c.2
    pub tool_call_id: String,      // ACP toolCallId — primary correlation key
    pub kind: ToolKind,            // Read | Edit | Execute | Other(String)
    pub title: Option<String>,
    pub status: ToolStatus,        // Pending | InProgress | Completed | Failed
    pub locations: Vec<ToolLocation>, // [{ path, line? }]
    pub args_hash: String,         // sha256 over canonical(rawInput)
    pub raw_input_redacted: serde_json::Value, // see §4
    pub raw_output_redacted: Option<serde_json::Value>, // see §4
    pub approved_by_approval_id: Option<String>, // populated when args_hash
                                                 // matches a recently-resolved
                                                 // X.5c.1 approval
    pub ts: chrono::DateTime<chrono::Utc>,
}

pub enum ToolKind { Read, Edit, Execute, Other(String) }
pub enum ToolStatus { Pending, InProgress, Completed, Failed }

pub struct ToolLocation { pub path: String, pub line: Option<u64> }
```

Web events carry the DTO serialized; web stores never see the
agent's raw `_meta` payload.

## 4. Redaction rules

- **Raw file content**: never put a full file in the audit row. Hash
  is fine; first-N-bytes preview goes only to the Review lane (which
  the user is already looking at).
- **Path**: kept verbatim.
- **Diff**: passes through to Review only. Audit row records
  `args_hash`, not the diff bytes.
- **Terminal output**: must be bounded (default 64 KiB per
  `tool_call_update`; truncate with a marker). Bridge already has the
  `output_cap_bytes` policy on `shell_allowlist` — reuse it.
- **Env / secrets**: never echo. If `rawInput` contains `env` or
  obvious secret keys (`API_KEY`, `TOKEN`, `SECRET`, `_KEY`), redact
  to `"<REDACTED>"` before storing.
- **Connector tokens**: same.

## 5. Correlation keys

When the bridge holds a recently-resolved X.5c.1 approval, it should
attach `approved_by_approval_id` to the matching `ObservedToolActivity`
so the UI can render the "approved by you" provenance:

- key on `(session_id, args_hash)` from the X.5c.1 audit row,
- TTL: 60 seconds after `approval.resolved`,
- if no match, leave `approved_by_approval_id = None`.

## 6. Audit events

```text
tool.observed   — first sighting; severity Info
tool.updated    — progress / result; severity Info
tool.failed     — terminal status:"failed"; severity Warn (NOT Error)
```

Required fields on every row:

```text
toolCallId, kind, status, locations, args_hash, agent_id, agent_kind, session_id, ts
```

`severity Error` is reserved for bridge crashes / transport
failures. A user reject is `tool.failed @ Warn`, not `Error`.

## 7. Mock-acp extensions needed

Add deterministic emitters so the X.5c.2 tests don't need a real
Claude. Suggested flags:

```text
--emit-read-tool          send tool_call + tool_call_update sequence
                          for a Read against a sandbox path
--emit-edit-tool          send the diff sequence for an Edit
--emit-execute-tool       send a Bash sequence with rawInput.command
                          and a small rawOutput
--emit-failed-tool        send a tool_call_update.status="failed"
                          with rawOutput "User refused permission to
                          run tool" (mirror reject path)
--oversized-output        emit a single tool_call_update with
                          rawOutput larger than the cap to exercise
                          truncation
```

Existing `--permission-prompt` flag stays for X.5c.1 cross-coverage.

## 8. Test plan

All tests must drive the WS path end-to-end (no `send_to_engine`
bypass), matching the X.5b/X.5c.1 discipline.

```text
x5c2_read_tool_update_emits_activity_event
  triggers --emit-read-tool, asserts a tool.updated event with
  kind="read", locations[].path set, args_hash present,
  raw_output_redacted does not include the full file content.

x5c2_edit_tool_update_emits_review_candidate
  triggers --emit-edit-tool, asserts review.changeset_updated
  arrives with the diff path + (newText, oldText), AND a
  tool.updated event with kind="edit". When the X.5c.1 approval
  was just resolved with the matching args_hash, asserts
  approved_by_approval_id is populated.

x5c2_execute_tool_update_emits_runtime_activity
  triggers --emit-execute-tool, asserts runtime.job_log lines
  carry the command + bounded output, AND tool.updated event
  with kind="execute".

x5c2_rejected_tool_update_is_task_failure_not_session_error
  triggers --emit-failed-tool, asserts tool.failed with
  status:"failed", session continues, no transcript.error
  emitted, no notify event with severity Error.

x5c2_raw_payload_is_redacted_or_bounded
  triggers --oversized-output, asserts the audit row + WS event
  carry truncated output with a marker, NOT the full payload.
  Also asserts that an env-style key in rawInput is redacted.
```

## 9. Capability invariants — enforce in PR review

PR description must include the following grep checklist showing
**zero matches** outside the X.5c.3 spike branch:

```bash
rg "read_text_file: true|write_text_file: true|terminal: true" apps/local-bridge
rg "fs/read_text_file|fs/write_text_file" apps/local-bridge
rg "terminal/create|terminal/output|terminal/wait_for_exit" apps/local-bridge
```

X.5c.2 keeps `clientCapabilities` exactly as X.5b set them:

```json
{
  "fs": { "readTextFile": false, "writeTextFile": false },
  "terminal": false
}
```

If a future PR flips any of these, it's X.5c.3 by definition and
needs its own design doc.

## 10. Out of scope (X.5c.3 territory)

- serving `fs/read_text_file` / `fs/write_text_file` requests through
  `profile_layer` enforcement,
- serving `terminal/*` requests,
- mode hardening (driving Claude with `dontAsk` / `acceptEdits`),
- sandbox / shadow-checkout fan-out,
- forcing tool mediation via a future ACP capability flag,
- relaxing `allowed_agent_kinds` for assessor.* / executor.release.

---

## 11. Implementation order (post-audit)

1. Define `ObservedToolActivity` + `ToolKind` + `ToolStatus` in
   `local-bridge::agent_runtime::acp::types` (or a sibling
   `tool_activity` module).
2. Extend `mock-acp` with the five new emit flags.
3. Add the new event types to `protocol-rs` event catalog (still
   additive on the WS).
4. Extend `map_acp_update` in `SessionHandle` to:
   - branch on `update.sessionUpdate`,
   - normalize → `ObservedToolActivity`,
   - emit the per-kind VAC events,
   - audit through `AuditFacility`.
5. Wire correlation cache for `approved_by_approval_id`.
6. Add the five integration tests in §8.
7. Re-audit.

## 12. Cross-links

- [`stage-x-claude-acp-verification.md`](./stage-x-claude-acp-verification.md) — captured wire shapes (§13) and X.5c.1 lock (§14).
- [`stage-x5a-acp-client-design.md`](./stage-x5a-acp-client-design.md) — Rust-native client decision; X.5c.2 lives in the same `agent_runtime::acp` boundary.
- [`10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md) — substage map (X.5c overall).
