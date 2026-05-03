# `vac-web` — Product Requirements Document

**Status**: v1 (locked for Phase 0.5)
**Owner**: product + architecture
**Audience**: engineering, design, security reviewers, future contributors

---

## 1. Vision

> `vac-web` is an **end-to-end delivery cockpit** that takes a software project from build → assessment → handoff → release. It combines a local-first agentic coding workspace with a read-only swarm of specialist assessors (product, UX, security, ops) that generate evidence-based findings. Findings become formal handoff packets that an executor can act on with user approval. The goal is not "chat with AI about code" — it is **"close the loop from idea to production-ready."**

### One-sentence positioning
A web cockpit for shipping software: build with agents, audit with specialist swarms, release with confidence.

### Differentiators
- **Assessor/executor split** — mutation requires approved handoff; structural, not prompted.
- **Evidence-first findings** — no finding ships without a verifiable `EvidenceRef`.
- **Gate system** — formal release readiness across technical, product, UX, ops, launch.
- **Local-first** — execution happens on user's machine; browser is a control plane.
- **Reassess loop** — diff-aware reassessment produces `resolved / persistent / regressed / new` findings.

---

## 2. Target users & jobs-to-be-done

### Personas

| Persona | Core job-to-be-done | Primary surfaces |
|---|---|---|
| **Solo builder / indie dev** | "Ship a working, non-embarrassing product without a team." | Build + Readiness Hub + Launch Readiness |
| **Founder (semi-technical)** | "Know if this is actually shippable and what's missing." | Guided mode + Product Review + Gate ribbon |
| **Staff engineer** | "Run rigorous pre-deploy audits before releasing to prod." | RTD + Security + Reliability + Release |
| **PM / product lead** | "Validate flow, UX, business logic before eng wastes cycles." | Product Review + UX Review + Handoff |
| **DevOps / release manager** | "Own the gate to production." | RTD + Gates + Release plane |
| **Design reviewer** | "Audit frontend completeness & UX friction." | UX Review + Frontend Review |

### Non-users (v1)
- Teams requiring multi-tenant cloud SaaS — out of scope; v1 is local-first.
- Regulated environments needing SOC 2 / HIPAA controls — out of scope until Phase 7+.

---

## 3. Core flow

```
Build → Assess → Handoff → Approve → Execute → Reassess → Release
```

Explicit guarantees:
- Assessment never mutates. Ever.
- No "agent A calls agent B to fix it." Findings cross the boundary only as data, via a `HandoffPacket`.
- Execution runs under a pinned capability profile with two-layer enforcement.
- Release gates can be overridden but override is audited, time-bound, role-restricted.

---

## 4. Planes & features

### 4.1 Build Plane

Primary agentic coding workspace. Direct descendant of VAC TUI UX grammar.

**Capabilities**
- Streaming chat transcript with slash commands, @mentions, paste tray, command palette.
- Executor tool calls with per-tool approval (risk badges, diff preview).
- Review tab: changeset diff viewer with hunk fold, revert file / revert all.
- Sessions: list, resume (snapshot), rename, close.
- Runtime: background jobs, cron, file watchers — live log.
- Shell drawer: xterm.js PTY panel on demand.
- Plan: step-by-step task roadmap, editable, approvable.
- Agents: browse available agent profiles per project.
- Workbench tabs: `Approvals · Review · Sessions · Agents · Runtime · Plan · VIL · VWFD · Signal · Memory`.

**Profile**: `executor.code@1.0.0` (default for interactive build sessions).

### 4.2 Assessment Plane

All swarms here are **read-only** (see `capability-profiles.md`).

#### User-facing surfaces

