# Product Spec — VAC Assess

**Status**: 🔵 product spec; depends on Stage X agent-runtime + existing assessment-contract.md
**Audience**: anyone implementing Assess flow, scoring, validators, or ACP assessment-worker integration
**Companion docs**: [`agent-runtime.md`](../agent-runtime.md), [`../assessment-contract.md`](../assessment-contract.md), [`build.md`](./build.md), [`handoff.md`](./handoff.md), [`release.md`](./release.md)

---

## 1. Product Summary

**VAC Assess** adalah assessment cockpit untuk membaca kondisi repo, menjalankan readiness/review checks, menghasilkan findings berbasis evidence, menghitung verdict, dan mengubah findings terpilih menjadi handoff packet untuk executor.

Assess tidak hanya menampilkan hasil LLM. Assess adalah **structured assessment system**:

```
Repo / connectors / runtime evidence
  → Assessment worker: VAC native / Claude Code ACP / other ACP worker
  → Bridge validation and normalization
  → AssessmentRun + Findings + Verdict
  → Web Assess / Report / Handoff UI
```

Assessment contract existing sudah mengunci prinsip utama: assessor harus read-only, evidence-first, deterministic identity, composable, dan reproducible.

---

## 2. Goal

Membuat Assess menjadi production-grade review engine yang bisa:

```
1. Menjalankan assessment repo dengan depth quick / standard / full.
2. Menggunakan VAC native runner atau ACP-compatible worker seperti Claude Code.
3. Membaca repo dan connector evidence secara read-only.
4. Mengubah output agent menjadi structured AssessmentFinding.
5. Menampilkan hasil otomatis di Assess landing, report detail, Handoff flow, Activity rail.
6. Memaksa continuation pass jika assessment selesai terlalu cepat.
7. Menghasilkan HandoffPacket dari selected findings.
8. Menjadi input untuk Gate / Release readiness tanpa menyerahkan authority ke external agent.
```

---

## 3. Non-goals

Assess **tidak** melakukan ini:

```
- Memberi Claude/ACP permission write file saat assessment.
- Membiarkan raw markdown agent langsung menjadi finding final.
- Mengizinkan external ACP worker menentukan gate final tanpa bridge validation.
- Mengizinkan assessor menjalankan destructive shell command.
- Memulai Stage K / VIL / VWFD.
- Mengubah browser ↔ bridge protocol secara breaking.
- Menggabungkan assessment worker dengan executor worker.
```

---

## 4. Product Principles

### 4.1 Read-only by default

Semua assessment worker wajib read-only.

Boleh:

```
- read_file
- list_files
- repo search
- git diff / git status / git log
- connector read-only snapshots
- allowlisted static analysis commands
```

Tidak boleh:

```
- write file
- commit
- push
- deploy
- modify connector state
- approve handoff
- override gate
```

### 4.2 Evidence-first

Finding tanpa evidence ditolak.

Minimal evidence:

```json
{
  "kind": "file",
  "path": "src/handlers/charge.rs",
  "line": 47
}
```

Assessment contract existing juga menyatakan finding tanpa minimal satu `EvidenceRef` harus ditolak saat serialization.

### 4.3 Bridge owns verdict

Claude/ACP worker boleh menghasilkan **candidate findings**. Bridge yang:

```
- validate schema
- validate evidence path/line
- dedupe finding
- normalize severity/category
- compute or confirm verdict
- emit assessment events
- write audit log
```

Prinsip final:

```
Agent assesses.
Bridge verifies and structures.
Web renders.
VAC owns verdict.
```

---

## 5. Primary Users

| User               | Need                                                             |
| ------------------ | ---------------------------------------------------------------- |
| Builder / engineer | Tahu apa yang menghalangi deploy/release.                        |
| Reviewer           | Melihat structured findings, evidence, severity, dan confidence. |
| PM / product owner | Melihat UX/product risks dan next actions.                       |
| Release owner      | Melihat readiness status dan blockers sebelum publish.           |
| VAC operator       | Convert findings menjadi HandoffPacket dan dispatch executor.    |

---

## 6. Assess Surfaces

### 6.1 Assess Landing

Fungsi:

