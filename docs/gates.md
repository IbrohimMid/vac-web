# Gates — Release Checkpoints & Governance

**Status**: v1 (locked for Phase 0.5)
**Scope**: Gate catalog, evaluation logic, override governance, sign-off mechanics, and UI surfacing.

---

## 1. Principles

1. **Gates are decisions, not automations.** They aggregate assessment verdicts + sign-offs; they do not execute anything themselves.
2. **Override is auditable, time-bound, role-restricted.** No silent bypass.
3. **Two-party required for production gates.** `ReadyToDeploy`, `ReadyToPublish`.
4. **Gate state is project-scoped, branch-aware.** A gate can be green on `main` and red on `feature/x`.
5. **Gates are visible everywhere.** Topbar ribbon always shows active gates; no burial.

---

## 2. Gate catalog

| Gate | Purpose | Typical inputs | Default two-party |
|---|---|---|---|
| `DevComplete` | Dev work done, ready for QA | PM verdict, Product Review, no critical findings | No |
| `QAComplete` | QA pass achieved | QA Plan coverage, test runs, no critical bugs | No |
| `ReadyForStaging` | Safe to deploy to staging | Build green, RTD(staging) verdict, config validated | No |
| `ReadyToDeploy` | Safe to deploy to prod | RTD verdict, Security PASS, Reliability PASS, Release Readiness | **Yes** |
| `ReadyToPublish` | App/web launch ready | Launch Readiness 100%, Docs complete, Release Notes ready | **Yes** |
| `ReadyForGrowth` | Instrumented for activation/retention analysis | Growth Readiness, analytics coverage | No |

---

## 3. GateStatus schema

```jsonc
{
  "gate":        "ReadyToDeploy",
  "projectRoot": "/abs/path",
  "branch":      "main",                  // or null for project-wide

  "criteria": [
    {
      "id":        "rtd_not_blocked",
      "description": "RTD assessment verdict is not BLOCKED",
      "required":  true,
      "satisfied": true,
      "evidenceRef": { "kind": "run", "uri": "run_..." },
      "checkedAt": "ISO8601"
    }
  ],

  "blockers":  [ { "criterionId": "...", "summary": "...", "evidenceRef": {...} } ],
  "warnings":  [ { "criterionId": "...", "summary": "...", "evidenceRef": {...} } ],

  "overrides": [
    {
      "id":         "ovr_<ulid>",
      "by":         "usr_...",
      "role":       "release_manager",
      "reason":     "markdown — min 20 chars",
      "scope":      "this_run | until_expiry | branch:<name>",
      "expiresAt":  "ISO8601",
      "attachedEvidenceRefs": [...],
      "revokedBy":  "usr_...?",
      "revokedAt":  "ISO8601?",
      "revokeReason": "string?",
      "appliedAt":  "ISO8601"
    }
  ],

  "signOffs": [
    { "role": "release_manager", "by": "usr_...", "at": "ISO8601", "note": "string?" },
    { "role": "eng_lead",        "by": "usr_...", "at": "ISO8601", "note": "string?" }
  ],

  "state":           "green | yellow | red | overridden",
  "lastEvaluatedAt": "ISO8601",
  "nextAutoEvaluation": "ISO8601?",

  "policy": { ...GatePolicy }
}
```

### State rules

- `green`: all required criteria satisfied; warnings allowed.
- `yellow`: all required satisfied but warnings present AND `policy.warningsBlock = true` → becomes `red` instead.
- `red`: ≥ 1 required criterion unsatisfied.
- `overridden`: red or yellow, but an active unexpired override applies; UI renders distinct badge.

---

## 4. GatePolicy

```jsonc
{
  "allowedOverrideRoles":  ["release_manager", "eng_lead"],
  "requireEvidenceOnOverride": true,
  "minReasonLength":        20,
  "requireTwoParty":         true,
  "twoPartyRoles":           ["release_manager", "eng_lead"],
  "maxOverrideDuration":    "7d",
  "absoluteMaxOverride":    "30d",
  "warningsBlock":           false,
  "autoReevaluateEvery":    "1h",
  "requiredCriteria":       ["rtd_not_blocked", "security_pass", ...]
}
```

