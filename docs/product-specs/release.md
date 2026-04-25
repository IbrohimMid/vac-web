---
status: draft (Stage X companion)
audience: product + engineering
companion docs: ../agent-runtime.md, ../gates.md, ../capability-profiles.md, ./assess.md, ./handoff.md
---

# Product Spec — VAC Release

## 1. Product Summary

**VAC Release** adalah cockpit untuk mengubah project yang sudah siap dari sisi build, QA, assessment, handoff, dan gate menjadi release yang aman: deploy, publish, release notes, runbooks, rollback, dan post-release monitoring.

Release bukan sekadar tombol deploy. Release adalah **governed release plane**:

```text
Assess verdicts
  → Gate evaluation
  → Handoff completion
  → Release readiness
  → Deploy / Publish approval
  → executor.release
  → Post-release monitoring
  → Rollback / follow-up if needed
```

Prinsip penting dari gates contract: **gates are decisions, not automations**. Gate mengagregasi assessment verdict + sign-off, tetapi tidak mengeksekusi action sendiri.

---

# 2. Goal

Release harus menyediakan satu tempat untuk:

```text
1. Melihat deploy readiness.
2. Melihat publish readiness.
3. Membuat dan mengedit release notes.
4. Membuat dan mengedit runbook.
5. Menjalankan release readiness assessment.
6. Menjalankan deploy yang gate-guarded.
7. Menjalankan publish yang gate-guarded.
8. Melihat post-release monitor.
9. Menjalankan rollback dengan approval.
10. Mencatat semua decision/action ke audit log.
```

---

# 3. Non-goals

Release tidak boleh:

```text
- Menjadi tombol deploy bebas tanpa gate.
- Mengizinkan Claude/ACP melakukan deploy langsung.
- Mengizinkan deploy/publish tanpa two-party untuk production gate.
- Mengizinkan override gate tanpa audit/time bound/reason.
- Menjadikan release notes generator auto-publish tanpa review.
- Mengizinkan runbook generator auto-save tanpa user review.
- Bypass Handoff untuk production-impacting fixes.
- Menggunakan Stage K / VIL / VWFD semantics.
```

---

# 4. Product Principles

## 4.1 Gate-first

Release action harus bergantung pada gate state.

Relevant gates:

```text
- ReadyForStaging
- ReadyToDeploy
- ReadyToPublish
- ReadyForGrowth
```

Gate catalog existing sudah mendefinisikan `ReadyToDeploy` sebagai prod deploy gate dan `ReadyToPublish` sebagai app/web launch gate. Keduanya default two-party.

## 4.2 Two-party for production

Production deploy/publish butuh dua sign-off berbeda.

```text
ReadyToDeploy = two-party
ReadyToPublish = two-party
Rollback production = two-party unless emergency policy says otherwise
```

## 4.3 Release actions are handoff-style packets

Deploy, publish, rollback, and release-affecting operations harus diperlakukan sebagai **implicit or explicit handoff packet**.

Existing release plan sudah menyebut deploy action berjalan "via handoff-style packet internally".

## 4.4 External agents are assistants, not authorities

Claude Code boleh:

```text
- generate release notes draft
- generate runbook draft
- summarize merged PRs
- inspect deployment blockers
- propose release checklist
- prepare rollback plan
- help fix release blockers through handoff
```

Claude Code tidak boleh:

```text
- decide gate green
- sign off gate
- override gate
- deploy directly
- publish directly
- silently mutate production config
```

---

# 5. Release Surface

Release page saat ini punya 4 card:

```text
- Deploy readiness
- Publish readiness
- Release notes
- Runbooks
```

Spec final tetap memakai empat card ini sebagai release hub, lalu detail page masing-masing.

---

# 6. Release Hub

## 6.1 Hub Layout

Header:

```text
Release
Deploy, publish, runbooks, and post-release monitoring
[Run release readiness]
```

Cards:

```text
Deploy readiness
Publish readiness
Release notes
Runbooks
Post-release monitor
Rollback
```

Initial visible card boleh 4 seperti prototype; Monitor/Rollback bisa muncul setelah deploy event.

## 6.2 Card Requirements

### Deploy Readiness Card

Shows:

```text
- Gate: ReadyToDeploy
- Status: green/yellow/red/overridden
- Blockers count
- Last RTD assessment run
- Security/Reliability status
- Rollback plan status
- Open CTA
```

### Publish Readiness Card

Shows:

```text
- Gate: ReadyToPublish
- Launch checklist status
- Docs/support handoff status
- Release notes status
- Sign-off status
- Open CTA
```

### Release Notes Card

Shows:

```text
- Draft ready / missing / stale
- Version/tag
- Diff range
- Source PRs/handoffs/findings
- Open CTA
```

### Runbooks Card

Shows:

```text
- Missing runbook count
- Rollback runbook status
- Incident response runbook status
- Support handoff status
- Open CTA
```

---

# 7. Deploy Readiness

## 7.1 Purpose

Menjawab:

```text
Apakah build ini aman untuk di-deploy ke staging/prod?
Apa blocker-nya?
Apa evidence-nya?
Siapa yang sudah sign off?
Target mana yang akan di-deploy?
```

## 7.2 Inputs

```text
- ReadyToDeploy gate
- RTD assessment verdict
- Security review
- Reliability review
- Release readiness assessment
- CI/build status
- Handoff completion status
- rollback plan
- deployment target config
- latest commit sha
```

Gate contract mendefinisikan default criteria `ReadyToDeploy`: RTD not blocked, Security PASS, Reliability PASS, Release Readiness READY, rollback plan present, two-party signed.

## 7.3 Deploy Readiness Page

Sections:

```text
1. Gate summary
2. Criteria checklist
3. Blockers
4. Deployment targets
5. Recent commits / diff range
6. Handoff dependencies
7. Rollback plan
8. Sign-offs
9. Audit trail
```

## 7.4 Deployment Targets

Target types from release plan:

```text
- Vercel
- Cloudflare Pages
- custom script
- Docker registry push
- Kubernetes rollout
```

Target card:

```json
{
  "id": "target_prod_vercel",
  "kind": "vercel",
  "label": "Production Vercel",
  "environment": "production",
  "branch": "main",
  "lastDeploy": {
    "sha": "7e3a91f",
    "status": "success",
    "at": "ISO8601"
  },
  "gate": "ReadyToDeploy",
  "deployEnabled": false,
  "disabledReason": "3 blockers"
}
```

---

# 8. Deploy Action

## 8.1 Deploy Button Behavior

Button is disabled unless:

```text
ReadyToDeploy = green
OR ReadyToDeploy = overridden with valid unexpired override
```

## 8.2 Deploy Confirmation

Two-step confirm:

### Step 1 — Summary

```text
You are deploying:
- project
- target
- branch
- commit sha
- diff range
- gate state
- sign-offs
- rollback plan
```

### Step 2 — Risk confirmation

Requires:

```text
- user role confirmation
- typed target name for prod
- optional approver note
- final deploy CTA
```

## 8.3 Deploy Execution

Deploy action must create an internal release packet:

```text
ReleaseDeployPacket
  → executor.release session
  → target adapter
  → deployment event
  → monitor
```

Flow:

```text
deploy.click
  → verify gate
  → verify sign-offs
  → verify rollback plan
  → create implicit release handoff packet
  → dispatch executor.release
  → stream runtime job logs
  → update deployment status
  → start post-release monitor
```

## 8.4 Deploy Event

```json
{
  "id": "deploy_01",
  "targetId": "target_prod_vercel",
  "sha": "7e3a91f",
  "branch": "main",
  "environment": "production",
  "status": "running",
  "startedAt": "ISO8601",
  "completedAt": null,
  "initiatedBy": "usr_01",
  "gateSnapshot": {
    "gate": "ReadyToDeploy",
    "state": "green",
    "signOffs": ["release_manager", "eng_lead"]
  },
  "handoffPacketId": "handoff_release_01",
  "runtimeJobIds": ["job_01"]
}
```

