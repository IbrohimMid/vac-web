# Assessment Contract

**Status**: v1 (locked for Phase 0.5)
**Scope**: Defines the data model, lifecycle, and behaviours of `AssessmentRun`, `AssessmentFinding`, `AssessmentVerdict`, `AssessmentDiff`, and the synthesizer contract. Applies to all assessor families.

---

## 1. Principles

1. **Read-only**. No assessor may mutate filesystem, repo, or external state. Enforced at profile layer (see `capability-profiles.md`).
2. **Evidence-first**. A finding without at least one `EvidenceRef` is rejected at serialization.
3. **Deterministic identity**. Each finding has a stable hash enabling cross-run comparison.
4. **Composable**. Families share a base schema; variations are additive, never replacing required fields.
5. **Reproducible**. A run can be replayed on the same scope + pin → findings match modulo timing-dependent evidence (e.g., live metrics).

---

## 2. AssessmentRun

### Schema

```jsonc
{
  "id":         "run_<ulid>",
  "type":       "RTD | PM | UX | Frontend | Security | Reliability | Perf | Release | Launch | QA | Docs | Growth",
  "familyId":   "assessor.rtd | assessor.pm | ...",
  "profileId":  "assessor.rtd@1.0.0",
  "profileHash": "sha256:...",

  "scope": {
    "projectRoot":  "/abs/path",
    "repoRef":      "branch:feature/x | tag:v1.2 | sha:abc123",
    "baseCommitSha": "abc123...",
    "diffRange":    "main..HEAD",          // optional
    "pathGlobs":    ["src/**/*.ts"],       // optional; whole repo if absent
    "depth":        "quick | standard | full"
  },

  "connectorSnapshots": [
    { "connectorId": "github:vastar/x", "kind": "github",
      "snapshotId": "gh_snap_01J...", "capturedAt": "2026-04-24T...",
      "etag": "W/\"abc\"" }
  ],

  "triggeredBy": {
    "kind":      "user | stage | continuous | orchestrator",
    "userId":    "usr_...",
    "sourceRef": "pr:123 | gate:ReadyToDeploy | ..."
  },

  "status":    "pending | running | completed | failed | cancelled",
  "startedAt": "ISO8601",
  "completedAt": "ISO8601?",
  "cancelledReason": "string?",

  "verdict": { ...AssessmentVerdict },   // populated on completion

  "counts": {
    "findings": { "critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0 },
    "evidence": 0,
    "toolCalls": 0
  },

  "sessionId": "sess_..."                  // bridge session hosting this run
}
```

### Lifecycle

```
session.create (profile=assessor.*)
    ↓
assessment.run { type, scope, depth }
    ↓
status: pending → running
    ↓
stream: assessment.started / .progress / .finding_added / .evidence_attached
    ↓
(optional) assessment.evidence_stale_detected
    ↓
synthesizer emits verdict
    ↓
assessment.completed { verdict, counts }
    ↓
status: completed
    ↓
(optional) assessment.replay → new run with baseRunId linkage
```

### Cancellation
- `assessment.cancel { runId }`: bridge signals agent supervisor; supervisor emits termination to all active checks.
- Partial findings retained; status → `cancelled`; verdict omitted or marked `partial`.

### Failure
- Bridge or agent fatal error → `assessment.failed { error }`; status → `failed`. Partial findings retained for diagnostics.

### Retention
- Runs stored at `~/.local/share/vac-web/runs/<run_id>.json`.
- Default retention: 90 days. User can pin individual runs.

---

## 3. AssessmentFinding

### Schema

```jsonc
{
  "id":         "fnd_<ulid>",
  "runId":     "run_<ulid>",
  "familyId":  "assessor.rtd",
  "category":  "devops | reliability | observability | security | perf | flow | frontend | ui | ux | business | analytics | qa | docs | launch | growth",
  "subsystem": "ci | secrets | logging | auth | ...",   // domain-specific

  "severity":   "critical | high | medium | low | info",
  "confidence": 0.85,                      // 0..1

  "title":        "short one-liner",
  "description":  "markdown",
  "rationale":    "markdown — why this matters",

  "evidence": [
    { ...EvidenceRef, required: 1+ }
  ],

  "suggestedFix": {                        // optional
    "rationale": "markdown",
    "steps":     ["step 1", "step 2"],
    "diffHint":  "unified diff fragment?", // optional illustrative diff
    "executorProfileHint": "executor.code | executor.release"
  },

  "fixability":  "auto | assisted | manual",
  "ownerHint":   "role or team string?",
  "tags":        ["quick-win", "rollback-safety"],

  "identityHash": "sha256:<category|subsystem|normalizedTitle|primaryEvidenceLocator>",

  "createdAt":   "ISO8601",
  "emittedBy":   "agent_id"
}
```

### Identity hash

Stable hash used to match findings across runs for diffing.

```
identityHash = sha256(
  familyId + "|" +
  category + "|" +
  subsystem + "|" +
  normalize(title) + "|" +
  primaryEvidenceLocator
)

normalize(s) = lowercase, collapse whitespace, strip punctuation,
               stem well-known token variations (e.g., v1/v2 → vX)
primaryEvidenceLocator = evidence[0].uri + (locator.range || "")
```