Policies shipped with `vac-web` at `packages/protocol/v1/gate_policies/<gate>.yaml`. User may create per-project overrides in `.vac-web/gate-policies/` (loaded at bridge startup, reviewed in `Gate → Settings` UI).

---

## 5. Default criteria per gate

### `DevComplete`
- `pm_no_critical`: Product Review has no `critical` findings. *required*
- `flow_coherent`: Flow Logic verdict not FAIL. *required*
- `frontend_completeness`: Frontend Review verdict not FAIL. *warning*

### `QAComplete`
- `qa_plan_defined`: QA Plan run exists and not stale. *required*
- `coverage_threshold`: Test coverage ≥ project threshold (default 70%). *required*
- `critical_tests_green`: No failing tests tagged critical. *required*

### `ReadyForStaging`
- `build_green`: Last CI build on branch succeeded. *required*
- `rtd_staging_not_blocked`: RTD(staging) verdict not BLOCKED. *required*
- `env_config_valid`: Staging env/secrets validated. *required*

### `ReadyToDeploy`
- `rtd_not_blocked`: RTD verdict not BLOCKED. *required*
- `security_pass`: Security Review PASS. *required*
- `reliability_pass`: Reliability Review PASS. *required*
- `release_readiness_ready`: Release Readiness verdict READY. *required*
- `rollback_plan_present`: Documented rollback plan exists. *required*
- `two_party_signed`: Two approvers signed (from `twoPartyRoles`). *required*

### `ReadyToPublish`
- `launch_checklist_complete`: Launch Readiness 100%. *required*
- `docs_complete`: Docs & Handoff no gaps. *required*
- `release_notes_ready`: Release notes document exists + published-ready. *required*
- `support_handoff_done`: Support handoff checklist complete. *required*
- `two_party_signed`: Two approvers signed. *required*

### `ReadyForGrowth`
- `analytics_coverage`: Growth Readiness analytics coverage ≥ threshold. *required*
- `activation_path_defined`: Primary activation path documented. *required*

---

## 6. Evaluation

Triggered by:
- User: `gate.evaluate { gate, scope }`.
- Stage: on CI build complete, on PR merged, on branch push to protected refs.
- Continuous: per `policy.autoReevaluateEvery`.
- On finding emitted that might affect a gate → auto-recheck.

Evaluation algorithm:
1. Load `GatePolicy` for gate.
2. For each criterion: resolve check function (runs in bridge; reads assessment run stores + connector data).
3. Mark `satisfied` / `unsatisfied` with `evidenceRef`.
4. Aggregate state (§3).
5. If overrides exist: apply active ones to mask red → `overridden`.
6. Emit `gate.state_changed { gate, before, after, reasons }`.
7. Persist to `~/.local/share/vac-web/gates/<project_hash>.json`.

Evaluation is **read-only** — no mutation, no agent invocation beyond pre-existing assessment runs.

---

## 7. Overrides

### Mechanics
- UI dialog requires: role confirmation, reason ≥ 20 chars, scope, expiry picker (bounded by policy).
- `gate.override { gate, reason, scope, expiresAt }`.
- Bridge validates:
  - User has one of `allowedOverrideRoles`.
  - Reason length ≥ `minReasonLength`.
  - `expiresAt - now ≤ maxOverrideDuration`.
  - (If `requireEvidenceOnOverride`) `attachedEvidenceRefs.length ≥ 1`.
- On success: override appended to `overrides[]`; state re-evaluated.

### Scope values
- `this_run` — applies to a single dispatch attempt; consumed on first use.
- `until_expiry` — applies globally within project until `expiresAt`.
- `branch:<name>` — applies only to specified branch.

### Revocation
- `gate.revoke_override { overrideId, reason }`.
- Any user in `allowedOverrideRoles` may revoke (not just original overrider).
- Appended to override with `revokedBy`, `revokedAt`, `revokeReason`.
- Gate state re-evaluates immediately.

