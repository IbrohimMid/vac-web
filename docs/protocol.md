# Protocol v1 — Command & Event Catalog

**Status**: v1 draft (frozen after Phase 5)
**Wire format**: JSON (UTF-8), line-delimited for stdio hop; WebSocket text frames for client hop; binary frames for shell PTY.

---

## 1. Envelope

### Command (client → bridge)
```json
{
  "id":        "cmd_<ulid>",
  "sessionId": "sess_<ulid>",
  "type":      "namespace.action",
  "payload":   { ... },
  "v":         1
}
```

### Event (bridge → client)
```json
{
  "seq":       4821,
  "sessionId": "sess_<ulid>",
  "type":      "namespace.event",
  "payload":   { ... },
  "v":         1,
  "ts":        "2026-04-24T10:00:00.000Z"
}
```

### Ack (bridge → client)
```json
{ "ackOf": "cmd_<ulid>", "ok": true }
{ "ackOf": "cmd_<ulid>", "ok": false, "error": { "code": "…", "message": "…", "details": {...} } }
```

### Error codes

| Code | Meaning |
|---|---|
| `protocol.bad_envelope` | Missing required field |
| `protocol.unsupported_version` | `v` not supported |
| `session.not_found` | Unknown `sessionId` |
| `session.invalid_state` | Command illegal in current session state |
| `profile.denied` | Tool/action outside pinned profile |
| `profile.hash_mismatch` | Bridge/engine profile drift |
| `handoff.not_approved` | Executor session requested sans approved handoff |
| `handoff.expired` | Handoff past `expires_at` |
| `handoff.invalidated` | Pin no longer valid |
| `gate.override_required` | Gate blocks action; override needed |
| `resource.exhausted` | Session hit resource_limits |
| `connector.unavailable` | Connector disconnected or unhealthy |
| `connector.rate_limited` | Backoff required |
| `evidence.stale_hard_expire` | Cannot proceed with stale hard-expire evidence |
| `extensions.permission_denied` | **Audit hardening 2026-05-06** — `extensions.update_trust` was denied because the admin gate is not configured (`VAC_EXTENSIONS_ADMIN` unset), the caller did not supply `admin_token`, the token did not match, or the requested transition is forbidden (e.g. `revoked` → `allowed_*`). |
| `extensions.unknown_id` | **Audit hardening 2026-05-06** — `extensions.update_trust` referenced an extension id that is not registered in `config/extension-trust.yaml`. Auto-insert was removed; add the entry to the YAML file first. |
| `extensions.bad_payload` | `extensions.update_trust` payload missing `extension_id` or has an invalid `tier`. |
| `extensions.config_load_failed` | Bridge could not read `config/extension-trust.yaml`. |
| `extensions.config_save_failed` | Bridge could not persist `config/extension-trust.yaml` after applying an update. |
| `agent.not_registered` | **Stage X.4** — `session.create` payload `agent_id` does not match any agent in the runtime registry |
| `agent.disabled` | **Stage X.4** — selected `agent_id` exists but is `enabled = false` |
| `agent.kind_not_allowed` | **Stage X.2** — resolved agent kind is not in the profile's `allowed_agent_kinds` list (default-deny) |
| `agent.protocol_unsupported` | **Stage X.3** — command is not yet wired for the backing agent's wire dialect (e.g. ACP scaffold accepts `message.submit` only until X.5 widens it) |
| `internal` | Unexpected bridge error |

---

## 2. Handshake

On WS connect, client sends:
```json
{ "type": "hello", "protocolVersion": 1, "clientInfo": { "userAgent": "…", "deviceId": "…" } }
```

Bridge replies:
```json
{ "type": "welcome",
  "protocolVersion": 1,
  "bridgeVersion": "0.1.0",
  "capabilities": ["assessment", "handoff", "gate", "shell", "connectors"],
  "supportedProfiles": ["assessor.*@1.0.0", "executor.code@1.0.0", "executor.release@1.0.0"] }
```

Authentication: JWT in `Sec-WebSocket-Protocol` header (or first frame) — see `capability-profiles.md §10`.

---

## 3. Command catalog

### 3.1 System

