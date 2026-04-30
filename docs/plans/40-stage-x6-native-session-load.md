# Stage X6 — Native ACP `session/load` resume + P2 follow-ups

> Successor to commits `b611465..fc938a5` (replay-only persistence foundation).
>
> Goal: ship native ACP `session/load` resume so a persisted `vac_session_id`
> can rehydrate a live agent runtime, while closing three audit P2 gaps that
> were called out before Phase 4.

## 0. Status & invariants

- Replay-only resume already lands in HEAD `fc938a5` (main +7 over origin/main).
- All gates green (fmt, clippy `-D warnings`, `cargo test -p local-bridge`,
  `pnpm typecheck`, `pnpm -r test`, web build, `pnpm schema:validate`).
- DO NOT regress these gates between batches. Each commit must pass them.
- Branch policy: `main` only, conventional commits, no auto-push.
- Persistence root default: `~/.local/share/vac-web/bridge/sessions/`,
  override via `VAC_SESSIONS_DIR`.
- Session ID validation: ASCII alnum + `_` + `-`, len < 128 (already enforced).

## 1. Batch ordering

Land the three P2 patches **before** Phase 4 to make native resume safe and
honest. Each batch is a single commit with its own DoD gate.

| # | Batch | Type | Risk | Depends on |
|---|---|---|---|---|
| P2-A | Redaction label accuracy | bridge | low | — |
| P2-B | Persistence health signal | bridge + web | low | — |
| P2-C | Reject non-`replay_only` mode (placeholder error) | bridge | low | — |
| 4-1 | ACP types: `LoadSessionRequest/Response` + `AcpClient::load_session` | acp-client | medium | — |
| 4-2 | `mock-acp` `--load-session` | tooling | low | 4-1 |
| 4-3 | Backend resume mode dispatch (`replay_only` / `acp_load` / `native_or_replay`) | bridge | medium | 4-1, P2-C |
| 4-4 | Native spawn + load flow on `acp_load` | bridge | high | 4-1, 4-3 |
| 4-5 | Frontend native resume UX + progress states | web | medium | 4-3, 4-4 |
| 4-6 | Integration tests (success / unsupported / fallback / errors / ordering) | tests | medium | 4-2, 4-4, 4-5 |
| 4-7 | Docs + plan-shipped move | docs | low | all of 4 |

---

## 2. Batch P2-A — Redaction label accuracy

**Why.** Today `PersistenceSink` stamps every persisted event with
`RedactionLabel::Safe` even after a payload was scrubbed. Replay UI cannot tell
the user that content was redacted.

**Files.**
- `apps/local-bridge/src/session/persistence/redact.rs`
- `apps/local-bridge/src/session/persistence/sink.rs`
- `apps/local-bridge/src/session/persistence/model.rs` (only if label enum needs a new arm; default no)
- `apps/local-bridge/tests/persistence_redaction.rs` (new) or extend existing redact unit tests.

**Changes.**
1. Refactor:
   ```rust
   // before
   pub fn redact_event_payload(payload: &mut Value, mode: RedactionMode);
   // after
   pub fn redact_event_payload(payload: &mut Value, mode: RedactionMode) -> RedactionLabel;
   ```
   Returned label semantics:
   - `Safe` — no redacted fields touched.
   - `Bounded` — at least one key matched the redaction list and was replaced with `"<redacted>"` or `"<redacted:N bytes>"`.
   - `Dropped` — payload became unrepresentable and was replaced with `null` or stripped from persistence.
2. `PersistenceSink` records the returned label in the persisted event:
   ```rust
   let redaction = redact_event_payload(&mut payload, self.mode);
   PersistedServerEvent { seq, event_type, payload, ts, redaction }
   ```
3. Add unit tests:
   - `Safe` for plain delta payloads.
   - `Bounded` for payloads containing `authorization`, `cookie`, etc.
   - `Dropped` (only if your redactor can reach this state in `Strict` mode).

**Wire compatibility.** None — only an enum value change inside JSONL. JSONL
is local-only; downgrade is N/A. Any existing rows still parse because
`RedactionLabel` already includes all three arms.

