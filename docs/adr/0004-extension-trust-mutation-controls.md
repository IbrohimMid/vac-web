# ADR 0004 — Extension trust mutation controls: session-bound admin gate + two-party promotion approval

- **Status:** Accepted
- **Date:** 2026-05-07
- **Owners:** bridge, security
- **Related slice(s):** wiring.post-r1-r6-followups-2026-05-07 (Round 2 audit follow-ups, Slice #4 + Slice #6)

## Context

[ADR-0003](0003-extension-trust-model.md) introduced the four-tier trust model and the runtime handler `extensions.update_trust`. Phase 3 of that work shipped a process-wide admin token gate so any operator with the static token (or its hash) could mutate the live trust posture in a single command.

A Round 2 audit (2026-05-07) on the trust handler surfaced two control gaps:

1. **Process-wide admin authority is too broad.** A single leaked token grants unconditional, time-unbounded write access to `config/extension-trust.yaml` from anywhere on the host. The token does not bind to a specific WS session, device, or operator; the audit trail records the action but cannot attribute intent.
2. **No second-operator review for high-risk transitions.** Promoting an extension to `verified` (or relaxing `allow_unsigned`) is a one-shot mutation. There is no built-in `request → review → approve` flow, so a compromised admin can silently widen the trust surface without any peer challenge.

These gaps were addressed in commits `d1cd672` (Slice #4) and `1b886c8` (Slice #6) on top of the audit-hardened handler from `7fc29a2`. This ADR records the resulting decision so subsequent operators do not re-derive the rationale from commit logs.

## Decision

Mutations to the runtime trust posture are gated by **two layered controls**, both enforced in the bridge (Rust authority) before any catalog write:

1. **Session-bound admin gate** (`apps/local-bridge/src/extensions/admin_gate.rs`, integrated through `profile_layer::enforce_action`). The admin token still authorises the operator, but authorisation is now scoped to the WS session that presented it. A token presented in session `S1` cannot be replayed by session `S2`. The bridge records the binding (`session_id`, `device_id`, `granted_at`) on the session state and clears it on disconnect or token rotation.
2. **Two-party promotion approval** (`apps/local-bridge/src/extensions/approvals.rs`, command family `extensions.request_promotion` / `extensions.approve_promotion` / `extensions.list_approvals`). Trust transitions classified as *promotions* (any move toward `verified` or any `allow_unsigned: true` flip) cannot be applied via `extensions.update_trust` directly. They must:
   - be **requested** by operator *A* (recorded with the requester’s session-bound admin claim, the proposed trust delta, and a free-text justification);
   - be **approved** by a distinct operator *B* whose session-bound admin claim is verified to be different from operator *A*’s by `device_id` and `session_id`;
   - only then take effect, persisted atomically alongside the file-lock guard from Slice #1 (TOCTOU fix).

Demotions and lateral moves (e.g. `verified → community`, revoking an explicit pin) remain single-operator actions under the session-bound gate; they shrink the trust surface and the audit cost of widening it later is acceptable.

All three decision points (gate denial, promotion request, promotion approve) emit structured audit events under the `extensions.` namespace via the migrated `log_structured` writer (Slice #3). The audit catalog is the system-of-record for who attempted what; YAML state is the system-of-record for the resulting posture.

## Alternatives considered

- **Time-boxed admin tokens (no session binding).** Rejected: a TTL of any practical length still lets a leaked token be replayed from any host inside the window, and shrinking the TTL hurts legitimate operator UX without closing the leak vector.
- **Quorum > 2 (M-of-N approval).** Rejected for now: the operator population we target is small (typically 2–3 admins per workspace), and an M-of-N flow introduces voting state and tie-break rules with no clear demand. The approval store schema (`approvals.rs`) leaves room to extend if a customer needs it later.
- **Move approvals to web-only (gate in TS).** Rejected: trust enforcement must live in the bridge (Rust authority) per ADR-0003 §Decision; the web app is allowed to *render* the queue but cannot *decide* the outcome.
- **Out-of-band approval (Slack / email link).** Rejected: violates the local-first constraint from `docs/plans/wiring/00-index.md` and shifts the trust boundary outside the bridge.

## Consequences

- **Positive**
  - Token leak alone is no longer sufficient to widen the trust surface; the attacker also needs an active WS session on the host *and* a co-conspirator session to approve a promotion.
  - Audit records now attribute every mutation attempt to a specific session, enabling post-incident attribution that ADR-0003 alone could not.
  - Demotions stay one-shot, so an operator responding to an incident can still revoke trust quickly without coordinating a second approver.
- **Negative**
  - First-time setup with a single admin requires either a second device pairing or a temporary `allow_unsigned` operator policy override. We document this in the trust-model design doc.
  - The approval queue becomes operator-visible UX state that must be cleared at restart or persisted explicitly. Current implementation is **in-memory** and clears on bridge restart; this is intentional because pending promotions should be re-requested with current context after a restart.
- **Migrations required**
  - `extensions.update_trust` callers that previously mutated promotions directly must switch to the request/approve flow. The handler now refuses promotion-shaped deltas with `extensions.update_trust.requires_approval`.
  - Operators upgrading from a pre-Slice-#4 build must re-pair sessions; old static admin tokens stop working as soon as the binding metadata is missing.

## Migration plan

1. Bridge ships the new gate + approval store behind the existing `extensions.*` command family; no schema break.
2. Web cockpit exposes the approval queue (Settings → Extensions → Pending Approvals). Tracked separately by the UI follow-up in `wiring.post-r1-r6-followups-2026-05-07`.
3. Operators document the new flow in their internal runbooks. The bridge logs a one-time `extensions.trust.controls_v2_active` notice on first promotion attempt under the new gate.
4. Validation gates that must stay green: `cargo test --workspace`, the four catalog drift scripts, and `node scripts/check-slo-measurements.mjs` (Slice #5 perf telemetry must keep flowing through `perf.latest_run` / `perf.run_completed`).

## Required scope

This ADR is required because the change crosses two of the criteria in `0000-template.md` §Required scope:

- Security boundary change (auth + profile policy on the trust mutation path).
- New (or visibly extended) command family in `config/control-plane/command-manifest.yaml`: `extensions.request_promotion`, `extensions.approve_promotion`, `extensions.list_approvals`.

## References

- [ADR-0003](0003-extension-trust-model.md) — baseline trust model this decision layers onto.
- `apps/local-bridge/src/extensions/admin_gate.rs` — session-bound admin gate (Slice #4).
- `apps/local-bridge/src/extensions/approvals.rs` — two-party approval store (Slice #6).
- `apps/local-bridge/src/extensions/handlers.rs` — updated handler that routes promotion-shaped updates through the approval flow.
- `apps/local-bridge/src/extensions/store.rs` — file-lock guard from Slice #1 (TOCTOU).
- `apps/local-bridge/src/observability.rs` — `extensions.` namespace allowlist for the structured audit migration (Slice #3).
- `docs/extension-trust-model.md` — design doc (§9 Runtime API now reflects the v2 controls).
- `docs/red-team-test-plan.md` §3.13 — adversarial coverage for the trust handler, extended for the v2 controls.