| Command | Payload | Response |
|---|---|---|
| `system.ping` | — | `system.pong` event |
| `system.version` | — | bridge/engine versions |
| `system.capabilities` | — | supported features list |

### 3.2 Session

| Command | Payload | Notes |
|---|---|---|
| `session.create` | `{ project_root, profile_id, handoff_id?, title?, agent_id? }` | Returns `session_id`. `handoff_id` required iff `profile_id` class is executor. **Stage X.4** — `agent_id` is additive: when omitted, the bridge spawns its default agent; when present, it must resolve via the `AgentRuntimeRegistry` to an enabled agent whose kind is in `profile.allowed_agent_kinds` (else see §6 errors). See sample [`packages/protocol/v1/_samples/command/valid-session-create-agent-id.json`](../packages/protocol/v1/_samples/command/valid-session-create-agent-id.json). |
| `session.resume` | `{ sessionId }` | Attach to existing session |
| `session.list` | `{ filter? }` | — |
| `session.snapshot` | `{ sessionId }` | Request full snapshot resync |
| `session.rename` | `{ sessionId, title }` | — |
| `session.close` | `{ sessionId }` | — |

### 3.3 Conversation

| Command | Payload |
|---|---|
| `message.submit` | `{ text, mentions?[], attachments?[] }` |
| `message.cancel_stream` | `{ messageId }` |
| `message.retry` | `{ messageId }` |

### 3.4 Approval

| Command | Payload |
|---|---|
| `approval.approve` | `{ approvalId }` |
| `approval.approve_all` | `{ scope }` |
| `approval.reject` | `{ approvalId, reason? }` |
| `approval.inspect` | `{ approvalId }` |

### 3.5 Workbench

| Command | Payload |
|---|---|
| `workbench.select_tab` | `{ tab }` |
| `workbench.invoke` | `{ tab, action, args? }` |

### 3.6 Review

| Command | Payload |
|---|---|
| `review.open_file` | `{ path }` |
| `review.toggle_hunk` | `{ path, hunkId }` |
| `review.revert_file` | `{ path }` |
| `review.revert_all` | — |

### 3.7 Runtime

| Command | Payload |
|---|---|
| `runtime.list_jobs` | — |
| `runtime.cancel_job` | `{ jobId }` |
| `runtime.inspect_job` | `{ jobId }` |

### 3.8 Plan

| Command | Payload |
|---|---|
| `plan.open` | `{ planId? }` |
| `plan.edit` | `{ planId, ops[] }` |
| `plan.approve` | `{ planId }` |
| `plan.reject` | `{ planId, reason? }` |

### 3.9 Shell

| Command | Payload |
|---|---|
| `shell.start` | `{ profile? }` |
| `shell.input` | `{ shellId, data (base64) }` |
| `shell.resize` | `{ shellId, cols, rows }` |
| `shell.kill` | `{ shellId }` |

### 3.10 Context

| Command | Payload |
|---|---|
| `context.attach_files` | `{ paths[] }` |
| `context.mention_search` | `{ query, limit? }` |

### 3.11 Palette / Action

| Command | Payload |
|---|---|
| `palette.invoke_action` | `{ actionId, args? }` |

### 3.12 Overlay

| Command | Payload |
|---|---|
| `overlay.open` | `{ overlayKind, params? }` |
| `overlay.dismiss` | `{ overlayId }` |
| `overlay.dismiss_all` | — |

### 3.13 Assessment

| Command | Payload |
|---|---|
| `assessment.run` | `{ type, scope, profileId?, depth }` |
| `assessment.list_runs` | `{ filter? }` |
| `assessment.fetch_report` | `{ runId }` |
| `assessment.cancel` | `{ runId }` |
| `assessment.replay` | `{ runId }` |
| `assessment.diff` | `{ baseRunId, headRunId }` |

### 3.14 Handoff

| Command | Payload |
|---|---|
| `handoff.create` | `{ fromRunIds[], acceptedFindingIds[], title, target }` |
| `handoff.fetch` | `{ handoffId }` |
| `handoff.approve` | `{ handoffId, approverNote? }` |
| `handoff.reject` | `{ handoffId, reason }` |
| `handoff.dispatch_local` | `{ handoffId }` |
| `handoff.dispatch_web_cli` | `{ handoffId }` |
| `handoff.export_blueprint` | `{ handoffId, format }` |
| `handoff.cancel` | `{ handoffId }` |

