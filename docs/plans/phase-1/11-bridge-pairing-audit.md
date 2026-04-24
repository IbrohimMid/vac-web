# Plan 11 — Bridge pairing + JWT + audit log

**Phase**: 1 · **Depends on**: Plan 07 · **Blocks**: Phase 1 exit · **Est**: 1.5 days

## Goal

Stand up the security perimeter around the bridge: pairing flow for first-time clients, short-lived JWTs scoped to device + project, append-only audit log with proper retention.

## Why this is hard

Local bridges are low-consequence when it's 127.0.0.1; they become high-consequence the moment someone uses a tunnel. The flow must be "secure by default"—no lazy shortcut (like long-lived bearer in localStorage) that will bite when remote.

## Scope

### In
- Pairing flow: UI requests → bridge prints code → web exchanges → JWT minted.
- JWT scope: `(device_id, project_root, session_id?)`.
- Refresh flow.
- Revocation.
- Audit log: per-session + global + handoff-specific + gate-specific.
- Rotation + retention.

### Out
- OAuth / connector auth (Plan 24).
- Relay auth (Phase 7).

## Deliverables

```
apps/local-bridge/src/
├── auth/
│   ├── mod.rs
│   ├── pairing.rs         # code mint + exchange
│   ├── jwt.rs             # sign + verify
│   ├── device.rs          # DeviceId persistence
│   ├── allowlist.rs       # project allowlist loader
│   └── revoke.rs
├── audit/
│   ├── mod.rs
│   ├── writer.rs          # JSONL append, non-blocking
│   ├── rotate.rs
│   └── redact.rs
```

## Stages

### S1 — DeviceId + bridge state (0.2 day)

On first start, mint a bridge instance id + signing key (Ed25519):
- `~/.config/vac-web/bridge.toml`:
  ```toml
  bridge_id = "..."
  jwt_secret_b64 = "..."      # 32 random bytes
  created_at = "ISO8601"
  ```
- File perms `0600`; `0700` on parent dir.

Each connecting client gets a `device_id` from its hello frame (persistent, stored in localStorage on web).

**Exit**: bridge.toml created on first start; permissions verified.

### S2 — Pairing flow (0.4 day)

UI action: "Pair new device".
1. `POST /api/pair/mint` (unauthenticated): bridge generates 8-digit numeric code + 16-char token, TTL 60s. Stored in-memory.
2. Bridge prints to terminal + optional QR (for scanning from mobile).
3. Client prompts user for code.
4. `POST /api/pair/exchange { code, device_id, project_root }`:
   - Validates code exists + not expired.
   - Validates `project_root` in allowlist (bridge.toml `projects[]`).
   - Mints JWT (see S3).
   - Returns `{ access_token, refresh_token, expires_in }`.
5. Code consumed.

**Exit**: CLI demo: start bridge, open web, enter code, get tokens.

### S3 — JWT sign + scope (0.3 day)

Access token:
```json
{
  "iss": "vac-bridge:<bridge_id>",
  "sub": "device:<device_id>",
  "aud": "vac-web",
  "exp": <now + 15m>,
  "iat": <now>,
  "scope": {
    "project_root": "/abs/path",
    "session_id": "sess_..."            // present when scoped to specific session
  },
  "capabilities": ["session.create", "connector.*"]
}
```

Refresh token: opaque random string, stored server-side; TTL 7d; single-use (rotate on each refresh).

Signing: HS256 with `jwt_secret_b64`.

Refresh endpoint `POST /api/auth/refresh { refresh_token }` → new access + new refresh.

**Exit**: token round-trips; expired token rejected; tampered signature rejected.

### S4 — WS auth enforcement (0.2 day)

WS upgrade requires valid access token — either in `Sec-WebSocket-Protocol` (subprotocol value) or in first `hello` frame:
```json
{"type":"hello","auth": {"access_token": "..."}, ...}
```

Verification:
- Check signature.
- Check `exp`.
- Check `aud == "vac-web"`.
- Bind connection to `device_id` + `project_root` + optional `session_id` scope.

