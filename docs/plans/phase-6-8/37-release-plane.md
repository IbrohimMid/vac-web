# Plan 37 — Release plane

**Phase**: 6 · **Depends on**: Plans 24, 30, 32, 34, 36 · **Blocks**: Phase 6 exit · **Est**: 3 weeks

## Goal

Implement the Release plane: Deploy, Publish, Runbooks, Release Notes, Post-release Monitor. This is the surface where `ReadyToDeploy` + `ReadyToPublish` gates become actions. Uses `executor.release@1.0.0` profile.

## Why this is hard

Release operations are irreversible in practice (can't un-publish an app; can't un-deploy a bad push). Gates + two-party + scoped profile + clear UX are all that keep us from "oops."

## Scope

### In
- Deploy page: gate-guarded dispatch to deployment targets.
- Publish page: consolidated launch checklist + final publish action.
- Runbooks generator.
- Release notes generator (LLM-assisted, user-editable).
- Post-release monitor dashboard.
- `ReadyForStaging`, `ReadyToDeploy`, `ReadyToPublish`, `ReadyForGrowth` gates.

### Out
- Hosted dispatch (Plan 38).
- Continuous readiness (Plan 39).

## Deliverables

```
apps/web/src/
├── components/Release/
│   ├── ReleaseNav.tsx
│   ├── Deploy/
│   │   ├── DeployPage.tsx
│   │   ├── TargetList.tsx
│   │   └── DeployConfirm.tsx
│   ├── Publish/
│   │   ├── PublishPage.tsx
│   │   └── FinalChecklist.tsx
│   ├── Runbooks/
│   │   ├── RunbooksPage.tsx
│   │   ├── RunbookEditor.tsx
│   │   └── RunbookGenerator.tsx
│   ├── ReleaseNotes/
│   │   ├── ReleaseNotesPage.tsx
│   │   ├── NotesDraft.tsx
│   │   └── NotesGenerator.tsx
│   └── Monitor/
│       ├── MonitorPage.tsx
│       ├── IncidentStream.tsx
│       └── MetricsSummary.tsx
apps/local-bridge/src/release/
├── mod.rs
├── deploy_orchestrator.rs
├── publish.rs
├── runbook_gen.rs
├── notes_gen.rs
└── monitor.rs
```

## Stages

### S1 — Release nav + auth (0.2 day)

Sidebar L1 entry "Release" with sub-items. Each sub-item checks relevant gate state; if red/yellow, shows gate ribbon sticky at top.

Release plane sessions use `executor.release@1.0.0` profile exclusively. Build-plane actions inaccessible here.

**Exit**: navigation structure + gate visibility.

### S2 — Deploy page + gate guard (0.3 day)

List deployment targets configured for project (Vercel, Cloudflare Pages, custom script).

Each target shows:
- Last deploy (time + sha + status).
- Current connected branch/env.
- Deploy button (disabled unless `ReadyToDeploy` green or overridden).

Deploy button click → two-step confirm:
1. Confirmation dialog showing what will happen + gate status + recent commits.
2. `executor.release` session spawn to perform tag + push + invoke deployment API.

All via handoff-style packet (internally): packet created automatically for deploy action, two-party pre-signed if gate has sign-offs.

**Exit**: end-to-end test: green gate → deploy → success event.

### S3 — Deploy orchestrator (backend) (0.3 day)

```rust
pub async fn deploy(target: DeployTarget, sha: &str, ctx: &ReleaseContext) -> Result<DeployOutcome> {
    let packet = build_implicit_packet(target, sha, ctx).await?;
    handoff_manager.approve_preflight(&packet).await?;
    handoff_manager.dispatch_local(&packet.id).await?;
    // Watches for completion event
}
```

Target types: vercel, cloudflare_pages, custom_script, docker_registry_push + k8s_rollout.

Per target: specific connector write methods.

**Exit**: at least Vercel + Cloudflare targets work.