```
- Menampilkan scorecard per family.
- Menampilkan status Ready / Conditional / Blocked / Not run.
- Menampilkan last sweep timestamp.
- Tombol Run / Open per family.
- Tombol Run full sweep.
- Section What to do next.
- Recent assessments.
```

Card minimal:

```
Family name
Verdict
Blockers / warnings count
Last run freshness
Run command preview
Open button
```

### 6.2 Run Assessment Drawer

Fungsi:

```
- Pilih assessment family.
- Pilih depth: quick / standard / full.
- Menampilkan connectors read-only yang akan digunakan.
- Menjalankan assessment.run.
```

Family options:

```
- Ready to Deploy
- Product Review
- UX Review
- Security Review
- All families
```

Depth options:

```
Quick ~1m
Standard ~5m
Full ~15m display target, with hard cap up to 30m if needed
```

### 6.3 Assessment Report Detail

Fungsi:

```
- Menampilkan verdict.
- Menampilkan finding list.
- Filter category/severity.
- Select findings.
- Defer finding.
- Add to handoff.
- Create handoff from selected findings.
- Run details.
- Comparison to last run.
```

### 6.4 Handoff Linkage

Findings yang dipilih menjadi task candidate di Handoff.

```
AssessmentFinding
  → selectedFindingIds
  → handoff.create
  → HandoffPacket.tasks[]
```

---

## 7. Assessment Families

Initial families:

| Family                | Purpose                                     | Example verdict               |
| --------------------- | ------------------------------------------- | ----------------------------- |
| Ready to Deploy / RTD | Deployment, rollback, infra, observability  | Ready / Conditional / Blocked |
| Product Review        | Product logic, acceptance, flow clarity     | Ready / Conditional / Blocked |
| UX Review             | UI states, CTA clarity, user flow           | Ready / Conditional / Blocked |
| Security Review       | Auth, secrets, deps, config                 | Pass / Warn / Fail            |
| Reliability           | Idempotency, retries, timeouts, consistency | Pass / Warn / Fail            |
| Performance           | Hot paths, latency, resource use            | Pass / Warn / Fail            |
| Release Readiness     | Notes, rollback, publish checklist          | Ready / Conditional / Blocked |
| QA Strategy           | Test coverage, regression, edge cases       | Pass / Warn / Fail            |

Existing assessment contract already defines families such as RTD, PM, UX, Frontend, Security, Reliability, Perf, Release, Launch, QA, Docs, and Growth.

---

## 8. Assessment Depth

Depth bukan hanya UI ETA. Depth adalah **exploration budget**.

| Depth      |                       Target | Purpose                        | Early threshold | Max continuation |
| ---------- | ---------------------------: | ------------------------------ | --------------: | ---------------: |
| `quick`    |                         ~60s | Smoke pass, top risks only     |            <35s |                1 |
| `standard` |                          ~5m | Default complete family pass   |           <180s |                2 |
| `full`     | ~15m UI target, hard cap 30m | Deep review + expensive checks |           <600s |              3–4 |

Existing contract defines quick as smoke-level pass, standard as default checks, and full as expensive/deep checks.

---

## 9. Mandatory Early Completion Continuation

Jika ACP worker selesai terlalu cepat, assessment **tidak boleh langsung selesai**.

### Rule

```
If an ACP assessment worker completes before the selected depth budget is sufficiently consumed, bridge must issue automatic continuation prompts before finalizing the run.
```

### Example

Kalau user pilih `standard ~5m`, lalu Claude selesai dalam 45 detik:

```
Bridge detects early completion.
Bridge emits assessment.progress: continuation_pass_1.
Bridge sends continuation prompt.
Claude searches missed risks.
Bridge validates new findings.
Bridge repeats until stop condition.
```

### Stop condition

Assessment boleh complete jika salah satu terpenuhi:

```
1. Time budget sufficiently consumed.
2. Coverage checklist complete.
3. Max continuation passes reached.
4. Two consecutive continuation passes produce no new validated findings.
5. User cancels assessment.
6. Worker crashes or times out.
```

### Continuation prompt

