# Plan 31 — RTD + PM swarms

**Phase**: 4 · **Depends on**: Plans 26, 27 + upstream PR #7 · **Blocks**: Phase 4 exit · **Est**: 3 days

## Goal

Author the two initial assessor swarms: RTD (Ready to Deploy — 5 agents + release_gate synthesizer) and PM (Product Review — 7 agents + pm_synthesizer). Define their prompts, check catalogs, and depth activation per `assessment-contract.md §9`.

## Why this is hard

Prompt engineering is iterative and empirical. "Kualitatif" here means: each agent has a narrow responsibility, a tight prompt, a curated set of allowed tools, a clear output schema. Avoid the temptation to make each agent a mini-product; they should be laser-focused checks.

## Scope

### In
- Swarm catalogs under `vastar-agentic-cli/crates/vac_core/assets/swarms/`:
  - `assessor.rtd.yaml`
  - `assessor.pm.yaml`
- Per-agent prompts in markdown.
- Check catalogs documenting each check's depth activation + expected evidence kinds.
- Synthesizer prompts + scoring rules.
- Evaluation fixtures (repos with known issues for regression testing).

### Out
- Remaining 10 families (Plan 36 playbook).
- Tuning / ML-based threshold calibration (post-v1).

## Deliverables

```
vastar-agentic-cli/crates/vac_core/assets/swarms/
├── assessor.rtd.yaml
├── assessor.rtd/
│   ├── devops_readiness.md     # per-agent prompt
│   ├── reliability.md
│   ├── observability.md
│   ├── security.md
│   ├── performance_capacity.md
│   └── release_gate.md         # synthesizer
├── assessor.pm.yaml
└── assessor.pm/
    ├── flow_logic.md
    ├── frontend_completeness.md
    ├── ui_consistency.md
    ├── ux_friction.md
    ├── business_process.md
    ├── business_concept.md
    ├── analytics_experimentation.md
    └── pm_synthesizer.md

packages/protocol/v1/checks/
├── rtd.md
└── pm.md

tests/fixtures/swarms/
├── repo-known-rtd-blocker/    # fixture repo with known critical finding
├── repo-known-pm-gap/
└── repo-clean/
```

## Stages

### S1 — Swarm catalog schema (0.2 day)

```yaml
# assessor.rtd.yaml
family_id: assessor.rtd
profile_id: assessor.rtd@1.0.0
version: 1.0.0
synthesizer: release_gate
agents:
  - id: devops_readiness
    prompt_file: devops_readiness.md
    depth_activation: [quick, standard, full]
    checks:
      - ci_pipeline_valid
      - env_separation
      - secrets_managed
      - ...
  - id: reliability
    ...
```

Each check declares:
- `id`
- `title`
- `severity_default`
- `depth_activation` (quick/standard/full)
- `expected_evidence_kinds`
- `description` (short for user UI)

**Exit**: catalog validated against schema.

### S2 — RTD agents: prompts (0.8 day)

**devops_readiness**: CI config, deployment pipelines, env separation, secrets hygiene, infra prerequisites, rollback mechanism, migration safety.

Prompt shape:
```
You are a DevOps Readiness Assessor. READ-ONLY. You will NOT edit, commit, or deploy.

Inputs:
- Project root at <path>.
- Connectors: github, ci, vercel (as available).

Your job:
- Enumerate deployment pipelines (actions, gitlab-ci, etc.).
- Verify env separation (staging vs prod).
- Check secrets (.env.production, vault refs, missing vars declared in code).
- Assess rollback mechanism presence.
- ...

For each issue found:
1. Capture evidence via `evidence.capture` (file + ci run + repo config).
2. Emit finding via `finding.emit` with:
   - category: devops
   - subsystem: <specific>
   - severity: based on impact (critical if secrets exposed, high if no rollback, ...)
   - confidence: based on how directly evidenced
   - suggested_fix.steps: concrete changes

Do NOT propose or make code changes. You are not allowed to call any mutation tool.
```

Similar depth of prompt per agent. Each ~150-250 words.

**reliability**: crash risk, retry/idempotency, failure modes, health checks, timeout/circuit breakers, blast radius.

**observability**: logs, metrics, traces, alerts, dashboards, business-event instrumentation.

**security**: dependency vulns (via Snyk/Dependabot), auth/authz gaps, secrets exposure, common class risks.

**performance_capacity**: heavy queries, frontend asset weight, cold start, N+1 patterns, scale assumptions.

**Exit**: each prompt reviewed + reduced to minimum viable shape.

### S3 — release_gate synthesizer prompt (0.3 day)

