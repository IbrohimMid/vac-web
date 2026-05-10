---
id: plans.active-plans-implementation-2026-05-10
title: 'Execution plan for all unfinished active plans'
priority: P0
area: cockpit-ux release-plane governance
status: closed
owners:
  - web
  - tools
created: 2026-05-10
depends_on:
  - plans/keyboard-nav-overlays-2026-05-10
  - plans/release-plane-backend-phase-6
---

# Execution plan for all unfinished active plans — 2026-05-10

## Purpose

This is the orchestration plan for all unfinished work currently tracked under `docs/plans/`.

Current unfinished plans:

1. [`keyboard-nav-overlays-2026-05-10.md`](./keyboard-nav-overlays-2026-05-10.md) — P1, 2-3h, cockpit UX accessibility depth.
2. [`release-plane-backend-phase-6.md`](./release-plane-backend-phase-6.md) — P1, 3-5d, real release executors.

This plan turns both drafts into one execution sequence, including the release-plane prerequisite that is implicit in the release plan: minimal gate governance backend support for sign-off / override persistence and audit.

## Closeout

Implemented in commit `4d28505`. This orchestration plan is now closed:

- keyboard nav overlays landed in the web cockpit
- minimal gate governance backend landed in the bridge
- release-plane backend Phase 6 landed as bridge-managed local release dispatch v1

The release-plane work intentionally remains local/bridge-managed rather than external connector/OAuth deployment.

## Current repo baseline

As of `main` after docs cleanup:

- All 50 numbered wiring slices are landed.
- Affordance closeout is landed: mutating NotWired buttons are disabled instead of fake-clickable.
- F4 strict perf gate is landed with `MIN_STRICT_WINDOW = 5` warmup guard.
- Active docs are intentionally narrow: only keyboard-nav and release-plane remain as implementation plans.
- There is a useful local stash: `stash@{0}: wip keyboard nav focus trap before handoff validation`. Treat it as optional seed work, not trusted landed code.

## UX goal

Move VAC Web from "safe but visibly incomplete" to "operable product surface":

- Keyboard users can complete critical cockpit overlay flows without mouse fallback.
- Release panel moves from disabled affordance copy to real deploy / publish / release-notes actions.
- Gate decisions become durable and auditable, so release actions no longer rely on transient frontend-only state.

## Execution order

```yaml
execution_plan: active-plans-implementation-2026-05-10
priority: P0
strategy: finish_small_ux_first_then_backend_depth
workstreams:
  - id: A_keyboard_nav
    source_plan: docs/plans/keyboard-nav-overlays-2026-05-10.md
    estimate: 0.5d
    can_run_before_backend: true
  - id: B_gate_governance_minimal
    source_plan: embedded_prerequisite_for_release_plane
    estimate: 1d
    can_run_before_release: true
  - id: C_release_plane_backend
    source_plan: docs/plans/release-plane-backend-phase-6.md
    estimate: 3-5d
    depends_on:
      - B_gate_governance_minimal
validation_policy:
  stop_on_failure: true
  gates:
    - pnpm -F web typecheck
    - pnpm -F web test -- --run
    - pnpm -F web build
    - pnpm -F web size
    - cargo test -p local-bridge
    - cargo test -p mock-engine
    - codegen drift check if command/event manifests change
```

Recommended commit shape:

1. `feat(web): add keyboard navigation support for cockpit overlays`
2. `feat(bridge): persist gate signoff and override decisions`
3. `feat(release): wire release backend executors`
4. `docs(plans): close active implementation plans`

## Workstream A — keyboard nav overlays

### Objective

Implement `keyboard-nav-overlays-2026-05-10.md` fully.

### Scope

- Create / finalize `apps/web/src/hooks/useFocusTrap.ts`.
- Add tests in `apps/web/src/hooks/useFocusTrap.test.ts`.
- Apply focus trap, auto-focus, focus restoration, dialog roles, and keyboard-submit patterns to:
  - `apps/web/src/components/Gates/GateDetail.tsx`
  - `apps/web/src/components/Release/ReleasePanel.tsx`
  - `apps/web/src/components/Settings/Extensions/QuarantineConfirmModal.tsx`
  - `apps/web/src/components/Settings/Extensions/PromotionRequestModal.tsx`
  - `apps/web/src/components/Approvals/ApprovalsTab.tsx`
  - `apps/web/src/components/Handoff/` packet builder / approval dialog surfaces
- Add keyboard-safe tooltip or focus-visible disabled copy for affordance-disabled buttons.

### Implementation notes

Use the existing stash only as reference:

```txt
stash@{0}: wip keyboard nav focus trap before handoff validation
```

Before applying it:

1. Inspect stash diff.
2. Apply only clean pieces.
3. Keep `useFocusTrap.test.ts` free from unused imports.
4. Do not merge partial overlay changes without tests.