---

# 9. Publish Readiness

## 9.1 Purpose

Publish readiness answers:

```text
Apakah produk/app/web siap dipublikasikan ke user/customer/store?
```

## 9.2 Inputs

Gate contract defines `ReadyToPublish` criteria:

```text
- launch checklist complete
- docs complete
- release notes ready
- support handoff done
- two-party signed
```

## 9.3 Publish Page Sections

```text
1. Gate summary
2. Launch checklist
3. Docs/support handoff
4. Release notes readiness
5. Channel/target config
6. Final checklist
7. Sign-offs
8. Publish action
```

## 9.4 Publish Target Types

```text
- Web production URL promotion
- DNS switch
- Feature flag launch
- Landing page publish
- App store manual checklist
- Docs site publish
```

For mobile app store, release plan says store submission is out of scope and should be stubbed as "Mark as published" with instructions.

## 9.5 Publish Action

Publish is disabled unless:

```text
ReadyToPublish = green or overridden
release notes ready
support handoff done
two-party signoff complete
```

Publish execution is also an `executor.release` action.

---

# 10. Release Notes

## 10.1 Purpose

Generate a reviewed, editable release note from:

```text
- merged PRs
- commits
- completed handoffs
- resolved assessment findings
- known issues
- breaking changes
```

## 10.2 Release Notes Page

Sections:

```text
- Draft list
- Version/tag selector
- Diff range selector
- Source summary
- Generated draft
- User-facing notes
- Technical changelog
- Breaking changes
- Known issues
- Save draft
- Mark ready
- Publish notes
```

## 10.3 Claude/ACP Role

Claude can generate draft notes.

But rule:

```text
Generated notes are never auto-published.
User must edit/review and mark ready.
```

Output structure:

```json
{
  "version": "v1.4.0",
  "diffRange": "v1.3.0..HEAD",
  "userFacing": [
    "Improved payment retry reliability."
  ],
  "technical": [
    "Bound idempotency expiry to monotonic TTL."
  ],
  "breakingChanges": [],
  "knownIssues": [],
  "sourceRefs": {
    "prs": ["#428"],
    "handoffs": ["handoff_01"],
    "assessmentRuns": ["run_02"]
  }
}
```

---

# 11. Runbooks

## 11.1 Purpose

Runbooks are operational instructions for release and incident response.

Required runbooks:

```text
- rollback runbook
- deploy runbook
- incident response runbook
- support handoff notes
- migration runbook if release includes data migration
```

## 11.2 Runbook Page

Sections:

```text
- Runbook list
- Missing runbooks
- Generator templates
- Markdown editor
- Preview
- Save
- Export to Notion/docs
```

## 11.3 Claude/ACP Role

Claude can generate a runbook draft from:

```text
- deployment target
- rollback steps
- prior handoff tasks
- known risks
- incident template
```

But:

```text
Never auto-save generated runbook.
User edits and saves.
Save uses executor.release profile and scoped paths.
```

---

# 12. Post-release Monitor

## 12.1 Purpose

After deploy/publish, Release page should observe health.

## 12.2 Monitor Page

Sections:

```text
- Recent deploys
- Current deploy timeline
- Error rate before/after
- Latency before/after
- Throughput before/after
- Sentry issues
- PagerDuty alerts
- Incident stream
- Rollback CTA
```

## 12.3 Anomaly Detection

Rules:

```text
- error rate > 2x baseline → sticky warning
- latency p95 > threshold → warning
- new critical Sentry issue → persistent alert
- deploy job failed → critical alert
```

---

# 13. Rollback

## 13.1 Purpose

Rollback must be first-class release action.

```text
If deploy introduces incident/regression, user can rollback to previous known-good deploy.
```

