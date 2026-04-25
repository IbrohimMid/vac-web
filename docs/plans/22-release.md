# Release — implementation plan

**Goal.** Lift Release from the current static surface (4 readiness cards) to the spec at [`../product-specs/release.md`](../product-specs/release.md): live deploy/publish gates, generated notes/runbooks (draft-only), executor.release dispatch, post-release monitor, rollback, audit.

**Depends on.** [`20-assess.md`](./20-assess.md) Stage A7 (gate feed), [`21-handoff.md`](./21-handoff.md) Stages H1, H3, H4 (pin, two-party, dispatch). Existing gate catalog ([`../gates.md`](../gates.md)).

**Out of scope.** ACP-driven production deploy/publish (spec §18 keeps these VAC-native initially). App-store submission flows (stubbed as "Mark as published").

---

## R1 — ReleaseState aggregator

Bridge service that aggregates: gate state (RTD, RTP), latest RTD assessment run, security/reliability verdicts, release notes status, runbooks status, last deploy. Emits `release.state_updated`.

**Exit.** Release Hub renders all four cards from the live aggregator.

## R2 — Release readiness assessment

Wire the "Run release readiness" CTA to a release-focused assessment family. Output blockers, missing notes/runbooks, stale evidence, required sign-offs.

**Exit.** Verdict feeds RTD blockers list.

## R3 — Release notes generator (draft-only)

Generator produces `ReleaseNotesDraft` with `userFacing`, `technical`, `breakingChanges`, `knownIssues`, `sourceRefs`. Claude can draft via ACP; bridge enforces `status: draft → ready → published` and never auto-publishes.

**Exit.** Red-team case R05 passes; published notes feed RTP gate criterion.

## R4 — Runbooks (draft-only)

Same draft model for `Runbook` (`rollback | deploy | incident | migration | support`). Missing rollback runbook blocks RTD per spec §17.1 and existing gate catalog. Optional Notion export.

**Exit.** Red-team case R06 passes.

## R5 — Deploy targets + gate-guarded action

`release.list_targets`, `release.inspect_target`. Deploy button disabled unless RTD green or overridden-with-valid-override. Two-step confirm; production requires typed target name. Internally creates a release handoff packet with `executor.release@1.0.0` (initially `agent_kind=vac-native`).

**Exit.** Red-team cases R01, R03, R10, R11, R16 pass.

## R6 — Publish flow

Same shape, ReadyToPublish gate. Disabled unless notes ready, support handoff done, two-party signed.

**Exit.** Red-team cases R02, R12 pass.

## R7 — Post-release monitor

Subscribe to connector-side metrics (Sentry/Datadog/PagerDuty adapters). Anomaly rules: error rate > 2× baseline → sticky warning; p95 latency threshold; new critical Sentry issue; failed deploy job. Rollback CTA when any sticky alert active.

**Exit.** Red-team cases R07, R08 pass on a synthetic deploy.

## R8 — Rollback action

`release.rollback` creates a rollback handoff (reuses [`21-handoff.md`](./21-handoff.md) H8). Production requires two-party.

**Exit.** Red-team case R09 passes.

## R9 — Override audit

Override flow: role-gated, reason min length, expiry-bounded, single-use against one deploy. Cannot bypass two-party.

**Exit.** Spec §17.3 covered; override audit row carries `usedByDeployId`.

---

## Risks / open questions

- Gate sign-off staleness on new critical findings (R14): need a deterministic "invalidate sign-offs" rule once Assess emits a new critical post-sign-off.
- Connector adapter coverage: monitor (R7) depends on connectors that may not be in v1.0; degrade gracefully when none configured.
- "Mark as published" stub for app stores: a manual checklist + audit row is enough for v1; revisit when store APIs are in scope.