| UI label | Internal family | Verdict type |
|---|---|---|
| **Ready to Deploy** | `assessor.rtd.*` | `READY / CONDITIONAL / BLOCKED` |
| **Product Review** | `assessor.pm.*` | scorecard + severity findings |
| **UX Review** | `assessor.ux.*` | friction findings + improvement list |
| **Frontend Review** | `assessor.frontend.*` | completeness + consistency findings |
| **Security Review** | `assessor.security.*` | `PASS / WARN / FAIL` |
| **Reliability Review** | `assessor.reliability.*` | `PASS / WARN / FAIL` |
| **Performance Review** | `assessor.perf.*` | `PASS / WARN / FAIL` |
| **Release Readiness** | `assessor.release.*` | `READY / CONDITIONAL / BLOCKED` |
| **Launch Readiness** | `assessor.launch.*` | checklist completion % |
| **QA Plan** | `assessor.qa.*` | coverage risk map |
| **Docs & Handoff** | `assessor.docs.*` | gap list |
| **Growth Readiness** | `assessor.growth.*` | instrumentation coverage |

#### Shared behaviours
- Every finding carries ≥ 1 `EvidenceRef` (enforced at serializer).
- Findings have stable identity hash for diff across runs.
- Depth picker: `quick / standard / full`.
- Scope picker: whole project / branch / diff range / specific paths.
- Connector evidence honours freshness policy (`evidence-freshness.md`).
- Reassessment produces `AssessmentDiff { resolved, persistent, regressed, new, verdict_delta }`.

#### Readiness Hub
Central page summarising: Technical (RTD), Product (PM), UX, Release, Ops. Each card shows verdict, last-run-at, blocker count, CTAs: Run again · Open report · Create handoff.

### 4.3 Handoff Plane

Formal artefact pipeline from assessment findings to executor work.

**Capabilities**
- Select N findings from ≥ 1 assessment runs → `handoff.create`.
- Packet builder UI: reorder tasks, edit rationale, attach constraints.
- Pin block auto-populated: `repo_ref`, `base_commit_sha`, `worktree_digest`, connector snapshots.
- Approval dialog: role-aware, reason required for sensitive targets.
- Dispatch picker: **explicit profile selection** (`executor.code` vs `executor.release`).
- Live execution view while executor runs.
- Reassessment auto-trigger on completion.
- Invalidation on drift: `strict` (any worktree change) vs `lenient` (only protected paths).

### 4.4 Release Plane

Post-build surfaces for actually shipping.

**Features**
- **Deploy**: dispatch table to deployment targets; shows RTD gate status + last deploy info.
- **Publish**: app store / web launch readiness consolidated.
- **Runbooks**: generate + edit operational runbooks (executor.release scope).
- **Release Notes**: auto-generate from commits + handoffs + decisions.
- **Post-release Monitor**: attach Sentry/Datadog observations; surface anomalies.

### 4.5 Knowledge & Connector Plane

Read-only (by default) adapters to external context sources.

**v1 connectors**: GitHub, Notion, Linear, Figma, Sentry, Datadog, Vercel, Cloudflare, PostHog, GA4, Mixpanel, Snyk, Dependabot, Lighthouse CI, PagerDuty, Grafana, generic CI (GitHub Actions, GitLab CI, CircleCI).

**Capabilities**
- `connector.connect` OAuth / token flow.
- Per-connector health + rate-limit display.
- Evidence freshness policy per connector kind.
- Write capability (when explicitly enabled per profile): GitHub PRs, Notion release notes pages, Linear/Jira ticket updates.

See `connectors.md` for protocol-level contracts.

### 4.6 Orchestrator

Meta-layer over the planes. Four modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| **On-demand** | User clicks "Ready to Deploy?" etc. | Run relevant swarm synchronously |
| **Stage-based** | PR merged / branch complete / pre-deploy hook | Auto-run relevant assessments |
| **Continuous** | Background | Maintain live readiness score; detect regression |
| **Guided** | New project / founder mode | Wizard picks swarm set based on project type + release goal |

---

## 5. Gate system

Formal release checkpoints with governance.