Per-command: commands operating on `sessionId` outside scope rejected.

**Exit**: WS without token rejected; mis-scoped command rejected.

### S5 — Project allowlist (0.2 day)

`bridge.toml`:
```toml
[[projects]]
path = "/abs/path/to/project-a"
label = "Project A"
added_at = "ISO8601"
```

API: `POST /api/projects/allow { path }` (authenticated, requires confirmation dialog in UI).

Reject `session.create` with `project_root` not in allowlist.

**Exit**: RT (red-team) test: create session outside allowlist → denied.

### S6 — Revocation (0.2 day)

`POST /api/auth/revoke { token_id? | device_id? }`:
- Revokes specific refresh token or all tokens for a device.
- Revocation list stored in `~/.config/vac-web/revoked.jsonl`.
- Access tokens checked against revocation: since short-lived, mostly self-expire; refresh flow blocked immediately.

UI surface: "Devices" page listing connected devices + Revoke button.

**Exit**: revoked device can't refresh; active WS for revoked device closes within 60s.

### S7 — Audit writer (0.3 day)

```rust
pub struct AuditWriter {
    tx: mpsc::Sender<AuditEntry>,
}
impl AuditWriter {
    pub fn log(&self, entry: AuditEntry) {
        let _ = self.tx.try_send(entry);  // drop on overflow; count drops as metric
    }
}
// background task: receive, serialize JSONL, append to per-session file
```

Per-session files at `~/.config/vac-web/audit/sessions/<session_id>.jsonl`.
Per-handoff files at `~/.config/vac-web/audit/handoffs/<handoff_id>.jsonl`.
Per-gate files at `~/.config/vac-web/audit/gates/<project_hash>/<gate>.jsonl`.

Writer is non-blocking: overflow drops entries + increments `audit.dropped` metric; never blocks hot path.

**Exit**: flood test: 10k log calls in 1s; none lost (assuming channel cap 50k); in overflow scenario, drop counter reflects.

### S8 — Rotation + retention (0.2 day)

Rotation:
- Size-based: files > 10MB → rotate to `<name>.<n>.jsonl.gz`.
- Time-based: per session end, close file; maintain roll by date under `audit/archive/YYYY/MM/DD/`.

Retention:
- Session audit: per `CapabilityProfile.audit.retain_for_days` (default 90).
- Gate audit: **indefinite** (governance requirement).
- Handoff audit: indefinite.
- Scheduler runs daily; deletes expired; logs actions.

**Exit**: rotation + deletion tested with mock timestamps.

### S9 — Redaction (0.2 day)

`redact.rs`:
- Per `CapabilityProfile.audit.log_tool_args`: `none | redacted | full`.
- `redacted` mode: replace args with `{digest: sha256, size, type}`.
- Secret patterns: GitHub tokens, AWS keys, OpenAI keys, JWTs — always redacted even in `full` mode; flagged as audit-level security event.

**Exit**: audit entry for tool call with token in args shows redaction.

## Testing

- JWT round-trip + tampering.
- Pairing end-to-end.
- Allowlist enforcement.
- Audit writer flood test.
- Retention scheduler.

## Exit criteria

- [ ] Pairing + JWT flow works in dev.
- [ ] Revocation closes active connections.
- [ ] Audit log rotates + retains per profile.
- [ ] Secret redaction verified.
- [ ] RT-012, RT-013, RT-053 (multi-session JWT isolation) pass.

## Risks

| Risk | Mitigation |
|---|---|
| JWT secret leak via backup | `bridge.toml` permissions strict; documented as sensitive |
| Audit writer backpressure | Non-blocking with drop counter; monitoring alert |
| Clock skew between signer + verifier | Only matters for single host; tolerance 5s |
| Revocation race | Revocation checked on every refresh + periodic check on active WS |

## Related

- [`architecture.md`](../../architecture.md) §4, §11 — data stores, security
- [`capability-profiles.md`](../../capability-profiles.md) §10 — audit schema
- Plan 07 — WS transport (hosts this)
- Plan 10 — enforcement (writes audit)
