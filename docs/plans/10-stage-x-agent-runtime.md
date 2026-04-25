# Stage X — Agent Runtime Picker

**Goal.** Make VAC Web agent-runtime-agnostic: the bridge can spawn `mock`, `vac-native`, or `acp` (Claude Code, OpenCode, Codex) drivers behind one stable browser protocol, while profile enforcement, approval, and audit remain bridge-owned.

**Design lock.** [`../agent-runtime.md`](../agent-runtime.md) (commit `cd1ff13`). All decisions there are authoritative; this plan only describes execution.

**Depends on.** Phase 0–8 baseline (see [`00-shipped.md`](./00-shipped.md)). No upstream `vastar-agentic-cli` change required for X.1–X.3; X.4 needs the additive `agent_id` field landed on `session.create`.

**Out of scope.** VIL/VWFD semantics (Stage K). Production deploy/publish via ACP (release plan keeps that VAC-native initially).

---

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

Wire ACP modal-halt permission requests to the existing async approval queue. 5-minute default timeout. Audit every decision.

**Exit.** Red-team cases 125–128 pass: ACP write requests block until VAC approval; timeout cancels cleanly; audit row carries `agent_id` + `agent_kind`.

## X.6 — Claude Code real handshake

Spawn the actual Claude Code binary via its `--acp` (or current) flag, verify the handshake, drop the **PROVISIONAL** marker from `agent-runtime.md` once confirmed against a real binary.

**Exit.** A scripted test session drives Claude Code through `executor.code@1.0.0` end-to-end and lands a patch via the approval bridge.

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
