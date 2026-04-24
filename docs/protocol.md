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
| `session.create` | `{ projectRoot, profileId, handoffId?, title? }` | Returns `sessionId`. `handoffId` required iff `profileId` class is executor. |
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

---

## 4. Event catalog

### 4.1 Session

| Event | Payload |
|---|---|
| `session.ready` | `{ sessionId, profileId, profileHash, projectRoot }` |
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