### Limits
- At most one active override per (gate, scope) pair. Second request → error `gate.override_already_active { existingOverrideId }`.
- Override cannot revive a gate whose `requiredCriteria` include `two_party_signed` without actually having two sign-offs. Override of `two_party_signed` is forbidden (schema-enforced).

### Audit
`~/.config/vac-web/audit/gates/<project_hash>/<gate>.jsonl`:
```jsonc
{
  "ts": "...",
  "gate": "ReadyToDeploy",
  "event": "override_applied | override_revoked | state_changed | signoff_added",
  "by": "usr_...",
  "details": { ... }
}
```
Append-only, retained indefinitely. UI: `Gate → <gate> → Audit trail`.

---

## 8. Sign-offs

### Single-party sign-off
- `gate.signoff { gate, role }` → appended to `signOffs[]`.
- Note required if gate policy says so.

### Two-party
- First sign-off → gate state moves to `yellow` (or stays if criteria still unsatisfied).
- Second sign-off from different role → gate state reaches `green` if criteria also satisfied.
- If a criterion fails after signoff: sign-offs retained, gate re-evaluates; both sign-offs must be refreshed after criterion is re-satisfied (stale sign-offs expire 24h after gate state change).

### Sign-off vs override
| | Sign-off | Override |
|---|---|---|
| Purpose | Explicit approval when criteria satisfied | Bypass of failing criteria |
| Permission | Any named role | `allowedOverrideRoles` only |
| Required input | Role, optional note | Role, reason ≥ 20 chars, expiry, optional evidence |
| Typical use | Normal green-path | Emergency release, documented exception |

Both are independently auditable.

---

## 9. UI surfacing

### Gate ribbon (Topbar, always visible)
- Chips for all gates relevant to current project.
- Colors per state: green / yellow / red / overridden (distinct purple hue with ⚠ icon).
- Click → gate detail drawer.

### Gate detail drawer
- Criteria list with satisfied badges + evidence chips.
- Blockers section (red) with CTAs: "Open source assessment", "Create handoff for fixes".
- Warnings section (yellow).
- Overrides section with active + historical.
- Sign-offs section.
- Audit trail link.
- Actions: `Re-evaluate now`, `Override`, `Sign off`, `Revoke override`.

### Release plane integration
- `Release → Deploy` surface refuses to offer deploy CTA if `ReadyToDeploy` ≠ green/overridden.
- Publish surface refuses if `ReadyToPublish` ≠ green/overridden.

### Notifications
On gate state change → `notify.event { lane: persistent, severity: by state, subsystem: "gate.<name>" }`.

---

## 10. Integration with assessments

When an assessment emits findings/verdict that match a gate's criteria, bridge:
1. Triggers `gate.evaluate` for each affected gate (debounced).
2. If state changed, emits `gate.state_changed`.
3. If gate becomes `green` from `red`: emit `notify.event` to `persistent` lane (user can choose to pin to `sticky`).

Assessment's `RemediationPlan` tasks can be filtered by "only tasks blocking this gate" to produce a focused handoff.

---

## 11. Continuous mode

With `policy.autoReevaluateEvery` set:
- Bridge schedules re-evaluation periodically.
- Each evaluation uses **existing** assessment run data; does not trigger new runs automatically.
- Stale runs (past `fresh_until`) → corresponding criterion marked `stale`, listed in warnings.
- UI offers "Refresh assessments" CTA when staleness detected.

---

## 12. Related

- [`assessment-contract.md`](./assessment-contract.md) — source verdicts.
- [`handoff-contract.md`](./handoff-contract.md) — handoff chaining for gate-driven work.
- [`capability-profiles.md`](./capability-profiles.md) — role definitions.
- [`evidence-freshness.md`](./evidence-freshness.md) — staleness effects on criteria.
- [`ux-grammar.md`](./ux-grammar.md) — gate chip grammar.
- [`protocol.md`](./protocol.md) §3.15, §4.12 — command/event envelopes.
