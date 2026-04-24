# Phase 7 — Hosted dispatch + relay

**Total duration**: ~18 days (7 sub-phases, 1 granular plan in `plans/phase-6-8/`)
**Position**: after Phase 6.8 (v1 GA green); before Phase 8 (Continuous readiness)
**Status**: 🔴 **NOT STARTED**

## Goal

Cut the "must be on the same network as my workstation" cord. A user opens `https://vac-web.example.com` from a phone on airport wifi, scans a QR code from the desktop bridge, and lands in the same session they left — files never leave the desktop, tools never run in the cloud. This is the feature that makes vac-web ambient rather than deskbound.

Three anchors:

1. **Outbound-dial bridge** — `vac-bridge tunnel --relay <url>` opens a single long-lived outbound connection to a relay service. No inbound port on the user's machine. Reconnect + re-register on drop, with `last_event_id` replay so clients don't miss events mid-reconnection.
2. **Thin, blind relay** — a new service that routes frames by `{device_id, session_id}` without content inspection. Optional E2E keypair mode adds encryption between bridge and browser; relay sees ciphertext only. Rate limits + device revocation live here.
3. **QR pairing + claude.ai/code-style session list** — web UI that works on a phone. Desktop TUI mints a `TeleportToken`, renders a QR; the browser scans and lands.

Exit: full end-to-end demo from a phone on a different network; E2E mode tested; device revocation propagates within 5s; relay scales to 1000 concurrent devices on a single node; zero filesystem exposure in transit.

## Sub-phase map

| Sub-phase | Focus | Days | Granular plan |
|---|---|---|---|
| **7.1** | Upstream VAC PR #10 (`TeleportToken` mint/verify + `RemoteSessionConfig`) | 2 | [38-hosted-dispatch](../phase-6-8/38-hosted-dispatch.md) §upstream |
| **7.2** | Relay service scaffold: registration + routing + auth | 4 | [38-hosted-dispatch](../phase-6-8/38-hosted-dispatch.md) §relay |
| **7.3** | Bridge `tunnel` mode: outbound dial + reconnect + `last_event_id` replay | 3 | [38-hosted-dispatch](../phase-6-8/38-hosted-dispatch.md) §bridge |
| **7.4** | Web client adapts to relay transport: URL scheme + replay cursor + multi-session list | 2 | [38-hosted-dispatch](../phase-6-8/38-hosted-dispatch.md) §web |
| **7.5** | QR pairing: TUI mints token + renders QR; web scans + claims | 1.5 | [38-hosted-dispatch](../phase-6-8/38-hosted-dispatch.md) §pairing |
| **7.6** | E2E keypair channel (optional mode) | 2 | [38-hosted-dispatch](../phase-6-8/38-hosted-dispatch.md) §e2e |
| **7.7** | Device revocation + red-team (cases 121–145) + perf + exit sweep | 1.5 | — |

## Critical path

```
7.1 ──▶ 7.2 ──┬──▶ 7.3 ──▶ 7.4 ──▶ 7.5 ──▶ 7.7
              └──▶ 7.6 ────────────────▶ 7.7
```

- **7.1 first** — `TeleportToken` mint/verify is the authentication primitive everything else uses. Can't fake a token shape that moves later.
- **7.2 before 7.3** — the bridge dial-out needs a target to dial; the relay's registration protocol must be stable first.
- **7.3 before 7.4** — web client can't exercise replay-on-reconnect until the bridge emits `last_event_id` correctly.
- **7.4 before 7.5** — QR pairing produces a URL the browser loads; URL scheme must be finalized.
- **7.6 can parallelize with 7.4+7.5** — E2E is an optional mode layered on top of plain mode; once the relay's frame routing is stable (end of 7.2), the E2E track can start. In practice one person can ship 7.4+7.5 while another (or another session) ships 7.6.
- **7.7 last** — revocation + red-team + perf sweep validate the full surface.

## Prerequisites

