# Phase 1.4 — Pairing + JWT + Audit Integration

**Duration**: 1.5 days
**Position**: after Phase 1.3 (translator + enforcement); before Phase 1.5 (web scaffold)
**Status**: ✅ **DONE** (scaffolded; see cargo tests + `apps/web` build)

## Goal

Make the bridge actually secure to run on a user's machine. Pairing flow for first-connect, short-lived JWT scoped to device+project, project allowlist, full audit log wiring via `bridge-core::AuditWriter`.

## Entry criteria

- Phase 1.3 exit: translator + enforcement green; red-team 37 cases pass through bridge fixture.
- `bridge-core::AuditWriter` already usable.

## Scope

### In
- `POST /api/pair/mint` → 8-digit code + 16-char token, TTL 60s.
- `POST /api/pair/exchange` → JWT (15min access) + refresh (7d, single-use rotation).
- JWT HS256 signing; key at `~/.config/vac-web/bridge.toml` (0600).
- WS auth: token in subprotocol or first frame.
- Project allowlist from `bridge.toml`; enforce on `session.create`.
- Revocation API + list.
- Full audit log: every tool decision + every session event + every handoff action.
- Audit rotation + retention per `CapabilityProfile.audit`.
- Secret redaction in audit payload.

### Out
- OAuth / connector auth (Phase 3).
- Hosted dispatch / relay (Phase 7).

## Granular plan

Follows [`docs/plans/phase-1/11-bridge-pairing-audit.md`](../phase-1/11-bridge-pairing-audit.md).

## Day-by-day

### Day 1 — Pairing + JWT
- Bridge secret generation on first startup.
- Mint endpoint + UI-side flow (code displayed in terminal).
- Exchange + refresh endpoints.
- WS subprotocol `bearer.<token>` parsed at upgrade.
- Per-command scope validation (session_id binding).

### Day 2 — Audit + allowlist
- AuditWriter wired from Phase 0.6 into session manager + profile layer.
- Per-session, per-handoff, per-gate audit paths.
- Rotation (10MB size, `.N.gz` archive).
- Retention scheduler (daily deletion task).
- Redaction filter (GitHub tokens, AWS keys, JWTs).
- Project allowlist check on `session.create`.
- Revocation list sync.

## Deliverables

```
apps/local-bridge/src/auth/
├── mod.rs
├── pairing.rs
├── jwt.rs
├── device.rs
├── allowlist.rs
└── revoke.rs
apps/local-bridge/src/audit/
├── mod.rs
├── writer.rs          # wraps bridge-core::AuditWriter
├── rotate.rs
└── redact.rs
```

## Exit criteria (gate to Phase 1.5)

- [ ] Pairing demo: start bridge → CLI prints code + URL → browser pastes code → JWT received.
- [ ] WS without token rejected.
- [ ] Session creation outside allowlist rejected.
- [ ] Revocation closes active WS within 60s.
- [ ] Audit log populated for every tool decision + every approval + every session lifecycle event.
- [ ] Rotation test (small size, forced flush) produces `.N.gz`.
- [ ] Secret redaction: known vectors redacted; raw secret never appears in log.
- [ ] Red-team RT-053 (multi-session JWT isolation) passing.

## Risks

| Risk | Mitigation |
|---|---|
| Token in URL / browser history | Token always in Sec-WebSocket-Protocol header, never in URL |
| bridge.toml leak via backup | Document sensitivity; check `0600` perms on create |
| Audit writer backpressure | Non-blocking + drop counter (from bridge-core) |
| Clock skew on JWT exp | ±5s tolerance |

## Related

- [Plan 11 — pairing + audit](../phase-1/11-bridge-pairing-audit.md)
- [`bridge-core/src/audit.rs`](../../../packages/bridge-core/src/audit.rs) (authored in Phase 0.6)
- [`docs/architecture.md §11`](../../architecture.md) — security boundaries

## Handoff to Phase 1.5

Phase 1.5 web scaffold needs:
- Working `POST /api/pair/exchange` to convert code → JWT.
- JWT persistence in browser localStorage.
- Revocation UX listed in "Devices" page scaffolding (deferred to Phase 6 fully).