```
You are the RTD Synthesizer. Inputs: all findings from peer agents.

Your job:
1. Cluster related findings.
2. Assign final severity per category — upgrade if multiple high findings compound; downgrade if evidence is thin.
3. Compute verdict:
   - BLOCKED: any critical finding without compensating override context; OR ≥ 3 high findings in same category.
   - CONDITIONAL: any high finding OR ≥ 5 medium findings total.
   - READY: otherwise.
4. Produce verdict.summary (markdown, ≤ 500 chars).
5. Emit verdict via `verdict.emit`.
6. Optionally emit RemediationPlan with task groups.

DO NOT invent new findings. You synthesize existing ones.
```

**Exit**: synthesizer prompt reviewed.

### S4 — PM agents: prompts (0.8 day)

Similar discipline. Focus:

- **flow_logic**: state transitions, happy/unhappy paths, dead-ends, contradictions.
- **frontend_completeness**: screen coverage, missing states (empty/loading/error), responsive gaps.
- **ui_consistency**: visual consistency, component reuse, spacing, copy.
- **ux_friction**: excessive steps, unclear CTAs, cognitive overload.
- **business_process**: alignment with stated process, role/approval logic.
- **business_concept**: value prop clarity, user segment fit, "buildable but pointless" detection.
- **analytics_experimentation**: event tracking coverage, funnel measurability.

Each: inputs may include Notion PRDs, Figma files, repo.

**Exit**: 7 prompts authored.

### S5 — pm_synthesizer prompt (0.2 day)

Cluster + produce PM scorecard with sub-scores per dimension. Verdict status based on presence of FAIL-level findings + overall score.

**Exit**: prompt authored.

### S6 — Check catalog docs (0.3 day)

`packages/protocol/v1/checks/rtd.md`:
```markdown
# RTD check catalog

## ci_pipeline_valid [quick|standard|full]
Verifies the project has a CI pipeline that covers the primary build + test.

Expected evidence:
- file (CI config: .github/workflows/*, .gitlab-ci.yml, .circleci/config.yml)
- connector:ci (most recent pipeline run)

Severity guidance:
- No CI → high
- CI exists but never runs on main → medium
- CI runs but most recent red → critical (blocker)

## env_separation [standard|full]
...
```

User-facing; surfaced in `Open check details` from UI.

**Exit**: catalog complete for RTD + PM.

### S7 — Fixtures + regression tests (0.4 day)

`tests/fixtures/swarms/repo-known-rtd-blocker/`: a fake repo checked into test fixtures with:
- No CI file.
- `.env.production` committed with a placeholder-looking secret.
- No rollback docs.

Test: run RTD on this fixture → assert findings for `ci_pipeline_missing` (high), `secrets_in_repo` (critical), `rollback_missing` (high) emitted. Verdict BLOCKED.

`tests/fixtures/swarms/repo-clean/`: fixture with everything OK → verdict READY.

`tests/fixtures/swarms/repo-known-pm-gap/`: simulates missing empty states, loading states.

Run as part of CI (slower tier; nightly or optional).

**Exit**: fixtures run green; intentional breakages detected.

### S8 — Cost + latency budgets (0.1 day)

Document expected token usage per depth:
- RTD quick: ~5k tokens, ≤ 60s.
- RTD standard: ~20k tokens, ≤ 5min.
- RTD full: ~80k tokens, ≤ 30min.
- PM: similar order-of-magnitude.

Telemetry counter: tokens per run visible in Session audit.

**Exit**: budgets documented.

### S9 — Iteration plan (0.1 day)

v1 prompts are starting points. Schedule:
- Run on 10 real projects post-GA.
- Collect false-positive + false-negative rates.
- Tune quarterly.

Establish prompt version bumps (e.g., `assessor.rtd.devops_readiness@1.0.0`) so regression fixtures track which version was tested.

**Exit**: iteration plan documented.

## Testing

- Fixture-based regression in CI.
- Manual run on 3 real repos; verdict reviewed by domain expert.
- No write tool ever invoked (assert via audit).

## Exit criteria

- [ ] Both swarms run end-to-end on real projects.
- [ ] Fixtures pass.
- [ ] Verdict matches expert review on sampled repos.
- [ ] No assessor writes anything (audit clean).
- [ ] Token budgets met.

## Risks

| Risk | Mitigation |
|---|---|
| Agents invent findings without evidence | Prompt + serializer rejection |
| High false-positive rate erodes trust | Fixture-driven regression; tunable thresholds |
| Synthesizer too conservative / too permissive | A/B sampling; explicit calibration pass |
| Prompts drift from agent capability (missing tools) | Capability check: prompt references only tools in profile |

## Related

- [`assessment-contract.md`](../../assessment-contract.md)
- Plan 26 — run manager
- Plan 27 — evidence capture
- Plan 36 — remaining families playbook