```
You completed earlier than the required assessment depth.

Do not repeat prior findings unless adding new evidence.

Perform an additional adversarial pass focused on:
- missed edge cases
- security gaps
- reliability/idempotency issues
- rollback and deployment blockers
- stale evidence
- race conditions
- test gaps
- hidden coupling between files
- release blockers
- contradictory assumptions

Return only structured JSON candidate findings.
If no new findings exist, return structured coverage_notes and an empty new_findings array.
```

---

## 10. ACP Assessment Worker Mode

Claude Code or another ACP provider can be used for assessment only through a restricted role:

```
agent_kind = acp
agent_role = assessment-worker
profile_id = assessor.<family>@1.0.0
mode = read-only
```

### Allowed

```
- read repo files
- inspect git diff/status/log
- use read-only connector snapshots
- run allowlisted read-only commands
- return structured candidate findings
```

### Denied

```
- write/edit files
- shell mutation
- package install
- commit/push
- deploy/publish
- gate override
- handoff approval
```

### Matrix

| Profile                | Generic ACP executor |     ACP assessment worker |
| ---------------------- | -------------------: | ------------------------: |
| `executor.code@*`      |              allowed |                       n/a |
| `assessor.*@*`         |               denied | allowed, read-only, gated |
| `executor.release@*`   |     denied initially |                       n/a |
| `executor.migration@*` |               denied |                       n/a |

---

## 11. Assessment Lifecycle

```
Idle
  → user clicks Run assessment
  → assessment.run
  → pending
  → worker spawned
  → running
  → evidence collected
  → candidate output received
  → bridge validation
  → continuation if needed
  → findings emitted
  → verdict synthesized
  → completed / failed / cancelled
```

Protocol v1 already defines `assessment.run`, `assessment.list_runs`, `assessment.fetch_report`, `assessment.cancel`, `assessment.replay`, and `assessment.diff`. It also defines assessment events such as `assessment.started`, `assessment.progress`, `assessment.finding_added`, `assessment.completed`, and `assessment.failed`.

---

## 12. Data Model

### 12.1 AssessmentRun

```json
{
  "id": "run_01",
  "type": "RTD",
  "familyId": "assessor.rtd",
  "profileId": "assessor.rtd@1.0.0",
  "agent": {
    "agentId": "claude",
    "agentKind": "acp",
    "agentRole": "assessment-worker",
    "dialect": "provisional"
  },
  "scope": {
    "projectRoot": "/repo/payments-svc",
    "repoRef": "sha:7e3a91f",
    "depth": "standard",
    "pathGlobs": ["src/**/*.rs"]
  },
  "depthBudget": {
    "targetSeconds": 300,
    "earlyThresholdSeconds": 180,
    "maxContinuationPasses": 2,
    "continuationPassesUsed": 1
  },
  "status": "running",
  "startedAt": "ISO8601",
  "completedAt": null,
  "counts": {
    "findings": {
      "critical": 1,
      "high": 2,
      "medium": 2,
      "low": 1
    },
    "evidence": 8,
    "toolCalls": 12
  }
}
```

### 12.2 CandidateFinding from ACP worker

```json
{
  "title": "Idempotency keys stored without expiry binding",
  "category": "security",
  "severity": "critical",
  "confidence": 0.91,
  "description": "Redis entries persist beyond the dedupe window...",
  "rationale": "A stale idempotency key can mask or replay payment state.",
  "recommendation": "Bind expiry to the monotonic store and verify on replay.",
  "evidence": [
    {
      "kind": "file",
      "path": "src/handlers/charge.rs",
      "line": 47
    }
  ],
  "fixability": "assisted",
  "handoffCandidate": true
}
```

### 12.3 Validated AssessmentFinding

```json
{
  "id": "fnd_01",
  "runId": "run_01",
  "familyId": "assessor.rtd",
  "category": "security",
  "subsystem": "payments",
  "severity": "critical",
  "confidence": 0.91,
  "title": "Idempotency keys stored without expiry binding",
  "description": "...",
  "rationale": "...",
  "evidence": [
    {
      "id": "ev_01",
      "kind": "file",
      "uri": "file://src/handlers/charge.rs",
      "locator": {
        "line": 47
      },
      "observedAt": "ISO8601",
      "freshUntil": "ISO8601"
    }
  ],
  "suggestedFix": {
    "steps": [
      "Bind idempotency expiry to monotonic clock.",
      "Verify TTL on replay path.",
      "Add regression coverage for Redis failover."
    ],
    "executorProfileHint": "executor.code"
  },
  "identityHash": "sha256:...",
  "emittedBy": "claude"
}
```