### 3.15 Gate

| Command | Payload |
|---|---|
| `gate.evaluate` | `{ gate, scope }` |
| `gate.override` | `{ gate, reason, scope, expiresAt }` |
| `gate.signoff` | `{ gate, role }` |
| `gate.revoke_override` | `{ overrideId, reason }` |

### 3.16 Connector

| Command | Payload |
|---|---|
| `connector.list` | — |
| `connector.connect` | `{ kind, authPayload }` |
| `connector.disconnect` | `{ id }` |
| `connector.capabilities` | `{ id }` |
| `connector.health` | `{ id }` |

### 3.17 Extension

`extensions.list` and `extensions.update_trust` are **sessionless** commands (`session_id` field is empty); they target the bridge-level extension trust config rather than a per-session profile. `extensions.update_trust` mutates `config/extension-trust.yaml` and is **gated by an operator-managed admin token** (audit hardening 2026-05-06).

| Command | Payload | Notes |
|---|---|---|
| `extensions.list` | `{}` | Sessionless. Read-only. Returns `extensions.list_response` event with the trust config + per-entry runtime decision. |
| `extensions.update_trust` | `{ extension_id, tier, admin_token? }` | Sessionless. **State-mutating.** `tier` ∈ `allowed_bundled` \| `allowed_signed` \| `quarantined` \| `revoked`. **Auth:** the bridge env var `VAC_EXTENSIONS_ADMIN` must be set to a non-empty secret; the caller MUST echo it as `admin_token`. With env unset, every call returns `extensions.permission_denied`. **No auto-insert:** unknown `extension_id` returns `extensions.unknown_id`; add the entry to `config/extension-trust.yaml` first. **Restricted transitions:** `revoked` → `allowed_bundled` and `revoked` → `allowed_signed` are rejected with `extensions.permission_denied` (require manual config edit / future two-party approval); `revoked` → `quarantined` is allowed as a cleanup path. Every accepted or denied call writes a structured audit record to subsystem `extensions` with `actor` / `extension_id` / `prev_tier` / `next_tier` / `decision` / `ts` / `cmd_id`. On success, emits `extensions.updated`. Implemented at `apps/local-bridge/src/extensions/handlers.rs`. |

---

## 4. Event catalog

### 4.1 Session

| Event | Payload |
|---|---|
| `session.ready` | `{ session_id, profile_id, profile_hash?, project_root?, agent_id, agent_kind }` — **Stage X.4** adds `agent_id` (registry id of the agent backing this session) and `agent_kind` (`"mock"` \| `"vac-native"` \| `"acp"`) so clients can render runtime affordances and gate UI. |
| `session.snapshot` | full SessionSnapshot |
| `session.updated` | `{ fields: {...} }` |
| `session.closed` | `{ reason }` |

### 4.2 Transcript

| Event | Payload |
|---|---|
| `transcript.message_added` | `{ messageId, role, createdAt }` |
| `transcript.delta` | `{ messageId, delta }` |
| `transcript.completed` | `{ messageId, usage }` |
| `transcript.error` | `{ messageId, error }` |

### 4.3 Approval

| Event | Payload |
|---|---|
| `approval.pending` | `{ approvalId, toolCall, risk }` |
| `approval.resolved` | `{ approvalId, decision, byClientId? }` |
| `approval.expired` | `{ approvalId }` |

### 4.4 Workbench

| Event | Payload |
|---|---|
| `workbench.state` | tab-specific state union |

### 4.5 Review

| Event | Payload |
|---|---|
| `review.diff_ready` | `{ path, diffSummary }` |
| `review.changeset_updated` | `{ files[] }` |

### 4.6 Runtime

| Event | Payload |
|---|---|
| `runtime.jobs_updated` | `{ jobs[] }` |
| `runtime.job_log` | `{ jobId, line }` |

### 4.7 Plan

| Event | Payload |
|---|---|
| `plan.updated` | Plan object |

### 4.8 Shell

| Event | Payload |
|---|---|
| `shell.started` | `{ shellId }` |
| `shell.output` | binary frame or `{ shellId, data (base64) }` |
| `shell.exited` | `{ shellId, code }` |