Rules:
- Two runs finding "the same issue in the same place" MUST produce matching `identityHash`.
- If title rewording drifts, synthesizer SHOULD normalize before hashing.
- Hash inputs are documented per-family in `packages/protocol/v1/finding_identity.md` when family-specific normalization is needed.

### Severity definitions

| Severity | Meaning | Gate impact |
|---|---|---|
| `critical` | Blocks production. Data loss, security breach, total outage risk. | Auto-blocker on `ReadyToDeploy`, `ReadyToPublish` |
| `high` | Significant user or business impact. Should block unless explicit override. | Default blocker; overridable with reason |
| `medium` | Notable issue, should fix before release but not blocking. | Warning |
| `low` | Minor polish, tech debt. | Informational |
| `info` | Observation, not a problem per se. | Informational |

### Confidence

Signals how certain the agent is:
- `≥ 0.9` — high; directly evidenced.
- `0.7–0.89` — solid inference.
- `0.5–0.69` — tentative; needs human review.
- `< 0.5` — speculative; emitted only for `info` severity.

Stale evidence auto-discounts: `confidence *= 0.5` on any `hard_expire` evidence past `fresh_until` (see `evidence-freshness.md`).

### Validation rules

Serializer rejects findings where:
- `evidence.length < 1`.
- `severity = critical` and `confidence < 0.7`.
- `suggestedFix.executorProfileHint` references a non-existent profile.
- `identityHash` missing or empty.
- `title.length > 120` chars.

---

## 4. AssessmentVerdict

### Schema

```jsonc
{
  "status":  "READY | CONDITIONAL | BLOCKED | PASS | WARN | FAIL",
  "score":   0.82,                     // 0..1, family-specific scoring
  "summary": "markdown, ≤ 500 chars",
  "blockers":    [ "fnd_..." ],        // finding ids that block
  "warnings":    [ "fnd_..." ],
  "topWins":     [ "fnd_..." ],        // positive observations if emitted
  "synthesizerAgentId": "agent_..."
}
```

### Status mapping by family

| Family | Status values |
|---|---|
| RTD | `READY / CONDITIONAL / BLOCKED` |
| Release | `READY / CONDITIONAL / BLOCKED` |
| Security | `PASS / WARN / FAIL` |
| Reliability | `PASS / WARN / FAIL` |
| Perf | `PASS / WARN / FAIL` |
| PM, UX, Frontend | score-based (no binary status); `WARN / FAIL` for hard violations |
| Launch, QA, Docs, Growth | completion-percentage based; plus `WARN / FAIL` for critical gaps |

Synthesizer MUST document the scoring function per family in `packages/protocol/v1/verdict_scoring.md`.

---

## 5. Synthesizer contract

Every family has exactly one synthesizer agent (e.g., `assessor.rtd.release_gate`, `assessor.pm.synthesizer`).

Responsibilities:
1. Receive all peer findings for the run (via bridge-managed channel).
2. Merge duplicates (same `identityHash`) keeping highest severity + strongest evidence.
3. Cluster related findings into groups (optional; for `RemediationPlan`).
4. Compute verdict per family scoring function.
5. Emit `assessment.completed { verdict, counts }`.
6. Optionally emit `RemediationPlan` (§6).

Constraints:
- Synthesizer MUST NOT introduce new findings; it aggregates.
- If a family-specific check was skipped (connector unavailable), synthesizer MUST note it in `summary` and may downgrade confidence in `verdict`.

---

## 6. RemediationPlan

Optional but recommended output from synthesizer.

### Schema

```jsonc
{
  "id":      "plan_<ulid>",
  "runId":   "run_...",
  "groups": [
    {
      "title":     "Fix secrets hygiene",
      "rationale": "markdown",
      "tasks": [
        {
          "id":        "task_<ulid>",
          "title":     "Move .env.production to vault",
          "rationale": "markdown",
          "evidenceRefs":  [...],
          "steps":     ["...", "..."],
          "constraints": ["no downtime", "rollback within 5m"],
          "riskNotes": ["may trigger full deploy cycle"],
          "estEffort": "hours | days | weeks",
          "dependsOn": ["task_..."]
        }
      ]
    }
  ],
  "totalEffort": "string estimate",
  "impactSummary": "markdown",
  "dependencyGraph": { ... }               // DAG form for UI
}
```

`RemediationPlan.tasks` become the blueprint for a `HandoffPacket.tasks[]` when user converts to handoff.

---

## 7. AssessmentDiff

Produced when user requests comparison between two runs of the same `familyId` + compatible `scope`.

### Schema