| Gate | Typical inputs | Typical blockers |
|---|---|---|
| **DevComplete** | PM Review, Product Review verdicts | unresolved critical product findings |
| **QAComplete** | QA Plan coverage, test runs | coverage < threshold, red tests |
| **ReadyForStaging** | Build green, RTD (staging config) | infra/config evidence missing |
| **ReadyToDeploy** | RTD verdict, Security Review, Reliability | any `BLOCKED` assessor verdict |
| **ReadyToPublish** | Launch Readiness, Docs complete, Release Notes ready | checklist < 100%, missing runbook |
| **ReadyForGrowth** | Growth Readiness, analytics coverage | critical event gaps |

Governance (see `gates.md`):
- Two-party approval for `ReadyToDeploy`, `ReadyToPublish`.
- Override requires role in `allowed_override_roles`, reason ≥ 20 chars, expiry ≤ 7d default (30d hard cap).
- Every override append-only logged.

---

## 6. User experience principles

1. **Click-first, keyboard-equal** — every action via mouse, mirror via keyboard. No pure keyboard-only features.
2. **Evidence clickable** — every finding's evidence chip opens its source in a side panel or new tab.
3. **Cold by default** — long transcripts freeze; only hot window is live.
4. **No silent mutation** — any mutation that reaches the filesystem or repo passes through a visible approval.
5. **Gate visibility persistent** — gate ribbon always present in Topbar; never buried.
6. **Depth explicit** — user always picks quick / standard / full.
7. **Profile-aware UI** — actions that are denied by current session profile are greyed with hover tooltip explaining denial.
8. **Audit accessible** — `Sessions → <session> → Audit log` is always one click away.

See `ux-grammar.md` for severity glyph, subsystem labels, notify lanes.

---

## 7. Feature matrix by phase

| Feature area | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 | Phase 7 |
|---|---|---|---|---|---|---|---|
| Bridge daemon + WS protocol | ✅ | | | | | | |
| Build plane core (transcript, composer, palette) | | ✅ | | | | | |
| Workbench: Approvals, Review, Sessions, Runtime | | | ✅ | | | | |
| Shell drawer (xterm.js) | | | ✅ | | | | |
| Assessment plane MVP (RTD + PM) | | | | ✅ | | | |
| Readiness Hub | | | | ✅ | | | |
| Evidence pipeline + freshness | | | | ✅ | | | |
| Gate system (DevComplete, ReadyToDeploy) | | | | ✅ | | | |
| Handoff builder + approval | | | | | ✅ | | |
| Handoff dispatch → executor | | | | | ✅ | | |
| Reassess loop + AssessmentDiff | | | | | ✅ | | |
| Remaining assessors (UX, Security, Reliability, Perf) | | | | | | ✅ | |
| Release plane (Deploy, Publish, Runbooks) | | | | | | ✅ | |
| Launch + Growth readiness | | | | | | ✅ | |
| Hosted dispatch (remote attach) | | | | | | | ✅ |
| Continuous readiness watchdog | | | | | | | ✅ |
| `executor.migration` profile | | | | | | | ✅ |

---

## 8. Success criteria

### Phase 4 (Assessment MVP) exit criteria
- [ ] User can run RTD on a real repo; verdict delivered ≤ 3 min for standard depth.
- [ ] Every finding has ≥ 1 clickable `EvidenceRef`.
- [ ] Red-team matrix passes in CI (see `capability-profiles.md §11`).
- [ ] Connector writes remain zero during any assessor run (verified in audit log).
- [ ] Stale evidence visibly badged in UI.
- [ ] `bench:findings` passes with 10k findings virtualized.

### Phase 5 (Handoff loop) exit criteria
- [ ] Full loop demo: RTD finding → accept → handoff → approve → dispatch → executor fix → reassess → verdict improves.
- [ ] Handoff pin invalidation tested (worktree drift → `handoff.invalidated`).
- [ ] `AssessmentDiff` correctly categorises resolved/persistent/regressed/new.
- [ ] Convergence guard fires after 3× stuck handoff chain.

### v1 GA criteria
- All phases 1–6 exit criteria met.
- Documentation complete for all planes.
- Security review sign-off on capability profiles + red-team matrix.
- Perf budgets holding in CI across last 20 PRs.

