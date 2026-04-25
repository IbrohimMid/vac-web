# Stage X — Agent Runtime Picker

**Goal.** Make VAC Web agent-runtime-agnostic: the bridge can spawn `mock`, `vac-native`, or `acp` (Claude Code, OpenCode, Codex) drivers behind one stable browser protocol, while profile enforcement, approval, and audit remain bridge-owned.

**Design lock.** [`../agent-runtime.md`](../agent-runtime.md) (commit `cd1ff13`). All decisions there are authoritative; this plan only describes execution.

**Depends on.** Phase 0–8 baseline (see [`00-shipped.md`](./00-shipped.md)). No upstream `vastar-agentic-cli` change required for X.1–X.3; X.4 lands the additive `agent_id` field on `session.create`, and later stages (X.5–X.8) depend on it.

**Out of scope.** VIL/VWFD semantics (Stage K). Production deploy/publish via ACP (release plan keeps that VAC-native initially).

---

## Substage map (post 2026-04-26 retarget)

| Stage | One-line | Status |
| ----- | -------- | ------ |
| X.1 | AgentRuntime registry + config | shipped (`d136b8a` baseline) |
| X.2 | profile.allowed_agent_kinds | shipped |
| X.3 | ACP scaffold + line-processor dispatch (mock-acp wire) | shipped |
| X.4 | additive `agent_id` on session.create | shipped |
| **X.5a** | **Official ACP client transport (Rust port or Node sidecar)** | next |
| **X.5b** | **Spawn `@agentclientprotocol/claude-agent-acp` provider** | next |
| **X.5c** | **Map `SessionUpdate` + `requestPermission` to VAC events** | next |
| X.6 | Drop PROVISIONAL marker after X.5b verifies | doc-only after X.5b |
| X.7 | ACP read-only assessment-worker mode | queued |
| X.8 | Web runtime picker UI | queued |

## X.1 — AgentRuntime registry + config refactor

Introduce `AgentRuntime` registry in the bridge with three driver kinds. Move all current spawn paths (mock, native VAC) behind the registry. No protocol change yet — `agent_id` is inferred from project config.

**Exit.** Existing sessions still work end-to-end against mock + native; bridge logs name the driver kind for each session.

## X.2 — Profile `allowed_agent_kinds`

Add the field to the profile schema + catalog. Enforce at session-create: deny if requested driver kind isn't in the profile's allowlist.

Compatibility matrix (locked in design doc):

- `assessor.*` + `acp` → denied (initially; X.7 reopens read-only).
- `executor.code` + `acp` → allowed.
- `executor.release` + `acp` → denied.
- `executor.migration` + `acp` → denied.

**Exit.** Red-team cases 121–124 from the design doc pass; profile schema codegen regenerated.

## X.3 — ACP driver skeleton

Spawn an ACP-compatible CLI as a child process and proxy stdio. No tool/permission bridge yet — text-only assistant streaming.

**Exit.** A mock ACP child can stream `transcript.delta` to web; `agent_id=mock-acp` selectable in dev.

## X.4 — `agent_id` on `session.create` (additive)

Add the optional field to the v1 protocol. Bridge resolves driver from `agent_id` → registry; falls back to project default.

**Exit.** Web can request a specific runtime; protocol tests cover both old (no field) and new payloads.

## X.5 — Permission / approval bridge

> **2026-04-26 retarget.** The verification pass in
> [`stage-x-claude-acp-verification.md`](./stage-x-claude-acp-verification.md)
> showed that the Agent Client Protocol exists as a documented
> standard with a TypeScript SDK (`@agentclientprotocol/sdk`) and a
> packaged Claude Agent (`@zed-industries/claude-code-acp`, renaming
> to `@agentclientprotocol/claude-agent-acp`). The original X.3 mock
> wire was a useful scaffold but **is not ACP**. X.5 is therefore
> split into three substages so the official-ACP transport lands
> before the permission bridge is wired.

Wire ACP modal-halt permission requests to the existing async approval queue. 5-minute default timeout. Audit every decision.

### X.5a — Official ACP client transport

Replace (or alias) the `AgentKind::Acp` driver path so the bridge
speaks the real protocol on the wire: JSON-RPC 2.0 over ndjson stdio,
matching `@agentclientprotocol/sdk` v0.14.x. Two viable shapes:

1. **Rust-native ACP client** inside `local-bridge` — port the SDK's
   `AgentSideConnection` shape (typed methods + framed stream).
2. **Node sidecar** — small daemon shipped alongside the bridge that
   imports the official SDK and exposes a stable IPC to local-bridge.