---

## 13. Bridge Validation Rules

Candidate output from Claude/ACP is rejected or downgraded if:

```
- not valid JSON
- schema invalid
- missing evidence
- evidence file does not exist
- evidence line does not exist
- path outside projectRoot
- severity invalid
- category invalid
- critical finding confidence < threshold
- duplicate identityHash
- speculative claim without evidence
- claims connector evidence that was not captured
```

Critical finding rule:

```
severity = critical requires confidence >= 0.7 and at least one strong evidence ref.
```

---

## 14. Verdict Rules

Verdict is synthesized by bridge/VAC layer, not external provider alone.

### RTD / Release style

```
critical >= 1 → BLOCKED
high >= 1     → CONDITIONAL unless explicitly non-blocking
medium only   → CONDITIONAL / WARN
none          → READY
```

### Security / Reliability style

```
critical/high security issue → FAIL
medium issues                → WARN
none                         → PASS
```

### Product / UX style

```
score-based with blockers if severe user/business flow issue exists.
```

---

## 15. UI Requirements

### 15.1 Assess Landing

Must show:

```
- family scorecards
- verdict per family
- blocker/warning count
- last run timestamp
- depth used
- run/open actions
- recommended next actions
- recent assessment runs
```

### 15.2 Running State

During run:

```
- show current family
- show depth
- show pass number
- show current stage
- show elapsed time
- show continuation reason if triggered
```

Example:

```
Standard sweep · Pass 2/3
Continuing assessment because first pass completed early.
Searching for missed reliability and release blockers.
```

### 15.3 Report Detail

Must show:

```
- verdict
- severity counts
- finding list
- evidence chips
- category badges
- confidence
- fixability
- add to handoff
- defer
- compare to previous run
- run details
```

### 15.4 Activity Rail Events

Examples:

```
Assessment started: Ready to Deploy standard sweep.
Claude assessment worker completed early; continuation pass requested.
Security finding validated: idempotency expiry missing.
2 candidate findings rejected due to missing evidence.
Assessment completed: Conditional, 3 blockers.
```

---

## 16. Commands and Events

No new browser command is required for the core flow.

Use existing command:

```json
{
  "type": "assessment.run",
  "payload": {
    "type": "ready_to_deploy",
    "scope": {
      "projectRoot": "/repo/payments-svc",
      "repoRef": "sha:7e3a91f"
    },
    "depth": "standard",
    "agent_id": "claude",
    "agent_role": "assessment-worker"
  }
}
```

Events emitted:

```
assessment.started
assessment.progress
assessment.finding_added
assessment.evidence_attached
assessment.completed
assessment.failed
activity.appended
notify.event
```

---

## 17. Audit Requirements

### 17.1 Run started

```json
{
  "event": "assessment.started",
  "run_id": "run_01",
  "family_id": "assessor.rtd",
  "profile_id": "assessor.rtd@1.0.0",
  "agent_id": "claude",
  "agent_kind": "acp",
  "agent_role": "assessment-worker",
  "depth": "standard",
  "project_root_hash": "sha256:...",
  "repo_ref": "7e3a91f"
}
```

### 17.2 Candidate output received

```json
{
  "event": "assessment.candidate_output_received",
  "run_id": "run_01",
  "agent_id": "claude",
  "candidate_hash": "sha256:...",
  "candidate_count": 5
}
```

### 17.3 Candidate rejected

```json
{
  "event": "assessment.candidate_rejected",
  "run_id": "run_01",
  "reason": "missing_evidence",
  "candidate_hash": "sha256:..."
}
```

### 17.4 Early completion continuation

```json
{
  "event": "assessment.continuation_requested",
  "run_id": "run_01",
  "depth": "standard",
  "elapsed_seconds": 48,
  "early_threshold_seconds": 180,
  "continuation_pass": 1,
  "reason": "completed_before_depth_budget"
}
```

---

## 18. Handoff Integration

Findings can become Handoff tasks only if:

```
- finding validated
- evidence attached
- user selected finding
- finding is not deferred
- finding has executorProfileHint or bridge can infer one
```

Handoff task generated from finding:

```json
{
  "title": "Fix idempotency expiry binding",
  "rationale": "Critical RTD blocker found in charge handler.",
  "evidenceRefs": ["ev_01"],
  "steps": [
    "Bind idempotency expiry to monotonic clock.",
    "Verify TTL on replay.",
    "Add regression test."
  ],
  "constraints": [
    "No schema breaking changes",
    "Must stay idempotent"
  ],
  "estEffort": "~15m"
}
```

---

## 19. Release/Gate Integration

Assessment verdict feeds gate state.

But rule:

```
Claude/ACP cannot directly pass or override a gate.
```

Bridge maps verdict to gate recommendation:

```
RTD BLOCKED       → ReadyToDeploy blocked
RTD CONDITIONAL   → ReadyToDeploy conditional
RTD READY         → ReadyToDeploy pass candidate
```

Gate finalization still belongs to VAC bridge.

---

## 20. Product Acceptance Criteria

### 20.1 Assessment run

```
- User can run quick/standard/full assessment.
- User can select family or all families.
- Run emits progress events.
- Run produces structured findings.
- Run produces verdict.
- Report page renders without manual refresh.
```

### 20.2 ACP worker

```
- Claude/ACP worker can be selected only for assessment-worker mode.
- Worker has read-only access.
- Worker output must be structured JSON.
- Invalid output is rejected.
- Valid output becomes AssessmentFinding.
```

### 20.3 Continuation

```
- Early completion triggers continuation prompt.
- Continuation emits assessment.progress.
- New findings are deduped.
- Repeated no-new-finding passes can stop the run.
- Full run cannot complete from one shallow pass.
```

### 20.4 Evidence

```
- Every finding has evidence.
- Evidence path is verified.
- Evidence line/range is verified where applicable.
- Stale evidence is flagged.
- Missing evidence candidates are rejected.
```

### 20.5 Security

```
- No file write possible in assessment mode.
- Shell is read-only allowlist only.
- Path traversal denied.
- Connector mutation denied.
- Gate/handoff authority denied to assessment worker.
```

---

## 21. Red-Team Cases for Assess

```
A01: Claude returns markdown instead of JSON → reject + transcript/error note.
A02: Claude returns finding without evidence → reject.
A03: Claude references non-existing file → reject.
A04: Claude references line outside file range → reject or downgrade.
A05: Claude tries to write file during assessment → deny + audit.
A06: Claude requests shell command rm -rf → deny.
A07: Claude finishes standard run in 20s → continuation required.
A08: Claude repeats same finding in continuation → dedupe.
A09: Claude invents connector result not captured by bridge → reject.
A10: Claude marks gate passed → ignored; bridge computes verdict.
A11: Claude produces critical finding with confidence 0.4 → reject/downgrade.
A12: User cancels during continuation → status cancelled, partial findings retained.
```

---

## 22. Rollout Plan

### Phase A — Native/mock assessment baseline

```
- Keep existing assessment flow.
- Ensure Report/Handoff UI consumes structured events.
```

### Phase B — ACP Assessment Worker doc/spec

```
- Add product/technical spec.
- Mark Claude ACP dialect provisional until verified.
```

### Phase C — Read-only ACP worker

```
- Spawn Claude/ACP in read-only mode.
- Ask for structured JSON candidate findings.
- No file/shell mutation.
```

### Phase D — Bridge validator

```
- Validate schema/evidence/severity/category.
- Emit validated findings.
```

### Phase E — Depth continuation

```
- Add quick/standard/full budget enforcement.
- Auto continuation prompt on early completion.
```

### Phase F — Handoff integration

```
- Selected validated findings become Handoff tasks.
```

---

## Final Product Rule

Assess boleh memakai Claude Code atau ACP agent lain untuk membaca repo dan menemukan risiko. Tetapi outputnya hanya **candidate assessment**.

```
Candidate output is not product truth.
Validated AssessmentRun is product truth.
```

Jadi produk akhirnya:

```
Claude/ACP finds.
Bridge validates.
Assess renders.
Handoff converts.
Gate decides.
```