**DoD.**
- Unit tests cover Safe / Bounded / Dropped.
- `cargo test -p local-bridge` green.
- No clippy warnings.
- Replayed events that were originally redacted carry `redaction != Safe` on the
  wire (manually verified by appending one and reading back).

**Commit message.**
`feat(bridge): accurate redaction label on persisted ServerEvents`

---

## 3. Batch P2-B — Persistence health signal

**Why.** Persistence write failures are silent (only `tracing::warn`). The user
cannot tell why a session is missing on restart.

**Wire additions.**
- New ServerEvent: `session.persistence_degraded`
  ```json
  {
    "type": "session.persistence_degraded",
    "session_id": "<vac_session_id>",
    "reason": "append_failed" | "meta_save_failed" | "forget_failed",
    "detail": "<short string, no PII>"
  }
  ```
- Extend `session.history.listed`:
  ```json
  {
    "type": "session.history.listed",
    "persistence": "file" | "disabled",
    "health": "healthy" | "degraded",
    "sessions": [...]
  }
  ```
  `health` is `degraded` when any persistence operation has logged a failure
  since process start, OR when current `list()` fails to read entries.

**Files.**
- `apps/local-bridge/src/session/persistence/mod.rs` — add `PersistenceHealth` (atomic bool counter).
- `apps/local-bridge/src/session/persistence/sink.rs` — flip flag on append error and emit `session.persistence_degraded` via the same broadcast bus.
- `apps/local-bridge/src/translator/mod.rs` — read flag in `session.history.list` arm; include `health`.
- `apps/local-bridge/src/session/registry.rs` — wire degradation event source into the session's outbound channel (or attach a workspace-scoped fanout).
- `apps/web/src/stores/sessionHistory.ts` — add `health: 'healthy' | 'degraded'` to the store.
- `apps/web/src/domain/sessions/history.ts` — handle new event + extended `listed` payload.
- `apps/web/src/components/Sessions/PersistentSessions.tsx` — surface a small warning chip when health is degraded.

**Tests.**
- Bridge unit: simulate `append_event` Err and assert flag flips + listed health is `degraded`.
- Web vitest: store reducer transitions on the new event.

**DoD.**
- New tests pass.
- typecheck/test/build green.
- No regressions in existing `session.history.listed` consumers.

**Commit message.**
`feat(bridge,web): persistence health signal + degraded warning`

---

## 4. Batch P2-C — Reject non-`replay_only` modes (placeholder)

**Why.** Frontend already types `'replay_only' | 'acp_load' | 'native_or_replay'`,
but backend silently treats anything with `vac_session_id` as `replay_only`. A
future client could mistakenly believe native resume happened.

**Behavior.**
- `mode` absent → backward-compat: in-memory ring path (existing).
- `mode == "replay_only"` → current persistence path.
- `mode == "acp_load"` or `mode == "native_or_replay"` → reject for now with
  ```json
  {
    "type": "session.resume.failed",
    "vac_session_id": "...",
    "reason": "resume_mode_not_supported",
    "requested_mode": "acp_load"
  }
  ```
  and a `ServerAck.ok=false`. No event replay.

**Files.**
- `apps/local-bridge/src/translator/mod.rs` — `session.resume` arm.
- `apps/local-bridge/tests/session_resume_modes.rs` (new) — unit-style test.
- `apps/web/src/domain/sessions/history.ts` — handle `resume.failed` reason.

**DoD.**
- Test asserts `acp_load` and `native_or_replay` are rejected with that reason.
- `replay_only` keeps working unchanged.
- Frontend chip shows red on rejection.

**Note.** This batch will be partially undone in 4-3, but it gives a clean
rejection during the gap, and the test will be updated then.

**Commit message.**
`feat(bridge): reject non-replay_only resume modes until native load lands`

---

## 5. Batch 4-1 — ACP types + client method

**Why.** Phase 4 needs typed `session/load` over JSON-RPC.

**Files.**
- `crates/acp-client/src/protocol.rs` (or wherever existing requests like `session/new` live).
- `crates/acp-client/src/client.rs`.
- `crates/acp-client/tests/load_session_codec.rs` (new).