```jsonc
{
  "id":       "diff_<ulid>",
  "baseRunId": "run_...",
  "headRunId": "run_...",
  "familyId":  "assessor.rtd",

  "resolved":   [ { "findingId": "fnd_...", "resolutionEvidence": [...] } ],
  "persistent": [ { "findingId": "fnd_...", "unchangedReason": "string?" } ],
  "regressed":  [ { "findingId": "fnd_...", "severityBefore": "high", "severityAfter": "critical", "driftEvidence": [...] } ],
  "new":        [ { "findingId": "fnd_..." } ],

  "verdictDelta": {
    "before": { ...AssessmentVerdict },
    "after":  { ...AssessmentVerdict },
    "direction": "improved | same | worsened"
  },

  "convergenceCounter": 2,                 // increments when handoff chain not improving

  "computedAt": "ISO8601"
}
```

### Matching algorithm

1. For each finding in `head`, look up `identityHash` in `base`:
   - Found, severity unchanged → `persistent`.
   - Found, severity worsened → `regressed`.
   - Found, severity improved or removed → handled by base-iter below.
2. For each finding in `base` not matched in head:
   - If re-run shows evidence of fix → `resolved` (requires resolution evidence — at least re-emitting a passing check).
   - Else → `persistent` fallback (carry forward; may be `regressed` if severity changed).
3. New head findings with no base match → `new`.

### Convergence guard

- `convergenceCounter` increments when a handoff targeting findings in `base` does not move the needle (`direction = same | worsened`) after dispatch + reassess.
- At `convergenceCounter >= 3`: orchestrator emits `notify.event { severity: warn, message: "Reassess stuck", actionId: "escalate_manual_review" }`.
- UI shows banner in AssessmentReport with option to break loop.

---

## 8. Evidence pipeline

See `evidence-freshness.md` for full `EvidenceRef` schema + freshness policy.

Runtime contract (bridge):
1. Agent calls `evidence.capture { kind, uri, locator? }`.
2. Bridge fetches + hashes + stores in `~/.cache/vac-web/evidence/<hash>`.
3. Returns `EvidenceRef` with `observedAt`, computed `freshUntil`, policy per kind.
4. Agent references `EvidenceRef.id` in subsequent `finding.emit` calls.
5. Serializer verifies every referenced evidence exists + attaches snapshot.

Evidence is **immutable once captured**. Re-capture produces a new ref.

---

## 9. Depth levels

| Depth | Meaning | Typical runtime budget |
|---|---|---|
| `quick` | Smoke-level pass; top-10 checks per family; single connector pull | ≤ 60s |
| `standard` | All default checks per family; connectors queried once | ≤ 5 min |
| `full` | All checks + optional expensive ones (e.g., full-diff perf bench, deep dependency tree walk) | ≤ 30 min |

Family-specific check catalogs live in `packages/protocol/v1/checks/<family>.md`. Each check declares which depth levels include it.

---

## 10. Scope resolution

### `scope.projectRoot`
Absolute path. Must be in bridge's project allowlist.

### `scope.repoRef` / `scope.baseCommitSha`
Bridge resolves at run start:
- `branch:<name>` → current sha of branch.
- `tag:<name>` → sha of tag.
- `sha:<hex>` → validated exists.
- Absent → current `HEAD`.

`baseCommitSha` captured at run start is stored in `AssessmentRun.scope.baseCommitSha` for reproducibility. If repo changes during run, agent may encounter stale data; evidence captures lock individual file shas.

### `scope.diffRange`
For families that operate on deltas (e.g., PR review mode): `<base>..<head>` git syntax. Agents scope reads to changed files only.

### `scope.pathGlobs`
Whitelist of paths agents may read. Bridge enforces at `read_file` layer.

---

## 11. Multi-family orchestration

User can trigger multiple families at once:
- UI: "Readiness Hub → Run all" executes RTD + PM + UX + Security in parallel.
- Each is an independent `AssessmentRun` with its own `sessionId`.
- Top-level orchestrator run-group id (`runGroupId`) optional in payload for UI grouping.

No cross-family finding sharing. A finding emitted by RTD is not visible to PM's agents. Synthesis stays within family.

---

## 12. Determinism & reproducibility

- Agent prompts + tool call order are logged per run.
- Same scope + same profile + same connector snapshots should produce materially-same findings.
- "Materially same" = same `identityHash` set; minor wording / confidence drift acceptable.
- Replay (`assessment.replay`) re-runs the same swarm against current state, uses original run as `baseRunId`.

---

## 13. Storage & export

### Local storage
`~/.local/share/vac-web/runs/<run_id>.json` — full `AssessmentRun` + findings + verdict + plan.

### Export formats
- Markdown report (for humans).
- JSON blob (for CI / tooling).
- CSV findings table (for spreadsheet analysis).
- Handoff packet (via `handoff.export_blueprint`).

Command: `assessment.fetch_report { runId, format: markdown|json|csv|blueprint }`.

---

## 14. Related

- [`capability-profiles.md`](./capability-profiles.md) — enforcement of assessor read-only.
- [`handoff-contract.md`](./handoff-contract.md) — conversion to executor work.
- [`evidence-freshness.md`](./evidence-freshness.md) — EvidenceRef lifecycle.
- [`gates.md`](./gates.md) — how verdicts feed gate evaluation.
- [`protocol.md`](./protocol.md) §3.13, §4.10 — command/event envelope.