- Phase 6.8 green: v1 GA cockpit, 120+ red-team cases, 290+ workspace tests.
- Upstream: `vastar-agentic-cli` at a commit where PR #10 (`TeleportToken`) is mergeable.
- A deploy target for the relay (cloudflare-workers, fly.io, or a tiny VPS — locked down to outbound-from-bridge + inbound-from-browser only).
- TLS automation for the relay domain (Let's Encrypt or managed).
- An existing HTTP health endpoint on the relay reachable from both sides (pre-exists on most managed deploys).
- Bridge build pipeline can produce a static binary for macOS + Linux (already true from Phase 1).

## What's explicitly OUT of Phase 7

- **Cloud-executed sessions** — the bridge stays local; remote just means remote *view/control*, not remote execution. The filesystem/tool boundary is untouched.
- **Multi-relay geo routing** — a single relay region for v1 GA; regional fan-out is post-v1.
- **Continuous readiness / scheduled reassessments** — Phase 8.
- **`executor.migration@1.0.0` profile** — Phase 8.
- **Relay administration UI** — CLI-only admin in v1 (`vac-relay revoke <device>`, `vac-relay list`). Web admin is post-v1.
- **Paid / managed hosted relay** — self-host first; the repo ships the relay as runnable code. Managed offering is a separate business decision.

## Cross-cutting concerns

### Security model
Per `docs/architecture.md §8`:
- Relay is **blind** — it routes frames by header-level metadata (`device_id`, `session_id`, `seq`). Payloads are opaque bytes.
- Auth: every frame carries a `TeleportToken` (short-lived, rotating) bound to `{device_id, session_id, nonce}`; relay verifies before forwarding.
- Rate limit: per-device max 32 concurrent connections, max 10 frames/sec sustained, max 100 frames/sec burst. Tokens expire after 60s of idle.
- E2E mode (opt-in): bridge and browser exchange X25519 pubkeys at pair time; symmetric key derived; all payloads sealed with XChaCha20-Poly1305. Relay never sees plaintext regardless of ops-team posture.
- **Revocation is authoritative from bridge-side**. `vac-bridge revoke <device_id>` pushes a revocation token that the relay honors within 5s (cached revocation list with TTL). Browser sees a `session.revoked` event and hard-disconnects.

### Frame replay on reconnect
Spec: `docs/protocol.md §7`. Bridge + relay both track the last-forwarded `seq` per session. On reconnect, browser sends `Resume { session_id, last_event_id }`; relay forwards to bridge which replays from its EventRing (Phase 1.4). Gap detection: if `seq` jumps, browser requests a full resync rather than silently losing state.

### Transport shape
The WebSocket envelope shipped in Phases 1–6 is **unchanged**. Phase 7 is purely a transport swap: instead of `ws://localhost:4242/api/sessions/stream`, it's `wss://relay.example.com/device/<device_id>/session/<session_id>`. All existing domain handlers (`assessment.*`, `handoff.*`, `release.*`, etc.) work as-is on the other side.

### Bridge dial-out pattern
```
vac-bridge tunnel --relay wss://relay.example.com --device-id <id>
  │
  ├─ outbound WebSocket to relay
  ├─ registers with { device_id, version, capabilities }
  ├─ keeps connection alive (ping every 20s)
  └─ on drop: reconnect with exponential backoff, re-register, resume sessions
```
Bridge remains local-only in terms of filesystem access. Everything it does locally (profile enforcement, session management, tool dispatch) is unchanged.

### Web-side reconnect
The web `createTransport()` gains a relay-aware mode. On drop:
1. Reconnect to the same URL.
2. Send `Resume { session_id, last_event_id }` in the hello frame.
3. Wait for relay to confirm routing; then bridge emits replayed events.
4. If the replay cursor is past the bridge's ring-buffer tail (Phase 1.4 default 5000 events), request `session.snapshot` instead.

### Pairing UX
Desktop TUI runs `vac pair --relay wss://…` → mints a `TeleportToken` (5-min TTL, single-use) → renders QR ASCII + short code. Phone/laptop browser opens the relay URL, scans QR (or types the short code), exchanges token for a session auth, lands in the cockpit. Token is bound to the session so it can't be replayed elsewhere.

### Perf budgets (7.7 exit)
- Relay: 1000 concurrent devices on a single node at p99 ≤ 150ms forward latency (measured peer-to-peer).
- Bridge dial-out reconnect: ≤ 3s median on a 1Mbps link.
- Web reconnect + replay: ≤ 2s for ≤ 100 events of replay.
- E2E seal/open overhead: ≤ 2ms per frame at p95 (laptop-class CPU).
- Bundle post-Phase-7: ≤ 1.55MB gz (relay transport + QR renderer are small additions).

### Red-team expansion (cases 121–145)
- Relay replay of an old token — rejected by nonce.
- Relay attempts content inspection (malicious fork running the relay code) — E2E mode keeps payload opaque; plain mode exposes intent but not credentials (credentials never cross the relay).
- Bridge dial-out with expired token — rejected.
- Browser reconnect with last_event_id beyond ring — forced snapshot, no silent gap.
- Revocation propagation: revoked device sees `session.revoked` within 5s on a loaded relay.
- Rate-limit burst over threshold — throttled, audit-logged.
- Invalid E2E key exchange (wrong curve, malformed pubkey) — rejected pre-session.
- Session ID smuggling across devices — frame rejected at relay with `relay.bad_route`.
- QR token replayed from screenshot after TTL — rejected.
- Parallel pair attempts from two browsers — only one claims.

Target: **≥ 145 red-team cases green by 7.7 exit**.

### Test targets (Phase 7 exit)
- Workspace (Rust): ≥ 360 tests (bridge + relay-service).
- Red-team: ≥ 145.
- vitest (web): ≥ 200.
- Playwright E2E: ≥ 6 (existing 5 + remote-attach full loop).
- Integration: relay + bridge co-run in CI via a docker-compose harness, asserting end-to-end message delivery + reconnect.

## Phase 7 exit criteria (gate to Phase 8)

From 7.7:

- [ ] All 7.1–7.6 sub-phases hit their individual exit criteria.
- [ ] E2E demo: desktop TUI pairs, phone on a cellular network attaches via QR, browser receives the existing session's state (transcript + workbench), sends a message, sees the response. Filesystem access remains on the desktop.
- [ ] E2E keypair mode verified: relay-side packet capture shows ciphertext only for a session in that mode.
- [ ] Revocation: `vac-bridge revoke <device_id>` drops all that device's sessions within 5s, confirmed across multiple attached browsers.
- [ ] Relay perf: 1000 concurrent devices × 10 frames/sec sustained for 10 minutes, p99 ≤ 150ms.
- [ ] Reconnect replay: a browser dropping and reconnecting mid-assessment resumes cleanly, no event loss.
- [ ] Red-team matrix 1–145 all green.
- [ ] Tests: 360+ workspace / 200+ vitest / 145+ red-team / 6+ Playwright.
- [ ] Clippy `-D warnings` + fmt + TS strict + vite build all green, *including* relay crate.
- [ ] Root README + `docs/plans/phase-7/README.md` + each sub-phase README marked ✅.

## Rollback plan

Phase 7 is new infrastructure — more operational risk than UI risk.

- **7.1 upstream stalls**: PR #10 hold is the full-stop blocker. Do not ship a local `TeleportToken` that will drift from the upstream shape.
- **7.2 relay instability**: ship the relay behind a feature flag (`vac.relay.enabled`); the existing direct-WS path remains default. Hosted dispatch opt-in for early testers.
- **7.3 bridge dial-out flake**: log + retry with capped backoff. If reconnect storm risk on the relay, introduce jitter + per-device connection cap before shipping.
- **7.4 web client replay bug**: fall back to `session.snapshot` on any replay mismatch rather than attempting partial replay — better a full refresh than silent data loss.
- **7.5 QR scan unreliable on phone cameras**: keep the 8-char short code path as the primary UX; QR is an accelerant, not the only way in.
- **7.6 E2E encryption bugs**: ship plain mode as default; E2E is opt-in via `--e2e` flag. Users who need the guarantee can wait for a 7.6.1 hotfix; users who don't get the rest of Phase 7 value on schedule.
- **7.7 revocation latency blown**: document the actual SLO rather than claiming 5s; revocation still works, it's just slower.

If the relay's perf budget blows past 1000 concurrent on a single node: horizontal fan-out via sticky-session load balancer (device_id-based consistent hash). Landing that in Phase 7 is a stretch; documenting the architecture so it's possible is not.

## Execution policy

- 7.1 is a hard upstream dependency. Hold if not merged; do not scaffold.
- 7.2 / 7.3 are the largest sub-phases — treat each as one focused block. No parallel work within a single session.
- After each sub-phase: full test matrix (relay crate, bridge, web) clean. Integration harness (relay + bridge docker-compose) runs on every PR once 7.3 lands.
- Red-team cases (121–145) land *with* the feature that introduces them — revocation cases with 7.7, E2E cases with 7.6, etc. Don't punt all to 7.7.
- Audit cycle after 7.7, matching the Phase 1–6 pattern, with an extra security-architect lens (this is the first phase that publicly exposes infra).
- Budget contingency: if Phase 7 exceeds 18 days by > 30%, trim in this order: (a) defer E2E keypair mode (7.6) to a 7.8-hotfix — plain mode already meaningfully improves access, (b) ship the web client without multi-session list (single-session only), (c) defer revocation UI-side to a CLI-only flow.

## Related

- [`docs/roadmap.md §Phase 7`](../../roadmap.md)
- [`docs/architecture.md §8`](../../architecture.md) — trust model + relay-as-blind-router invariant.
- [`docs/protocol.md §7`](../../protocol.md) — frame replay + reconnect semantics.
- [`docs/upstream-vac-prs.md`](../../upstream-vac-prs.md) — PR #10 scope (`TeleportToken`).
- [`docs/capability-profiles.md`](../../capability-profiles.md) — profiles unchanged by relay; reaffirm that enforcement is bridge-side.
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) — cases 121–145.
- [`docs/perf-test-plan.md`](../../perf-test-plan.md) — bench specs for 7.7.
- Parent plan: [`phase-6-8/38-hosted-dispatch.md`](../phase-6-8/38-hosted-dispatch.md).