### Acceptance

- Tab / Shift+Tab cycles inside the active overlay.
- Esc closes topmost overlay and restores focus to the trigger.
- Enter submits low-risk primary forms.
- Cmd/Ctrl+Enter is required for risky actions like override, approve, deploy.
- Every target overlay has `role="dialog"`, `aria-modal="true"`, and usable label wiring.
- Disabled NotWired affordance copy is reachable by keyboard focus, not only mouse hover.
- Web gates pass:
  - `pnpm -F web typecheck`
  - `pnpm -F web test -- --run`
  - `pnpm -F web build`
  - `pnpm -F web size`

### UX impact

This closes the most visible accessibility gap first. Users who rely on keyboard navigation stop getting trapped in inconsistent overlay behavior, and power users can operate release/gate/approval screens faster with predictable shortcuts.

## Workstream B — gate governance minimal backend

### Objective

Unblock release-plane backend by making gate sign-off and override decisions durable enough for release enforcement.

This workstream is intentionally minimal: it does not expand the full gates product surface beyond what release deploy/publish needs.

### Scope

- Add or locate bridge-side gate module under `apps/local-bridge/src/gates/`.
- Implement command handlers for:
  - `gate.signoff`
  - `gate.override`
- Persist gate decisions in session-scoped state using the existing session persistence pattern.
- Emit audit records for accepted and denied gate decisions.
- Enforce two-party signoff for production gates where required by `docs/gates.md`.
- Return stable errors for:
  - missing reason
  - expired override
  - insufficient signers
  - capability/profile denied
  - unknown gate id
- Flip manifest status from `not_wired` to `implemented` only after tests pass.
- Regenerate command catalog outputs if manifest changes.

### Non-goals

- Full gate editor UI.
- Cross-session organization-wide approval store.
- Calendar-based expiry UI.
- Policy authoring screen.

### Critical files

- `config/control-plane/command-manifest.yaml`
- `apps/local-bridge/src/translator/mod.rs`
- `apps/local-bridge/src/gates/` (new or expanded)
- `apps/local-bridge/src/session/persistence/`
- `apps/local-bridge/src/audit/` or existing observability audit path
- `apps/web/src/domain/capabilities/affordanceCatalog.ts`
- `apps/web/src/components/Gates/GateDetail.tsx`
- generated command catalog files

### Acceptance

- `gate.signoff` persists a signer and emits an audit record.
- `gate.override` requires reason + expiry and emits an audit record.
- Gate state survives session persistence reload where the existing persistence model supports it.
- Assessor/non-executor profile cannot mutate gates.
- GateDetail buttons auto-enable from the affordance catalog after manifest flip.
- Rust tests cover success and denial paths.
- Web tests cover enabled/disabled affordance states.

### UX impact

Gate UI becomes trustworthy: when users sign off or override, state persists and release actions can rely on it. This removes the last class of "looked successful but disappeared after reload" governance behavior.

## Workstream C — release plane backend Phase 6

### Objective

Implement `release-plane-backend-phase-6.md` after Workstream B gives it durable gate enforcement.

### Scope

- Add capability profile `executor.release`.
- Implement bridge release module:
  - `apps/local-bridge/src/release/mod.rs`
  - `handlers.rs`
  - `targets.rs`
  - `deploy.rs`
  - `publish.rs`
  - `notes.rs`
- Implement commands:
  - `release.deploy`
  - `release.publish`
  - `release.generate_notes`
  - optionally `release.list_targets` if target config discovery is required for manual smoke
- Replace mock-only release event production for real dispatch path:
  - `release.deploy_progress`
  - `release.post_deploy_observation` where v1 can produce local observations
- Persist release state per session.
- Append audit records:
  - `release.deploy_dispatched`
  - `release.publish_dispatched`
  - `release.notes_generated`
- Gate checks:
  - `release.deploy` requires `ReadyToDeploy` pass or valid override.
  - `release.publish` requires `ReadyToPublish` pass and production signoff rules.
- Keep mock mode available for tests/dev via explicit mode flag, not silent fallback.
- Flip manifest statuses only after backend tests pass.
- Regenerate command and event catalogs.
- Update web tests to assert buttons enable when command status becomes implemented.

### Non-goals

- App Store / Play Store OAuth connectors.
- Cloud-hosted release executor.
- Runbook editor.
- Multi-target parallel deploy.
- Full rollback automation.

### Critical files

- `config/capability-profiles/executor.release.yaml`
- `config/control-plane/command-manifest.yaml`
- `config/control-plane/event-catalog.yaml`
- `apps/local-bridge/src/release/`
- `apps/local-bridge/src/translator/mod.rs`
- `apps/local-bridge/src/session/persistence/`
- `apps/local-bridge/src/command_catalog.rs`
- `apps/web/src/generated/commandCatalog.ts`
- `apps/web/src/components/Release/TargetCard.test.tsx`
- `apps/local-bridge/tests/red_team/release_plane.rs`