The decision is taken at X.5a kick-off based on whether the Rust
re-implementation cost is cheaper than the cross-process complexity of
a sidecar. Either shape MUST preserve the bridge's existing
`AgentDriver` boundary (X.1) and the `agent_kind = acp` enforcement
(X.2). `mock-acp` is upgraded later (or replaced by an in-process fake
that speaks real ACP) so X.3 tests still anchor the contract.

**Exit.** A unit-level integration test issues `initialize` →
`newSession` → `prompt` against an in-process ACP fake using the
official SDK shape and observes the response on the bridge side.

### X.5b — Spawn `claude-code-acp` provider

Add an entry to the `agents.toml` example pointing the `acp` runtime
at `claude-code-acp` (or successor name). Bridge resolves and spawns
the binary using the Stage X.1 registry. All existing `--profile /
--session-id / --project` arg conventions are dropped on this path —
the ACP client tells the agent its working directory through
`NewSessionRequest.cwd`, not CLI args.

The bridge:

- runs `initialize` once at agent startup, caches `agentCapabilities`,
- opens one ACP session per VAC `session.create`,
- forwards browser `message.submit` to ACP `prompt`,
- forwards browser `message.cancel_stream` to ACP `cancel`.

**Exit.** A scripted Build session under `executor.code@1.0.0` +
`agent_id="claude"` + `agent_kind="acp"` reaches the live
`claude-code-acp` binary, sends one prompt, and receives at least one
`agent_message_chunk` SessionUpdate.

### X.5c — SessionUpdate / RequestPermission mapping

Translate the eleven ACP `SessionUpdate` variants and the
`requestPermission` / file / terminal RPCs into existing VAC events.
No new browser-facing protocol commands; the mapping table lives in
[`stage-x-claude-acp-verification.md` §12.3](./stage-x-claude-acp-verification.md):

- `agent_message_chunk` / `agent_thought_chunk` → `transcript.delta`
  (the latter carries an optional `kind="thought"`).
- `tool_call` / `tool_call_update` → drive `review.changeset_updated`
  for fs writes, `runtime.job_log` for shell/terminal.
- `plan` → `plan.updated`.
- `usage_update` → existing agents-lane token-usage telemetry, when
  present (no fakes — see Build red-team B12).
- `requestPermission` → `approval.pending`; outcome resolves the ACP
  request with either `{ outcome: "selected", optionId }` (approve) or
  `{ outcome: "cancelled" }` (deny / timeout).
- `readTextFile` / `writeTextFile` → bridge serves these from the
  pinned project root, applies `profile_layer` enforcement, and
  surfaces every write through `review.changeset_updated`.
- terminal RPCs → spawned under `runtime.*`, output piped to
  `runtime.job_log`, kill on `runtime.cancel_job`.

**Exit.** Red-team cases 125–128 pass: ACP write requests block until
VAC approval; timeout cancels cleanly; audit row carries `agent_id` +
`agent_kind`. Plus: a Claude Code session via `claude-code-acp` lands
a real edit on a sample repo through the approval queue.

## X.6 — Claude Code real handshake

Drop the **PROVISIONAL** marker on the `--acp` route in
[`../agent-runtime.md`](../agent-runtime.md) once X.5b lands a working
session against the live binary.

**Status update (2026-04-26).** The Claude Code CLI itself
(`/usr/local/bin/claude` 2.1.111) does NOT expose an `--acp` flag —
the protocol surface lives in the separate `claude-code-acp` package
(see X.5b). The PROVISIONAL marker is removed once X.5b's exit gate
fires; X.6 itself becomes a doc patch + verification log.

**Exit.** Verification log appended to
[`stage-x-claude-acp-verification.md`](./stage-x-claude-acp-verification.md)
§10 with all six checkboxes ticked. Design doc updated. Stream-json
fallback stays demoted in §11.

## X.7 — ACP read-only assessment-worker mode

Allow `assessor.*` + `acp` under a strictly read-only profile slice. No file write, no shell mutation; structured candidate-finding output validated by bridge before becoming `AssessmentFinding`. See [`20-assess.md`](./20-assess.md) Stage A4 for the consumer side.

**Exit.** Claude can run a quick RTD sweep on a sample repo; invalid candidates rejected with audit reason.

## X.8 — Web runtime picker UI

Surface the runtime selector in Build session-create + Handoff dispatch + Run-assessment drawer. Lock `agent_id` for the lifetime of a session.

**Exit.** UI hides incompatible options based on profile; switching agent forces a new session (red-team case 129).

---

## Risks / open questions

- Claude `--acp` flag stability: the design doc marks it provisional. X.6 may slip until the upstream CLI surfaces a stable flag.
- Permission-bridge timeout policy: 5 min is a default; per-profile overrides may be needed once we see real workloads.
- Driver crash semantics: X.3 needs a clear story for partial-state cleanup (transcript marked errored, runtime jobs cancelled, approvals voided).