## 13.2 Rollback Flow

```text
Rollback click
  → show previous deploy target/sha
  → verify gate/role policy
  → create rollback handoff packet
  → require approval/two-party if prod
  → dispatch executor.release
  → monitor rollback
  → emit release.rollback_completed
```

## 13.3 Rollback Confirmation

Must show:

```text
- current bad deploy
- previous good deploy
- target environment
- expected impact
- rollback command/API
- approval requirements
- incident link if any
```

---

# 14. Release Readiness Assessment

The button **Run release readiness** should trigger assessment focused on release.

Inputs:

```text
- deployment target config
- env/secrets readiness
- rollback plan
- release notes readiness
- runbook readiness
- unresolved handoff blockers
- gate state
- connector health
```

Output:

```text
- release blockers
- missing runbooks
- missing notes
- stale evidence
- required sign-offs
- recommended handoff tasks
```

This is assessment-style, not deploy execution.

---

# 15. Data Model

## 15.1 ReleaseState

```json
{
  "projectRoot": "/repo/payments-svc",
  "branch": "main",
  "currentSha": "7e3a91f",
  "deployReadiness": {
    "gate": "ReadyToDeploy",
    "state": "red",
    "blockers": 3,
    "lastAssessmentRunId": "run_rtd_01"
  },
  "publishReadiness": {
    "gate": "ReadyToPublish",
    "state": "yellow",
    "missing": ["support_handoff_done"]
  },
  "releaseNotes": {
    "status": "draft_ready",
    "draftId": "notes_01"
  },
  "runbooks": {
    "status": "missing",
    "missing": ["rollback"]
  },
  "lastDeploy": {
    "deployId": "deploy_01",
    "targetId": "prod",
    "status": "success"
  }
}
```

## 15.2 ReleaseActionPacket

```json
{
  "id": "release_packet_01",
  "kind": "deploy",
  "targetId": "prod_vercel",
  "sha": "7e3a91f",
  "gate": "ReadyToDeploy",
  "gateSnapshot": {},
  "approval": {
    "twoParty": true,
    "signOffs": []
  },
  "executor": {
    "profileId": "executor.release@1.0.0",
    "agentId": "vac",
    "agentKind": "vac-native"
  },
  "rollbackPlanId": "runbook_rollback_01",
  "state": "pending_approval"
}
```

## 15.3 ReleaseNotesDraft

```json
{
  "id": "notes_01",
  "version": "v1.4.0",
  "diffRange": "v1.3.0..HEAD",
  "status": "draft | ready | published",
  "sourceRefs": {
    "prs": [],
    "handoffs": [],
    "assessmentRuns": []
  },
  "sections": {
    "userFacing": [],
    "technical": [],
    "breakingChanges": [],
    "knownIssues": []
  }
}
```

## 15.4 Runbook

```json
{
  "id": "runbook_rollback",
  "kind": "rollback | deploy | incident | migration | support",
  "path": "docs/runbooks/rollback.md",
  "status": "missing | draft | ready | stale",
  "lastValidatedAt": "ISO8601",
  "sourceRefs": []
}
```

---

# 16. Commands and Events

## 16.1 Proposed Release Commands

```text
release.list_targets
release.inspect_target
release.run_readiness
release.generate_notes
release.save_notes
release.mark_notes_ready
release.generate_runbook
release.save_runbook
release.deploy
release.publish
release.rollback
release.monitor_snapshot
```

## 16.2 Release Events

```text
release.state_updated
release.target_listed
release.readiness_started
release.readiness_completed
release.notes_draft_created
release.notes_ready
release.runbook_draft_created
release.runbook_ready
release.deploy_started
release.deploy_progress
release.deploy_completed
release.deploy_failed
release.publish_started
release.publish_completed
release.rollback_started
release.rollback_completed
release.monitor_alert
```

Where possible, also emit existing generic events:

```text
gate.state_changed
handoff.created
handoff.dispatched
runtime.jobs_updated
runtime.job_log
activity.appended
notify.event
```

---

# 17. Gate Integration

## 17.1 ReadyToDeploy

Deploy disabled if:

```text
ReadyToDeploy = red
ReadyToDeploy = yellow and policy blocks warnings
ReadyToDeploy sign-offs stale
ReadyToDeploy override expired
```

ReadyToDeploy can proceed if:

```text
state = green
OR state = overridden with valid override
AND two-party requirement satisfied
```

## 17.2 ReadyToPublish

Publish disabled if:

```text
release notes not ready
support handoff not done
docs incomplete
launch checklist incomplete
two-party missing
```

## 17.3 Override

Override must be:

```text
- role-restricted
- reason min length
- expiry-bounded
- auditable
- cannot bypass two_party_signed
```

---

# 18. Claude / ACP Role in Release

## 18.1 Allowed roles

```text
- release notes draft worker
- runbook draft worker
- readiness assessment worker
- release blocker fixer via handoff/executor.code
- release prep assistant
```

## 18.2 Restricted roles

```text
- production deploy executor
- production publish executor
- gate signer
- override approver
- release authority
```

## 18.3 Future staged allowance

Later, after hardening:

```text
executor.release@* + acp may be allowed for non-prod release prep only.
Production deploy/publish remains VAC-native or connector-controlled with two-party confirmation.
```

Recommended matrix:

| Release action               | VAC native |                      Claude ACP | Notes                       |
| ---------------------------- | ---------: | ------------------------------: | --------------------------- |
| Generate notes               |        yes |                             yes | Draft only                  |
| Generate runbook             |        yes |                             yes | Draft only                  |
| Release readiness assessment |        yes |                  yes, read-only | Structured output validated |
| Fix blockers                 |        yes | yes via `executor.code` handoff | Not release profile         |
| Deploy staging               |        yes |                     later maybe | gated                       |
| Deploy production            |        yes |                    initially no | two-party                   |
| Publish production           |        yes |                    initially no | two-party                   |
| Rollback production          |        yes |                    initially no | two-party                   |

---

# 19. UI Requirements

## 19.1 Release Hub

Must show:

```text
- Deploy readiness card
- Publish readiness card
- Release notes card
- Runbooks card
- Run release readiness CTA
- Gate ribbon remains visible
- Activity rail remains visible
```

## 19.2 Deploy Page

Must show:

```text
- targets list
- gate status
- criteria checklist
- blockers
- sign-offs
- last deploy
- target deploy CTA
- deploy confirmation
- runtime progress
```

## 19.3 Publish Page

Must show:

```text
- launch checklist
- release notes status
- docs/support handoff
- sign-offs
- publish confirmation
```

## 19.4 Release Notes Page

Must show:

```text
- source refs
- generated draft
- editable sections
- save draft
- mark ready
- publish notes
```

## 19.5 Runbooks Page

Must show:

```text
- required runbooks
- missing/stale status
- generator
- markdown editor
- preview
- save/export
```

## 19.6 Monitor Page

Must show:

```text
- recent deploy timeline
- error rate
- latency
- throughput
- Sentry/PagerDuty alerts
- rollback CTA
```

---

# 20. Audit Requirements

Every release operation must log:

```json
{
  "ts": "ISO8601",
  "event": "release.deploy_started",
  "project": "payments-svc",
  "targetId": "prod_vercel",
  "sha": "7e3a91f",
  "gate": "ReadyToDeploy",
  "gateState": "green",
  "signOffs": [
    {"role": "release_manager", "by": "usr_01"},
    {"role": "eng_lead", "by": "usr_02"}
  ],
  "executorProfile": "executor.release@1.0.0",
  "agentId": "vac",
  "agentKind": "vac-native"
}
```

Override audit:

```json
{
  "event": "release.gate_override_used",
  "gate": "ReadyToDeploy",
  "overrideId": "ovr_01",
  "reason": "Emergency patch for production incident...",
  "expiresAt": "ISO8601",
  "usedByDeployId": "deploy_01"
}
```

Rollback audit:

```json
{
  "event": "release.rollback_started",
  "fromDeployId": "deploy_bad",
  "toDeployId": "deploy_good",
  "targetId": "prod",
  "approval": "two_party"
}
```

---

# 21. Red-team Cases

```text
R01: User clicks deploy while ReadyToDeploy red → blocked.
R02: User clicks publish while ReadyToPublish red → blocked.
R03: ReadyToDeploy overridden but two-party missing → blocked.
R04: Claude tries to deploy directly from release notes worker → denied.
R05: Release notes generated but not reviewed → cannot mark ReadyToPublish.
R06: Runbook missing rollback section → ReadyToDeploy blocked.
R07: Connector write auth fails mid-deploy → deploy failed + audit + alert.
R08: Deploy succeeds but monitor detects 2x error rate → sticky alert + rollback CTA.
R09: Rollback production with one approver → blocked.
R10: Override expired during confirmation → deploy blocked.
R11: Target branch changed between confirm and deploy → reverify or block.
R12: Publish action tries to mutate unsupported target → denied.
R13: ACP provider emits "deploy succeeded" without bridge-observed deploy event → ignored.
R14: Release gate sign-off stale after new critical finding → gate reverts.
R15: User tries to publish notes with unresolved breaking changes → warning or block per policy.
R16: Deploy target config missing rollback adapter → prod deploy blocked.
```

---

# 22. Product Acceptance Criteria

## Release Hub

```text
- User can see deploy/publish/readiness status in one page.
- Cards show blockers or ready state.
- Run release readiness starts assessment.
```

## Deploy

```text
- Target list loads.
- Gate guard blocks red gate.
- Two-party enforced for production.
- Deploy event streams runtime progress.
- Audit log records decision/action.
```

## Publish

```text
- Publish checklist loads.
- Missing notes/runbooks/support handoff block publish.
- Publish requires ReadyToPublish gate.
```

## Release Notes

```text
- Draft can be generated.
- User can edit.
- User can mark ready.
- Published-ready notes feed ReadyToPublish.
```

## Runbooks

```text
- Missing runbooks detected.
- Draft can be generated.
- User can edit/save.
- Rollback runbook feeds ReadyToDeploy.
```

## Monitor

```text
- Deploy creates monitor session.
- Metrics/alerts appear.
- Error spike creates sticky alert.
- Rollback CTA available.
```

## Claude/ACP

```text
- Claude can draft notes/runbooks.
- Claude can run read-only release readiness.
- Claude cannot deploy/publish directly.
- Claude output is validated before becoming release state.
```

---

# 23. Rollout Plan

## Release V1 — Hub + readiness cards

```text
- Release page cards
- Gate state display
- Open pages
```

## Release V2 — Release readiness assessment

```text
- Run release readiness
- Feed blockers into gate
```

## Release V3 — Release notes + runbooks

```text
- Generate draft
- Edit/save
- Mark ready
```

## Release V4 — Deploy target + gate guard

```text
- List targets
- Deploy confirm
- executor.release dispatch
```

## Release V5 — Publish flow

```text
- Launch checklist
- publish confirm
- ReadyToPublish enforcement
```

## Release V6 — Post-release monitor + rollback

```text
- Monitor metrics
- anomaly alert
- rollback action
```

## Release V7 — ACP-assisted release prep

```text
- Claude notes/runbooks/readiness
- No deploy authority
```

---

# 24. Final Product Rule

```text
Release is not a deploy button.
Release is a governed plane for readiness, sign-off, deploy, publish, monitoring, and rollback.
```

Dengan Claude Code:

```text
Claude can help prepare release.
VAC bridge decides whether release is allowed.
VAC executor or connector adapter performs release action.
Web displays the complete release lifecycle.
```