### S4 — Publish page (0.3 day)

Launch Readiness (Plan 36) verdict plus additional pre-publish checks:
- Landing page reachable.
- SSL valid.
- SEO basics live.
- Analytics firing.
- App store metadata complete (if applicable).

"Publish" button gated on `ReadyToPublish`. Clicks → confirmation + executor.release action.

For web: could be setting a DNS record, promoting a staging URL, or flipping a feature flag. Configurable per project.

For mobile app: stub "Mark as published" with instructions (Apple/Play Store submission is out of our scope).

**Exit**: publish flow documented + end-to-end for web-only target.

### S5 — Runbooks (0.3 day)

`RunbooksPage`: list of runbooks from project (`docs/runbooks/*.md`).

Editor: CodeMirror with markdown + preview split.

Generator: LLM-assisted. Input: incident template (rollback / outage / migration). Output: markdown draft. User edits + saves (writes via `executor.release` profile — runbook files in `scoped_paths`).

Sync with Notion connector optionally: export runbook to Notion page.

**Exit**: generate + edit + save round-trip.

### S6 — Release Notes (0.3 day)

`ReleaseNotesPage`: list of draft + published release notes.

Generator: given version tag + diff range, LLM summarizes commits + handoffs + resolved assessment findings into:
- User-facing section.
- Technical changelog.
- Breaking changes.

User edits freely; Save publishes.

On publish: commits via `executor.release` with pre-signed approval (gated on `ReadyToPublish`).

**Exit**: generate → edit → publish round-trip.

### S7 — Post-release Monitor (0.3 day)

After a deploy/publish event, this page becomes active:
- Last N deploys listed.
- Per-deploy: timeline of events (commits deployed, rollback button, incident links).
- Live metrics from Sentry/Datadog (error rate, latency, throughput) with before/after deploy comparison.
- Alert list from PagerDuty.

Surface anomalies: if error rate post-deploy > 2× baseline, emit sticky banner.

**Exit**: mock incident scenario shows correctly.

### S8 — Rollback (0.2 day)

One-click "Rollback" on recent deploy:
- If deploy came from packet A: trigger new packet B with inverse action (redeploy previous sha).
- Two-party approval if `ReadyToDeploy.requires_two_party`.
- Same executor.release profile.

Rollback is not a build-plane action; it's release-plane. Must preserve audit.

**Exit**: rollback path tested on staging.

### S9 — Additional gates (0.2 day)

Implement `ReadyForStaging`, `ReadyToPublish`, `ReadyForGrowth` per `gates.md`.

Each has its own criteria + policy YAML + evaluator registration.

**Exit**: 4 new gates live.

### S10 — Tests + red-team (0.2 day)

- Red-team cases: executor.release attempts out-of-scope write (Plan 30 RT cases).
- Deploy without approved gate → blocked.
- Rollback without two-party → blocked for prod.

**Exit**: RT green.

## Testing

- E2E mock deploy with staging target.
- Runbook / release notes generator empirical review.
- Rollback path.
- Gate-guard enforcement.

## Exit criteria

- [ ] Deploy to at least 2 targets works.
- [ ] Publish checklist covers primary launch needs.
- [ ] Runbooks + release notes generate + edit.
- [ ] Post-release monitor displays metrics.
- [ ] Rollback works end-to-end.
- [ ] All 4 new gates integrate.

## Risks

| Risk | Mitigation |
|---|---|
| Irreversible deploy happens accidentally | Gate + two-party + explicit confirm |
| Runbook generator produces bad content | Never auto-save; always user-edit loop |
| Connector write auth fails mid-deploy | Partial-state handling; audit + alert |
| Per-target config sprawl | Plugin architecture: target adapters |

## Related

- [`gates.md`](../../gates.md)
- [`capability-profiles.md`](../../capability-profiles.md) §4.2 — executor.release
- Plan 34 — dispatch (used for release sessions)
- Plan 36 — Release / Launch assessors
