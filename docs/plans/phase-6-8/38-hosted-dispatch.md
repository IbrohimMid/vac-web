# Plan 38 — Hosted dispatch + relay

**Phase**: 7 · **Depends on**: Plans 07, 08, 11, upstream PR #10 · **Blocks**: Phase 7 exit · **Est**: 3–4 weeks

## Goal

Enable "remote attach" pattern like Claude Code Remote Control. Bridge dials outbound to a relay; browser on any network connects to the relay domain; relay routes messages to the correct bridge by device+session. Filesystem, tools, and keys never leave user's machine.

## Why this is hard

This is new infrastructure. Outbound-only means no inbound port on user's machine — which is both the safety feature and the challenge (tunneling, reconnect, scaling relay). Plus: pairing UX, device revocation, E2E encryption option, and trust boundaries when relay is in the middle.

## Scope

### In
- Relay service (new deploy target).
- Bridge `vac-bridge tunnel` outbound dial mode.
- QR-based pairing from CLI → mobile/web.
- `TeleportToken` minting + verification (upstream PR #10).
- Reconnect with `last_event_id` across relay.
- Device revocation flow.
- Optional E2E keypair channel.

### Out
- Multi-relay geo routing (scale later).
- Cloud-executed sessions (out of scope; bridge stays local).

## Deliverables

```
relay-service/                         (new repo or apps/ entry)
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── register.rs                    # device dial-in
│   ├── route.rs                       # client ↔ bridge multiplex
│   ├── auth.rs
│   ├── rate_limit.rs
│   └── e2e.rs                          # optional passthrough E2E

apps/local-bridge/src/tunnel/
├── mod.rs
├── dial.rs
├── reconnect.rs
├── pairing.rs
└── e2e_keys.rs

apps/web/src/transport/
└── remote.ts                          # attach via relay domain
```

## Stages

### S1 — Relay service scaffold (0.5 week)

Stateless routing server:
- Device dial: outbound WS from bridge → sent `tunnel.register { device_id, public_key? }`.
- Client connect: WS from browser → `tunnel.attach { device_id, session_id }` → relay pairs with bridge.
- Once paired: relay shuffles frames both directions transparently.

Language: Rust (axum + tokio).

No persistent storage for session content. Only in-memory routing table + short-lived state.

Deploy target: Fly.io / Cloudflare Workers / user-hosted.

**Exit**: smoke test — bridge dials in, client attaches, frames flow.

### S2 — Bridge tunnel dial (0.3 week)

```rust
pub async fn dial_tunnel(relay_url: &str, teleport_token: &str) -> Result<TunnelHandle> {
    let ws = connect_ws(relay_url).await?;
    send_register(&ws, teleport_token).await?;
    // spawn reader/writer tasks
    Ok(TunnelHandle { ws, ... })
}
```

Persistent connection with auto-reconnect (Plan 12's reconnect logic, server side).

Multiplex: existing session multiplexing (Plan 07) now runs through tunnel instead of local WS server.

**Exit**: bridge + tunnel: server runs, responds to client via relay.

### S3 — Pairing flow (0.3 week)

CLI new command: `vac-bridge pair --remote`.
1. Mints `TeleportToken` via upstream PR #10 (scoped to device + TTL 10min).
2. Displays QR + URL.
3. User scans / opens in browser; page is served by relay (vac-web SPA with remote-attach mode).
4. Browser posts `pair.claim { token }` → relay forwards to the bridge that dialed with same token.
5. Bridge confirms → relay issues a new session token for this browser.
6. Browser connects via session token.

Single-use tokens; replay prevention.

**Exit**: end-to-end: scan QR from phone → attach to desktop bridge → see session.

### S4 — Reconnect + replay across relay (0.2 week)

Client reconnect: sends `last_event_id` + session token; relay routes to bridge; bridge replays from its ring buffer.

Bridge lost connection with relay: on reconnect, re-establishes and continues serving existing subscribers.

**Exit**: network disruption doesn't lose state.

### S5 — Device revocation (0.2 week)

User endpoint in web UI: "Devices" page lists every device that has ever dialed in.

Actions:
- Revoke: invalidates all tokens + kills active tunnel connection for that device.
- Rename: cosmetic.
- Allow only from these IPs (advanced; optional).

Revocation list synced to relay (signed list + TTL).

**Exit**: revoke device → active session immediately disconnects.

### S6 — Optional E2E encryption (0.3 week)

Opt-in mode: bridge + client exchange public keys during pairing; relay sees only encrypted blobs.

Implementation: libsodium box (XChaCha20-Poly1305). Each frame wrapped.

Not on by default (performance + complexity tradeoff). Users enable via `vac-bridge pair --e2e`.

**Exit**: E2E-enabled session works; relay logs show only ciphertext.

### S7 — Rate limiting + abuse (0.2 week)

Per device: max concurrent tunnels (5), frames/sec (1000), bandwidth cap (5MB/s).

Relay kicks abusing devices. Logs + alerts.

**Exit**: abuse scenario tested.

### S8 — Auth flow (0.2 week)

TeleportToken: JWT signed by VAC upstream key (PR #10 exposes mint + verify).

Claims:
- `device_id`
- `issued_at` / `exp` (short for pair: 10min; long for session: 7d with refresh)
- `scope`

Relay verifies on every frame (cheap). Rotation via refresh endpoint.

**Exit**: forged token rejected.

### S9 — Client surfaces (0.2 week)

Web `transport/remote.ts`: attach mode via relay URL + session token.

UI flags:
- Connection mode: direct localhost vs remote relay.
- Latency indicator.
- E2E status indicator.

**Exit**: client works in both modes transparently.

### S10 — Red-team + new cases (0.2 week)

New adversarial cases specific to relay:
- Relay compromised: E2E off, relay logs chat.
- Token exfil from browser localStorage.
- Man-in-the-middle on first pair (TOFU).
- Replay attack on pair token.
- DoS against relay.

Documented in extended red-team matrix.

**Exit**: mitigation plan per case; gating issues resolved.

## Testing

- Relay integration tests with in-memory bridge + client.
- End-to-end: real devices, real network.
- Reconnection stress.

## Exit criteria

- [ ] Scan QR from phone → attach to desktop → see streaming session.
- [ ] E2E mode works (opt-in).
- [ ] Device revoke effective.
- [ ] Reconnect preserves state.
- [ ] No inbound port opened on user's machine.

## Risks

| Risk | Mitigation |
|---|---|
| Relay becomes single point of failure | Multi-region + stateless; user-hostable |
| Relay operator trust concerns | E2E opt-in; open-source relay |
| QR scan flow fails on weird networks | Fallback: copy-paste URL |
| Tunnel churn in poor networks | Exponential backoff + heartbeat |

## Related

- [`architecture.md`](../../architecture.md) §10 — hosted dispatch design
- Upstream VAC PR #10 — TeleportToken
- Plan 11 — JWT auth (reused patterns)