---

## 9. Non-goals (v1)

- Agent marketplace / user-created agents.
- Cloud-hosted execution (deferred to hosted dispatch in Phase 7).
- Multi-user realtime collab on same session (cursor presence, shared editing).
- Mobile-native app (responsive web only).
- LLM provider management UI beyond what VAC already exposes.
- Automated rollback / incident response.
- Test generation / synthesis beyond QA Plan recommendations.

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Prompt injection bypasses assessor read-only | Critical | Two-layer enforcement, red-team matrix in CI |
| Gate system becomes rubber-stamp | High | Two-party requirement for prod gates; audit surface prominent |
| Findings too generic → users ignore | High | Evidence mandatory at schema level |
| Reassess loop never converges | Medium | Convergence counter + manual escalation |
| Connector staleness → wrong verdict | Medium | Freshness policy + badge + replay requirement for stale hard-expire |
| Frontend lag with long sessions | Medium | Performance budget + CI gates (see `frontend-rules.md`) |
| Protocol churn before v1 freeze | Low | Schema version pin, codegen in CI, frozen after Phase 5 |

---

## 11. Out-of-scope architectural decisions

Recorded explicitly so they don't creep back:

- **No Redux.** Zustand per-domain slice only.
- **No full-terminal web mirroring.** xterm.js only in shell drawer.
- **No PTY for anything other than shell.**
- **No direct exposure of VAC internal `InputEvent`/`OutputEvent`.** Semantic protocol v1 only.
- **No execution without approved handoff.** There is no "quick fix" shortcut from assessor.
- **No inbound port by default.** Bridge binds 127.0.0.1; remote via user-provided tunnel in v1.

---

## 12. Glossary

- **Assessor** — read-only agent class that produces findings.
- **Executor** — mutating agent class, runs only under approved handoff.
- **CapabilityProfile** — pinned set of permissions defining what a session can do.
- **HandoffPacket** — formal artefact bundling accepted findings + tasks + pin + target executor profile.
- **Pin** — snapshot metadata (commit sha, worktree digest, connector snapshot ids) proving assessment-time state.
- **Gate** — formal release checkpoint with criteria + governance.
- **EvidenceRef** — typed reference to source material backing a finding.
- **AssessmentRun** — one execution of an assessment swarm over a scope.
- **AssessmentDiff** — reassessment output comparing two runs.
- **Swarm** — coordinated group of assessor agents in a family.
- **Synthesizer** — terminal agent in a swarm that merges findings into a verdict.
- **Depth** — `quick / standard / full` controls swarm coverage.
- **Readiness Hub** — Assess plane homepage showing all scorecards.

---

## 13. Related documents

- [`architecture.md`](./architecture.md) — system-level architecture.
- [`protocol.md`](./protocol.md) — command/event catalog v1.
- [`capability-profiles.md`](./capability-profiles.md) — worker class + profile enforcement.
- [`assessment-contract.md`](./assessment-contract.md) — assessment run + finding schema.
- [`handoff-contract.md`](./handoff-contract.md) — packet model + dispatch lifecycle.
- [`gates.md`](./gates.md) — gate governance.
- [`evidence-freshness.md`](./evidence-freshness.md) — EvidenceRef freshness rules.
- [`ux-grammar.md`](./ux-grammar.md) — severity, subsystems, notify lanes.
- [`frontend-rules.md`](./frontend-rules.md) — performance + architecture rules.
- [`connectors.md`](./connectors.md) — connector adapter contracts.
- [`agent-runtime.md`](./agent-runtime.md) — current runtime / ACP bridge contract.
- [`plans/backend-ui-wiring.md`](./plans/backend-ui-wiring.md) — active implementation plan for closing backend ↔ UI command/event gaps.
- [`red-team-test-plan.md`](./red-team-test-plan.md) — security test matrix.
- [`perf-test-plan.md`](./perf-test-plan.md) — performance test harness.