### Acceptance

- Release deploy dispatches only when `ReadyToDeploy` is satisfied.
- Release publish dispatches only when `ReadyToPublish` is satisfied.
- Release notes generation produces markdown consumed by `NotesDraftView`.
- Deploy progress events stream to existing `useRelease` store without UI rewrite.
- Assessor profile receives capability denial for release mutations.
- Audit log includes deploy, publish, and notes records.
- Existing mock-engine scenarios still pass.
- Size limit unchanged or justified.

### UX impact

Release panel graduates from read-only cockpit visualization into an executable workflow. Users can see target readiness, trigger deploy/publish, and watch progress in one surface instead of mentally mapping disabled buttons to external scripts.

## Integration sequencing

### Day 0 — prep and guardrails

- Confirm clean working tree.
- Inspect `stash@{0}` for reusable keyboard-nav code.
- Run baseline:
  - `pnpm -F web typecheck`
  - `pnpm -F web test -- --run`
  - `pnpm -F web build`
  - `pnpm -F web size`
  - `cargo test -p local-bridge`

### Day 1 — Workstream A

- Land focus trap and overlay keyboard behavior.
- Commit after web validation passes.

### Day 2 — Workstream B

- Implement minimal gate governance backend.
- Add persistence + audit + profile denial tests.
- Flip gate command manifest entries only after green backend tests.
- Commit after cargo + web validation passes.

### Day 3-5 — Workstream C

- Implement release module skeleton and capability profile.
- Add deploy executor + progress events.
- Add publish executor + notes generation.
- Add audit records + persistence.
- Flip release command manifest entries and regenerate catalogs.
- Commit after cargo + web + codegen validation passes.

### Closeout

- Mark these plans closed:
  - `active-plans-implementation-2026-05-10.md`
  - `keyboard-nav-overlays-2026-05-10.md`
  - `release-plane-backend-phase-6.md`
- Update `docs/plans/README.md` active handoffs to empty or next work only.
- If no active plan remains, keep `docs/plans/README.md` as the router and remove closed handoff docs in a follow-up cleanup commit.

## Validation matrix

| Layer | Command | Required when |
| --- | --- | --- |
| Web typecheck | `pnpm -F web typecheck` | Every workstream |
| Web unit/render tests | `pnpm -F web test -- --run` | Every workstream |
| Web production build | `pnpm -F web build` | Every workstream |
| Bundle budget | `pnpm -F web size` | Every workstream |
| Local bridge tests | `cargo test -p local-bridge` | Gate + release workstreams |
| Mock engine tests | `cargo test -p mock-engine` | Release event/mock compatibility |
| Red-team tests | targeted red-team cargo tests | Gate + release capability denial |
| Codegen drift | existing codegen verification command | Any manifest/catalog edit |
| Manual smoke | dev server + bridge | Before closing release plan |

Stop immediately if any required gate fails.

## Risk register

| Risk | Probability | Impact | Mitigation |
| --- | --- | --- | --- |
| Keyboard focus trap breaks nested dialogs | Medium | Medium | Stack-aware topmost container; test nested modal case |
| Stash code is stale against current main | Medium | Low | Inspect first; cherry-pick manually; do not blindly pop |
| Gate backend scope balloons into full governance product | High | High | Keep Workstream B minimal for release enforcement only |
| Release publish blocked by connector OAuth | High | Medium | v1 dispatches local script / local target and emits audited event; OAuth stays out of scope |
| Command manifest flips before backend is real | Medium | High | Flip only in same commit as passing backend tests |
| Mock-real event drift breaks ReleasePanel | Medium | High | Shared catalog/codegen + web handler tests before merge |
| Perf gate blocks due to short baseline | Low | Medium | F4 warmup guard exits 0 when history window is undersized |

## Operator-facing UX impact summary

- **After A**: cockpit overlays are keyboard-equal and accessible enough for daily use.
- **After B**: gate decisions become durable, auditable, and safe to rely on.
- **After C**: release cockpit becomes executable: deploy/publish/notes flow works from UI with progress and audit trail.

## Definition of done

This meta-plan is complete only when:

- No `status: draft` plan remains under `docs/plans/` except newly-authored future work.
- Keyboard nav acceptance from `keyboard-nav-overlays-2026-05-10.md` is satisfied.
- Release backend acceptance from `release-plane-backend-phase-6.md` is satisfied.
- Gate governance minimal acceptance in this plan is satisfied.
- Docs index accurately reflects active vs closed plans.
- Working tree is clean after commit and push to `main`.