### 4.9 System grammar

| Event | Payload |
|---|---|
| `system_pulse.updated` | `{ facets[] }` |
| `notify.event` | `{ lane, severity, subsystem, message, actionId? }` |
| `overlay.opened` | `{ overlayId, kind }` |
| `overlay.dismissed` | `{ overlayId }` |
| `activity.appended` | `{ entry }` |

### 4.10 Assessment

| Event | Payload |
|---|---|
| `assessment.started` | `{ runId, type, profileId }` |
| `assessment.progress` | `{ runId, stage, pct, currentCheck? }` |
| `assessment.finding_added` | `{ runId, finding }` |
| `assessment.evidence_attached` | `{ runId, findingId, evidence }` |
| `assessment.evidence_stale_detected` | `{ runId, findingId, evidenceRef, reason }` |
| `assessment.completed` | `{ runId, verdict, counts }` |
| `assessment.failed` | `{ runId, error }` |
| `assessment.diff_ready` | `{ diffId, baseRunId, headRunId }` |

### 4.11 Handoff

| Event | Payload |
|---|---|
| `handoff.created` | `{ handoffId }` |
| `handoff.approved` | `{ handoffId, approver }` |
| `handoff.rejected` | `{ handoffId, reason }` |
| `handoff.dispatched` | `{ handoffId, executorSessionId }` |
| `handoff.execution_progress` | `{ handoffId, taskId, status }` |
| `handoff.completed` | `{ handoffId, outcome }` |
| `handoff.invalidated` | `{ handoffId, reason }` |
| `handoff.expired` | `{ handoffId }` |

### 4.12 Gate

| Event | Payload |
|---|---|
| `gate.state_changed` | `{ gate, before, after, reasons[] }` |
| `gate.override_applied` | `{ gate, overrideId }` |
| `gate.override_revoked` | `{ overrideId }` |

### 4.13 Connector

| Event | Payload |
|---|---|
| `connector.connected` | `{ id, kind }` |
| `connector.disconnected` | `{ id }` |
| `connector.health` | `{ id, ok, latencyMs }` |
| `connector.rate_limited` | `{ id, retryAfterMs }` |

### 4.14 Extension

| Event | Payload |
|---|---|
| `extensions.list_response` | `{ version, allow_unsigned, publishers[], entries[] }` — `entries[]` items are `{ id, tier, source, publisher, decision }` where `decision` is the live runtime trust decision (`allowed_bundled` \| `allowed_signed` \| `quarantined` \| `revoked`) recomputed by `enforce_extension_trust`. |
| `extensions.updated` | `{ entry: { id, tier, source, publisher, decision } }` — emitted after a successful `extensions.update_trust` mutation. |

---

## 5. Replay protocol

On reconnect:
```json
{ "type": "replay.request", "sessionId": "sess_…", "lastEventId": 4821 }
```

Bridge responds with either:
- Stream of events with `seq > 4821`, or
- `{ "type": "replay.out_of_range" }` followed by fresh `session.snapshot`.

Ring buffer size (default 5000 events) capped per session.

---

## 6. Coalescing policy

Bridge MAY coalesce consecutive `transcript.delta` events for the same `messageId` if client queue backpressure detected, concatenating `delta` strings. Coalescing is transparent to clients; `seq` gaps never result.

Max emission rate per session: 60 `transcript.delta`/s. Above that → forced concat.

---

## 7. Versioning

- `v: 1` for all v1 envelopes.
- Breaking changes → `v: 2` with parallel support during transition.
- Additive (new command/event types) do not bump `v`; clients MUST ignore unknown types.
- Schema snapshots frozen at `packages/protocol/v1/`; hash-checked at bridge startup.

---

## 8. Related

- [`architecture.md`](./architecture.md) §3 — transport layers
- [`capability-profiles.md`](./capability-profiles.md) — profile enforcement semantics
- [`assessment-contract.md`](./assessment-contract.md) — assessment payloads
- [`handoff-contract.md`](./handoff-contract.md) — handoff payloads
- [`gates.md`](./gates.md) — gate payloads
- [`agent-runtime.md`](./agent-runtime.md) — Stage X additive `agent_id` on `session.create`; provider events normalized into existing VAC events.
