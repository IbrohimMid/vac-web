# Architecture

**Status**: v1 (locked for Phase 0.5)
**Audience**: engineers implementing bridge, web app, or VAC upstream changes.

---

## 1. System diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser (apps/web)                                                │
│  React + Vite SPA                                                  │
│  Stores (Zustand/domain), TanStack Query, TanStack Virtual         │
│  Web Workers: shiki, markdown, diff                                │
│  Single WebSocket per tab (multiplex sessions via sessionId)       │
└───────────────────────┬────────────────────────────────────────────┘
                        │ WSS (local: ws://127.0.0.1)
                        ▼
┌────────────────────────────────────────────────────────────────────┐
│  local-bridge daemon (apps/local-bridge)                           │
│  Rust + axum + tokio                                               │
│  ─ WS server + REST endpoints                                      │
│  ─ Pairing + JWT short-lived auth                                  │
│  ─ Per-session Profile enforcement (Layer 1)                       │
│  ─ Translator: InputEvent/OutputEvent ↔ protocol v1 semantic       │
│  ─ Connector adapters (read-only default)                          │
│  ─ Assessment run manager                                          │
│  ─ Handoff packet lifecycle + pin verification                     │
│  ─ Gate evaluation                                                 │
│  ─ Audit log writer                                                │
│  ─ Embedded SPA static (rust-embed)                                │
└───────────────────────┬────────────────────────────────────────────┘
                        │ stdio JSON-RPC 2.0 (one child per session)
                        ▼
┌────────────────────────────────────────────────────────────────────┐
│  vac serve --stdio --profile <id@version>                          │
│  VAC engine with Policy Profile (Layer 2)                          │
│  ─ Tool registry filtered by profile at startup                    │
│  ─ Side-effect tagging on every tool                               │
│  ─ Existing: VIL, MCP, approvals, sessions, snapshots              │
└───────────────────────┬────────────────────────────────────────────┘
                        │
                        ▼
             Filesystem · Tools · Shell (allowlisted) · MCP · External APIs
```

---

## 2. Process model

- **One `local-bridge` process per user.** Owns audit log, JWT store, connector tokens.
- **One `vac serve` child per session.** Bridge spawns; kills on session close, timeout, or resource limit breach.
- **One browser WebSocket per tab.** Multiplex N active sessions over it; bridge enforces per-session event budget.

Session is the atomic unit. A session has: `session_id`, pinned `profile_id@version`, `project_root`, spawn time, client subscribers, audit stream.

---

## 3. Transport layers

| Hop | Transport | Format | Why |
|---|---|---|---|
| Browser ↔ bridge | WebSocket (local) or WSS via user tunnel | Protocol v1 envelopes (JSON; binary frames for shell PTY) | bidirectional, resumable via `last_event_id` |
| Bridge ↔ engine child | stdio | JSON-RPC 2.0 line-delimited | proven (MCP pattern), simple, no port |
| Bridge ↔ connectors | HTTPS | connector-specific (REST / GraphQL) | as-is |
| Bridge ↔ OS | syscalls + PTY | native | shell drawer, fs reads |

### Envelope examples

Command (client → bridge):
```json
{"id":"cmd_01J…","sessionId":"sess_…","type":"message.submit","payload":{...},"v":1}
```

Event (bridge → client):
```json
{"seq":4821,"sessionId":"sess_…","type":"transcript.delta","payload":{...},"v":1}
```

Ack (bridge → client, optional):
```json
{"ackOf":"cmd_01J…","ok":true}
```

See `protocol.md` for full catalog.

---

## 4. Data stores

| Store | Location | Contents |
|---|---|---|
| Audit log | `~/.config/vac-web/audit/<session_id>.jsonl` | Every tool decision, profile enforcement events |
| JWT / pairing state | `~/.config/vac-web/bridge.toml` | Device tokens, allowlisted project roots |
| Connector tokens | `~/.config/vac-web/connectors/<id>.enc` | Encrypted OAuth tokens (OS keyring where possible) |
| Assessment runs | `~/.local/share/vac-web/runs/<run_id>.json` | AssessmentRun + findings |
| Handoff packets | `~/.local/share/vac-web/handoffs/<handoff_id>.json` | HandoffPacket with pin |
| Gate states | `~/.local/share/vac-web/gates/<project_hash>.json` | Current gate evaluation + override history |
| Session snapshots | VAC's existing `.vac/sessions/` in project | Reused as-is via VAC engine |
| Evidence cache | `~/.cache/vac-web/evidence/` | Screenshots, fetched connector payloads (hash-keyed) |

All files world-readable by owner only (`0700` dirs, `0600` files).

---

## 5. Core components

### 5.1 Bridge modules

```
apps/local-bridge/src/
├── main.rs
├── server.rs                # axum router, WS upgrade
├── session.rs               # session lifecycle, child process management
├── profile.rs               # CapabilityProfile load + enforcement (Layer 1)
├── translator.rs            # VAC events ↔ protocol v1
├── overlay_state.rs         # modal stack mirror for multi-client sync
├── system_pulse.rs          # SystemFacet aggregator
├── notify.rs                # NotifyRouter — lane routing
├── auth.rs                  # pairing, JWT, project allowlist
├── pty.rs                   # shell drawer PTY
├── audit.rs                 # append-only audit writer
├── assessment/
│   ├── run.rs               # AssessmentRun manager
│   ├── finding.rs           # emit + dedupe by identity hash
│   ├── diff.rs              # AssessmentDiff compute
│   └── evidence.rs          # EvidenceRef capture + freshness
├── handoff/
│   ├── packet.rs            # HandoffPacket lifecycle
│   ├── pin.rs               # pin snapshot + verify
│   └── dispatch.rs          # spawn executor session
├── gate/
│   ├── evaluate.rs
│   ├── policy.rs            # override governance
│   └── signoff.rs
├── connectors/
│   ├── mod.rs               # Connector trait
│   ├── github.rs
│   ├── notion.rs
│   ├── sentry.rs
│   └── …
└── assets.rs                # embed SPA
```

### 5.2 Web app modules

See `frontend-rules.md §12`.

---

## 6. Session lifecycle

```
┌─────────┐   session.create     ┌─────────┐
│  Client │ ───────────────────► │ Bridge  │
└─────────┘                      └────┬────┘
     ▲                                │ validate profile_id@version
     │                                │ if executor: validate handoff
     │                                │ spawn: vac serve --stdio --profile …
     │                                ▼
     │                           ┌─────────┐
     │                           │ Engine  │
     │                           │ child   │
     │                           └────┬────┘
     │                                │ handshake: profile hash match?
     │    session.ready                │
     │ ◄──────────────────────────────┘
     │
     │    message.submit / …
     │ ──────────────► bridge enforces profile
     │                 bridge forwards → engine
     │
     │    transcript.delta / tool_call / …
     │ ◄──────────────
```

On close: bridge sends graceful shutdown via stdin RPC, kills child after 5s, flushes audit log, releases `session_id`.

---

## 7. Profile enforcement (two layers)

Detailed in `capability-profiles.md §6`. Summary:

- **Layer 1 (bridge)**: inspects every command + every engine-emitted tool-call envelope. Denies on `tool_allow/deny`, `shell_allowlist`, `fs` scope, `git` scope, `network_egress`, `connectors`.
- **Layer 2 (engine)**: at startup, unregisters tools outside profile. At tool invoke, re-checks. Handshakes profile hash with bridge.

Both MUST deny. Either layer's failure is a security bug.

---

## 8. Multi-client attach

Single session, N browsers/devices connected.

- Bridge maintains `subscribers: HashMap<SessionId, Vec<ClientHandle>>`.
- Outgoing events broadcast to all subscribers; each subscriber has own `seq` tracker.
- Incoming commands serialized via per-session writer mutex — no race on state mutation.
- Approval decisions: first decision wins; losing clients get `approval.resolved { by_client_id }` event with optimistic-UI rollback hint.
- Snapshot sync on attach: new client gets `session.snapshot` with full current state.

---

## 9. Reconnection & replay

- Each session keeps a ring buffer of the last N events (default 5000 per session, memory-capped).
- Client disconnect: bridge retains session state for 60s grace; further disconnect → session pauses (child still running) but marked idle.
- Client reconnect: sends `last_event_id`; bridge replays from ring. If `last_event_id` older than ring's oldest → send `session.snapshot` resync.
- Heartbeat: ping every 20s; 40s timeout → subscriber drop.

---

## 10. Remote access (v1 vs v2)

### v1 — user-managed tunnel
- Bridge binds `127.0.0.1:<port>` only.
- User runs `cloudflared tunnel`, `tailscale serve`, or `ngrok` themselves.
- Browser hits tunnel endpoint.
- Documented patterns: Tailscale (recommended for privacy), Cloudflare Tunnel (recommended for public share).

### v2 — hosted dispatch (Phase 7)
- Bridge dials **outbound** to a relay (pattern: Claude Code Remote Control).
- No inbound port ever opened on user's machine.
- Browser connects to relay domain; relay routes by `device_id + session_id`.
- Relay is stateless routing; does not decrypt tool output (opt-in E2E via keypair).
- Reuses VAC's existing `TeleportToken` + `RemoteSessionConfig` primitives.

---

## 11. Security boundaries

| Surface | Threat | Control |
|---|---|---|
| Browser → bridge WS | CSRF, arbitrary origin | WSS origin pin; JWT in first frame; project allowlist |
| Bridge → engine | Bridge compromised → malicious prompts | Engine Layer 2 policy; profile hash pinning |
| Engine → tool call | Prompt injection → destructive tool | Bridge Layer 1 + Engine Layer 2 re-check |
| Engine → shell | Shell escape | `shell.exec_allowlisted` with array args + regex pattern; no `bash -c` |
| Connector adapter | Token exfil | Tokens in OS keyring; egress allowlist; logs redact args by default |
| Multi-client approval | Duplicate / racing decisions | Per-session writer mutex; first-decision-wins |
| Handoff dispatch | Bypass approval | `session.create executor` rejects sans approved handoff |
| Gate override | Rubber-stamp risk | Role-restricted, time-bound, two-party for prod gates |

See `capability-profiles.md` + `red-team-test-plan.md`.

---

## 12. Versioning

- **Protocol**: `v1`, frozen after Phase 5. Future versions coexist via `v` field + handshake negotiation.
- **Profiles**: semver per profile id. Old profiles remain valid for in-flight sessions.
- **Schemas**: JSON Schema files in `packages/protocol/v1/`, hash-checked at bridge startup.
- **VAC engine**: `vac --version` must satisfy `>=X.Y.Z` declared in bridge manifest; mismatch → refuse to start.

---

## 13. Build & distribution

- **Monorepo**: Cargo workspace + pnpm workspace.
- **SPA built first** (`pnpm build`), output copied to `apps/local-bridge/assets/`.
- **Bridge embeds SPA** via `rust-embed`.
- **Single binary** output: `vac-bridge`. Install via `cargo install --path apps/local-bridge` or downloaded release.
- **No Node.js runtime required on user machine.** SPA served from binary.

---

## 14. Observability

- Bridge structured logs to stderr (JSON), level via `VAC_WEB_LOG=info|debug|trace`.
- Audit log to `~/.config/vac-web/audit/` (per §4).
- Session performance metrics (event latencies, tool-call durations) surfaced in `Sessions → <session> → Performance`.
- Optional: Prometheus endpoint `/metrics` behind auth for power users (`--metrics` flag, off default).

---

## 15. Related documents

- [`product-prd.md`](./product-prd.md)
- [`protocol.md`](./protocol.md)
- [`capability-profiles.md`](./capability-profiles.md)
- [`frontend-rules.md`](./frontend-rules.md)
- [`upstream-vac-prs.md`](./upstream-vac-prs.md)