**Types.**
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSessionRequest {
    pub session_id: String, // agent_session_id
    pub project_root: PathBuf,
    pub mcp_servers: Vec<McpServerConfig>,
    // forward client capabilities exactly like sessionNew does
    pub client_capabilities: ClientCapabilities,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSessionResponse {
    pub session_id: String,
    pub modes: Option<SessionModes>,
}
```

**Client method.**
```rust
impl AcpClient {
    pub async fn load_session(
        &self,
        req: LoadSessionRequest,
    ) -> Result<LoadSessionResponse, AcpError> { ... }
}
```
- Reuses the same JSON-RPC request channel as `session/new`.
- Maps RPC error codes:
  - `-32601` (method not found) → `AcpError::LoadSessionUnsupported`.
  - `-32602` (invalid params) → `AcpError::LoadSessionRejected { code: -32602, message }`.
  - other → `AcpError::Rpc { code, message }`.

**Tests.**
- Codec round-trip for request + response.
- Error mapping for `-32601`.

**DoD.**
- `cargo test -p acp-client` green.
- Public types re-exported from the crate root if other crates reference them.

**Commit message.**
`feat(acp-client): typed session/load request + AcpClient::load_session`

---

## 6. Batch 4-2 — `mock-acp` `--load-session`

**Why.** Need a deterministic responder to drive integration tests for Phase 4.

**Files.**
- `tools/mock-acp/src/main.rs`.
- `tools/mock-acp/src/load_session.rs` (new).
- `tools/mock-acp/README.md`.

**Behavior.**
- New CLI flag: `--load-session <fixture-dir>` where fixture-dir contains
  `meta.json` and `replay.jsonl`.
- On receiving `session/load`:
  1. Validate `sessionId == fixture.meta.session_id`.
  2. Stream each line of `replay.jsonl` as a `session/update` notification, in
     order, before responding.
  3. Reply with `LoadSessionResponse { session_id, modes }` from `meta.json`.
- Optional `--reject-load <reason>` flag to simulate `-32601` and `-32602`
  errors for unsupported / invalid scenarios.
- Continue to support existing flags so other tests don't regress.

**Fixtures.**
- Add `tools/mock-acp/fixtures/load-session/basic/{meta.json,replay.jsonl}`.
- Add `tools/mock-acp/fixtures/load-session/unsupported/meta.json` (no replay).

**DoD.**
- Local manual smoke: `cargo run -p mock-acp -- --load-session ...` produces
  expected stdout frames.
- Existing mock-acp tests keep passing.

**Commit message.**
`feat(mock-acp): --load-session fixture mode for native resume tests`

---

## 7. Batch 4-3 — Backend resume mode dispatch

**Why.** Replace the P2-C placeholder rejection with real handling for
`acp_load` and `native_or_replay`. Keep `replay_only` semantics unchanged.

**Decision matrix.**

| `mode` | persistence meta | agent caps | action |
|---|---|---|---|
| `replay_only` | required | n/a | persistence replay (Phase 3) |
| `acp_load` | required | `loadSession=true` | spawn + load native |
| `acp_load` | required | `loadSession=false` | reject `native_resume_unsupported` |
| `acp_load` | missing | n/a | reject `vac_session_unknown` |
| `native_or_replay` | required | `loadSession=true` | try native; on `LoadSessionUnsupported` fallback to persistence replay |
| `native_or_replay` | required | `loadSession=false` | persistence replay with `resume_mode="replay_only_fallback"` |
| `native_or_replay` | missing | n/a | reject `vac_session_unknown` |

**Files.**
- `apps/local-bridge/src/translator/mod.rs` — `session.resume` arm.
- `apps/local-bridge/src/session/registry.rs` — new `resume_native(...)` API.
- `apps/local-bridge/tests/session_resume_modes.rs` — extend.

**ServerEvents (new shape).**
```
session.resume.started { vac_session_id, mode, agent_id, profile_id, project_root }
session.resumed         { vac_session_id, mode, native: bool, resume_mode: "native"|"replay_only"|"replay_only_fallback", replayed_events: N }
session.resume.failed   { vac_session_id, mode, reason, detail? }
```

**DoD.**
- Unit/integration tests cover the matrix above against `mock-acp`.
- Audit log records the chosen path.
- No regression in existing replay-only tests.

**Commit message.**
`feat(bridge): session.resume mode dispatch (acp_load / native_or_replay)`

---

## 8. Batch 4-4 — Native spawn + load flow

**Why.** Implement the actual `acp_load` happy path triggered by 4-3.

**Flow.**
1. Load `PersistedSessionMeta` for `vac_session_id`.
2. Resolve current agent snapshot from registry by `meta.agent_id`.
   - Reject `agent_not_in_registry` if missing.
3. Validate that the snapshot's `agent_kind` matches `meta.agent_kind`.
   - Reject `agent_kind_mismatch` otherwise.
4. Resolve `meta.profile_id`; reject `profile_not_found` if missing.
5. Validate `meta.project_root` exists and is allowed under current trust
   policy. Reject `project_root_unavailable` otherwise.
6. Spawn ACP child via `SessionRegistry::spawn_for_agent(...)` (existing path).
7. Initialize ACP (`initialize` request).
8. Start update / permission / fs / terminal pumps **before** `session/load`
   so streamed updates aren't dropped.
9. Call `AcpClient::load_session(LoadSessionRequest { ... })`.
10. On success:
    - Update meta: `agent_session_id = response.session_id`, refresh
      `native_resume.last_verified_at`.
    - Persist a synthetic event `vac.session_resumed_native` for traceability.
    - Emit `session.resumed { native: true, resume_mode: "native" }`.
11. On `LoadSessionUnsupported`:
    - If mode was `native_or_replay`, fall back to persistence replay (4-3).
    - Else emit `session.resume.failed { reason: "native_resume_unsupported" }`.

**Files.**
- `apps/local-bridge/src/session/registry.rs`.
- `apps/local-bridge/src/session/handle.rs`.
- `apps/local-bridge/src/session/persistence/mod.rs` — small helper to refresh `native_resume`.
- `apps/local-bridge/src/translator/mod.rs`.
- `apps/local-bridge/src/audit.rs` — new audit event types.
- `apps/local-bridge/tests/native_resume.rs` (new).

**DoD.**
- Native happy path test against `mock-acp` `--load-session`.
- Update pumps observe replayed `session/update`s before `session.resumed`.
- Persisted event log gains the `vac.session_resumed_native` marker.

**Commit message.**
`feat(bridge): native ACP session/load resume on acp_load mode`

---

## 9. Batch 4-5 — Frontend native resume UX

**Why.** Make the new modes selectable and the flow legible.

**Behavior.**
- `PersistentSessions` row gains:
  - Replay button (existing) when row.`status != forgotten`.
  - Native resume button enabled iff `native_resume_supported == true`.
  - Tooltip explains the difference.
- `ResumeStatus` chip extended with progress states:
  ```
  idle
  starting
  initializing
  loading_native
  replaying
  resumed { mode: 'native' | 'replay_only' | 'replay_only_fallback' }
  failed { reason }
  ```
  Each maps to one localized label and a deterministic color.

**Files.**
- `apps/web/src/stores/sessionHistory.ts` — extend `ResumeStatus` discriminated union.
- `apps/web/src/domain/sessions/history.ts` — translate new server events into
  the new states.
- `apps/web/src/components/Sessions/PersistentSessions.tsx` — two action
  buttons + disabled rationale.
- `apps/web/src/components/Topbar/ResumeStatus.tsx` — render new states.
- `apps/web/tests/...` — vitest reducer tests for new state machine.

**DoD.**
- Reducer tests pass.
- typecheck + build green.
- Manual smoke against `mock-acp --load-session` shows ordered state
  transitions.

**Commit message.**
`feat(web): native resume button + progress state machine`

---

## 10. Batch 4-6 — Integration tests

**Why.** Lock the contract between bridge, mock-acp, and frontend reducers.

**Test cases.**
1. `native_resume_success` — `acp_load`, capable agent, mock-acp returns
   replayed events then load response. Expect:
   - `resume.started` with `mode=acp_load`.
   - All replayed `session/update` events delivered with original ordering.
   - `session.resumed { native: true, resume_mode: "native" }`.
2. `native_resume_unsupported_rejected` — capability `loadSession=false`.
   Expect `resume.failed { reason: "native_resume_unsupported" }`.
3. `native_or_replay_fallback` — agent that responds `-32601` to
   `session/load`. Expect fallback to persistence replay and
   `resume_mode = replay_only_fallback`.
4. `missing_persistence_meta` — unknown `vac_session_id`. Expect
   `resume.failed { reason: "vac_session_unknown" }`.
5. `agent_kind_mismatch` — registry agent_kind differs from meta. Expect
   `resume.failed { reason: "agent_kind_mismatch" }`.
6. `project_root_unavailable` — meta references a path outside trust policy or
   nonexistent. Expect `resume.failed { reason: "project_root_unavailable" }`.
7. `replay_before_ready_ordering` — assert the relative order of
   `resume.started` → replayed updates → `session.resumed`.

**Files.**
- `tests/integration/native_resume.rs` (new) or extend existing
  `vac-integration` crate.
- `apps/web/src/domain/sessions/history.test.ts` (new) — frontend reducer
  edge cases.

**DoD.**
- All seven cases green via `cargo nextest run --workspace` and `pnpm -r test`.

**Commit message.**
`test: native ACP resume integration matrix`

---

## 11. Batch 4-7 — Docs + plan move

**Why.** Reflect shipped state and update operator documentation.

**Actions.**
- Update `docs/agent-runtime.md` with the resume mode matrix.
- Update `docs/protocol.md` with new ServerEvents and ClientCommand modes.
- Move this file to `docs/plans/00-shipped.md` summary entry once 4-1..4-6 land.
- Add `config/sessions/resume-policy.yaml` example with all three modes shown.
- Add `docs/plans/41-stage-x6-followups.md` for any deferred work
  (persistence retention TTL, multi-agent resume, etc.).

**DoD.**
- `pnpm schema:validate` still green.
- `docs/plans/00-shipped.md` lists Stage X6.

**Commit message.**
`docs(plans): record Stage X6 native session/load resume`

---

## 12. Cross-cutting risks & mitigations

- **Update pumps lifecycle.** Native load can stream a large number of
  `session/update` events synchronously. Keep pumps started **before** the
  request and apply the same backpressure as `session/new`.
- **Trust policy regressions.** `project_root` from meta may now be older than
  the current allowlist. Always re-validate on resume.
- **Cap drift.** If `agent_capabilities` snapshot says `loadSession=true` but
  the live agent answers `-32601`, surface `LoadSessionUnsupported` and update
  the snapshot's `last_verified_at` (don't pretend it's still supported).
- **JSONL forward compat.** Any new fields added to persisted events MUST be
  optional on read so older logs still parse.
- **MCP transport flap.** Use `setsid` + detached background jobs for
  long-running cargo / pnpm gates exactly as in Phase 3 — the orchestrator
  bash tool can be killed mid-run.
- **No auto-push.** Every batch ends with a local commit only; pushing to
  `origin/main` requires an explicit user instruction.

## 13. Sequencing summary

```
[P2-A] redaction-label
[P2-B] persistence-health
[P2-C] reject-non-replay-mode (placeholder)
        ↓
[4-1]  acp-client load_session types
[4-2]  mock-acp --load-session
[4-3]  bridge resume-mode dispatch (replaces P2-C placeholder logic)
[4-4]  bridge native spawn + load flow
[4-5]  web native resume UX
[4-6]  integration tests
[4-7]  docs + plan move
```

Each arrow is a hard dependency. Within a batch, run the full gate set
(`fmt --check`, `clippy -D warnings`, `cargo test -p local-bridge`,
`pnpm typecheck`, `pnpm -r test`, `pnpm --filter @vac-web/web build`,
`pnpm schema:validate`) before committing.

## 14. Definition of Done for the whole stage

- All 10 batches committed locally on `main`.
- Full gate set green from a clean checkout.
- `mock-acp --load-session` smoke video / log captured (manual).
- Operator docs updated to reflect the three resume modes.
- No regressions in the 417 nextest cases or 388 vitest cases that exist
  before Stage X6 starts.
- This file moved into `docs/plans/00-shipped.md` summary; any follow-ups
  filed under `41-stage-x6-followups.md`.
