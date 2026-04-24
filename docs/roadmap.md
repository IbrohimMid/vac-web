# Roadmap

**Status**: v1 (locked for Phase 0.5)
**Scope**: Consolidated execution plan across all blueprints. Each phase has scope, deliverables, dependencies, exit gates, and estimated duration. Durations assume 1–2 focused contributors; double for solo pace.

This document supersedes the scattered phase notes in other docs. When they disagree, this is authoritative.

---

## 0. Timeline overview

```
Phase 0    — Contract extraction                  (1 week)    ← DOCS (done)
Phase 0.5  — Contract hardening + schemas         (1 week)    ← IN PROGRESS
Phase 1    — Bridge + vac serve                   (2 weeks)
Phase 2    — Build cockpit core                   (3 weeks)
Phase 3    — Execution surfaces                   (3 weeks)
Phase 4    — Assessment MVP (RTD + PM)            (3–4 weeks)
Phase 5    — Handoff + Reassess loop              (2–3 weeks)
Phase 6    — Remaining assessors + Release plane  (3 weeks)
Phase 7    — Hosted dispatch                      (3–4 weeks)
Phase 8    — Continuous readiness                 (ongoing)
```

Critical path: **0.5 → 1 → 2 → 3 → 4 → 5**. Phase 6+ can parallelize once 5 is stable.

---

## Phase 0 — Contract extraction  ✅ DONE

### Scope
Foundational specification documents.

### Deliverables
- [x] `docs/product-prd.md`
- [x] `docs/architecture.md`
- [x] `docs/protocol.md`
- [x] `docs/capability-profiles.md`
- [x] `docs/assessment-contract.md`
- [x] `docs/handoff-contract.md`
- [x] `docs/gates.md`
- [x] `docs/evidence-freshness.md`
- [x] `docs/ux-grammar.md`
- [x] `docs/frontend-rules.md`
- [x] `docs/connectors.md`
- [x] `docs/upstream-vac-prs.md`
- [x] `docs/red-team-test-plan.md`
- [x] `docs/perf-test-plan.md`
- [x] `docs/README.md` + root `README.md`

### Exit gate
All 14 docs locked and cross-referenced. Done.

---

## Phase 0.5 — Contract hardening + JSON schemas

**Duration**: 1 week
**Depends on**: Phase 0

### Scope
Turn documented schemas into machine-readable JSON Schemas. Draft upstream VAC PRs that define the engine-side contract. Red-team harness stub that proves enforcement is testable.

### Deliverables

#### 1. JSON Schema v1 canonical set
Location: `packages/protocol/v1/`.
- `capability_profile.schema.json`
- `evidence_ref.schema.json`
- `assessment_run.schema.json`
- `assessment_finding.schema.json`
- `assessment_verdict.schema.json`
- `assessment_diff.schema.json`
- `remediation_plan.schema.json`
- `handoff_packet.schema.json`
- `gate_status.schema.json`
- `gate_policy.schema.json`
- `session_snapshot.schema.json`
- `command.schema.json` (discriminated union)
- `event.schema.json` (discriminated union)
- `action_spec.schema.json`
- `connector_snapshot.schema.json`
- Profile YAMLs: `packages/protocol/v1/profiles/{assessor.base,assessor.*,executor.code,executor.release}@1.0.0.yaml`

#### 2. Draft upstream VAC PRs (not merged; aligned)
Per [`upstream-vac-prs.md`](./upstream-vac-prs.md):
- PR #2: tool `side_effect` tagging.
- PR #3: `vac schema dump`.
- PR #4: `CapabilityProfile` loader + engine policy layer.
- PR #5: `shell.exec_allowlisted` tool.

#### 3. Red-team harness skeleton
- `tests/red-team/` directory with runner scaffolding.
- First 5 cases wired as smoke tests (cases 1, 3, 9, 18, 33 from `red-team-test-plan.md`).
- CI workflow stub.

#### 4. Codegen pipeline
- `scripts/codegen.sh` → JSON Schema to TS (via `quicktype` or `json-schema-to-typescript`) + Rust (via `typify`).
- Output: `packages/protocol-ts/` + `packages/protocol-rs/`.
- CI check: generated files match committed; drift = fail.

### Exit gate
- Every schema validates against sample instances.
- Profile YAMLs round-trip through loader without loss.
- Red-team cases 1, 3, 9, 18, 33 pass (at least one layer denying for each).
- Codegen produces buildable TS + Rust.

---

## Phase 1 — Bridge + vac serve

**Duration**: 2 weeks
**Depends on**: 0.5 JSON schemas, upstream VAC PRs #1, #2, #3, #4, #5 merged

### Scope
Minimal working end-to-end: web app can connect to bridge, bridge spawns `vac serve`, user sees streaming conversation.

### Deliverables

#### 1. Repo scaffold
- Cargo workspace: `apps/local-bridge`, `packages/protocol-rs` stub.
- pnpm workspace: `apps/web`, `packages/protocol-ts` stub.
- `scripts/dev.sh` runs both concurrently.
- CI workflow: build, lint, test.

#### 2. `local-bridge` MVP
- axum HTTP + WS server on `127.0.0.1:<port>`.
- `GET /health`, `GET /version`.
- `WS /api/sessions/:id/stream`.
- Pairing flow: `POST /api/pair` → short-lived code + JWT mint.
- Project allowlist loader from `~/.config/vac-web/bridge.toml`.
- Session manager: spawn `vac serve --stdio --profile executor.code@1.0.0` per session.
- Translator: envelope ↔ JSON-RPC passthrough for protocol subset (message.submit, transcript.delta, transcript.completed, session.ready, session.closed).
- Audit log writer (append-only JSONL per session).
- Profile enforcement Layer 1 (bridge router) for the subset in play.

#### 3. `web` MVP
- Vite + React + TypeScript scaffold.
- WS transport with RAF event drain + `last_event_id` replay.
- Single store: `session.ts` + `transcript.ts` (other slices stubbed).
- `<Transcript/>` + `<Composer/>` minimal; streaming rendered as plain text (no markdown parse yet).
- `session.create` → `message.submit` → see streaming delta.
- No workbench, no overlays, no workers yet.

#### 4. Codegen actually used
- TS types consumed in web.
- Rust types consumed in bridge.

### Exit gate
- Two browser tabs attach to same session; both see identical streaming delta.
- Approval from tab A locks tab B until resolved.
- Profile denial path tested: assessor profile refuses `edit_file` at bridge and engine.
- Audit log has entries for tool allow/deny.
- Red-team cases 1, 3, 9, 33, 38 passing.

---

## Phase 2 — Build cockpit core

**Duration**: 3 weeks
**Depends on**: Phase 1

### Scope
The Build plane feels complete enough for daily coding. Focus: transcript, composer, palette, severity grammar, streaming perf.

### Deliverables

#### 1. Transcript polish
- Hot window (50) + cold freeze.
- Markdown-it + DOMPurify per completed message.
- Plain text during streaming (per `frontend-rules.md §5`).
- Shiki worker for syntax highlight (visibility-gated).
- TanStack Virtual for the list.
- Code block collapse for > 10k chars.

#### 2. Composer
- Multiline input.
- `/` slash command autocomplete from `ActionSpec` list.
- `@` mention fuzzy search — endpoint `context.mention_search`.
- Paste tray for multiple attachments.
- Cancel stream (Ctrl+C while streaming).

#### 3. Command palette
- `Ctrl/⌘+K` overlay.
- Populated from `ActionSpec[]`.
- Profile-aware disabling with tooltip.
- Recency-weighted.

#### 4. UX grammar plumbing
- Topbar with `system_pulse` chips.
- Notify lane component (transient toasts, persistent rail, sticky banners) — bridge routes per `ux-grammar.md §4`.
- Activity rail component.
- Severity glyphs + color tokens wired.

#### 5. OverlayManager
- Stack max depth 2 with Esc precedence.
- Multi-client sync via `overlay.opened` / `overlay.dismissed`.
- Focus restore on dismiss.

#### 6. Performance gates active
- `bench:transcript` in CI.
- `bench:bundle` in CI.
- `bench:cold-start` in CI.

### Exit gate
- Send prompt → streaming markdown renders → slash command works → palette opens and invokes.
- `bench:transcript` passes (FPS p95 ≥ 50, heap ≤ 50MB growth in 60s).
- Notify lanes render with correct glyph per severity.
- Overlay stack behaves correctly with Esc precedence.

---

## Phase 3 — Execution surfaces

**Duration**: 3 weeks
**Depends on**: Phase 2

### Scope
Workbench tabs + shell + mention search. User can complete real build sessions end-to-end.

### Deliverables

#### 1. Approvals tab
- Pending tool-call list with risk badges (✓·●✗).
- Approve / Approve-all / Reject hotkeys (`a/A/x`).
- Inspect drawer with args preview + evidence.
- Multi-client lock (first decision wins).

#### 2. Review tab
- Changeset list.
- Lazy diff body on click.
- Hunks virtualized (> 500 hunks).
- Diff compute in worker for > 50KB files.
- Revert file / Revert all.

#### 3. Sessions tab
- List with status, model, duration.
- Resume via `SessionSnapshot`.
- Rename, close.

#### 4. Runtime tab
- Jobs list with live status.
- Per-job log stream.
- Cancel job.

#### 5. Shell drawer
- xterm.js lazy-mounted on open.
- Binary WS frames for PTY traffic.
- Buffer cap 10k lines.
- Dispose on close.

#### 6. Connector manager (read-only v1 core)
- OAuth flow for `github`, `notion` at minimum.
- Health + rate-limit display.
- Disconnect / reconnect.

#### 7. Perf gates
- `bench:diff`, `bench:workbench`, `bench:shell` in CI.

### Exit gate
- Full task E2E in web, no TUI needed: prompt → agent calls `edit_file` → approval appears → approve → file diff in review → commit-style revert works.
- Shell drawer used alongside transcript without lag.
- GitHub + Notion connectors functional, health surfaced.

---

## Phase 4 — Assessment MVP (RTD + PM)

**Duration**: 3–4 weeks
**Depends on**: Phase 3, upstream VAC PRs #6, #7 merged

### Scope
First two assessor families operational. Readiness Hub. Gate system for two initial gates.

### Deliverables

#### 1. Upstream VAC
- PR #6: `evidence.capture` tool.
- PR #7: `finding.emit` + AssessmentRun lifecycle.
- Swarm catalogs for RTD (5 agents + `release_gate` synthesizer) and PM (7 agents + synthesizer) under `crates/vac_core/assets/swarms/`.

#### 2. Bridge
- `apps/local-bridge/src/assessment/` fully wired: run manager, finding emit + identity hash, evidence capture + freshness, diff compute.
- `assessor.base@1.0.0`, `assessor.rtd@1.0.0`, `assessor.pm@1.0.0` profiles shipped.
- Profile enforcement full coverage (not subset).

#### 3. Web
- `Readiness Hub` page: Technical / Product / UX / Release / Ops scorecards.
- `AssessmentReport` component: verdict header, findings list (virtualized), filter by severity/category/confidence.
- `FindingCard`: evidence chips clickable, expand evidence preview lazy.
- Evidence freshness badges (⟳ stale, aging).
- Stream progress (`assessment.progress`) into progress bar + current-check label.

#### 4. Gate system
- Gates: `DevComplete`, `ReadyToDeploy`.
- `GateRibbon` in Topbar.
- Gate detail drawer with criteria, blockers, override dialog.
- Two-party signing for `ReadyToDeploy`.
- Audit trail UI.

#### 5. Connectors
- At minimum: `github`, `notion`, `sentry`, `ci` (GitHub Actions) required for RTD.
- `linear`/`figma` helpful for PM.

#### 6. Red-team
- Full matrix from `red-team-test-plan.md` passing (cases 1–67).

#### 7. Perf
- `bench:findings` in CI (10k findings virtualized).

### Exit gate
- Run RTD on a real project → verdict delivered ≤ 3 min (standard depth).
- Every finding has ≥ 1 clickable `EvidenceRef`.
- Zero connector writes during any assessor run (verified in audit log).
- Stale evidence visibly badged; `hard_expire` blocks handoff creation.
- `ReadyToDeploy` gate transitions correctly on verdict change.
- Red-team matrix passes in CI.

---

## Phase 5 — Handoff + Reassess loop

**Duration**: 2–3 weeks
**Depends on**: Phase 4, upstream VAC PR #8

### Scope
Close the full loop: findings → handoff → dispatch → execute → reassess → verdict diff → repeat until convergence.

### Deliverables

#### 1. Upstream VAC
- PR #8: `worktree_digest` utility + pin verification.
- `executor.code@1.0.0` profile shipped with tool registry filtering.

#### 2. Bridge
- `apps/local-bridge/src/handoff/` fully wired: packet lifecycle, pin capture + verify, invalidation detection, dispatch, execution binding.
- Two-party approval enforcement.
- `AssessmentDiff` compute with stable identity hash matching.
- Convergence counter + auto-escalation notify.

#### 3. Web
- `HandoffBuilder` UI: select findings → reorder tasks → edit constraints → preview pin.
- Approval dialog with role confirm + reason + two-party wait state.
- Dispatch picker (explicit profile selection).
- Live execution view (transcript of executor session linked to packet).
- `AssessmentDiff` view with 4 tabs (resolved / persistent / regressed / new).
- Auto-reassess trigger on handoff completion.

#### 4. Invalidation & expiry UX
- Banner when worktree drifts (strict policy).
- `handoff.expired` and `handoff.invalidated` flows surfaced.
- "Create replacement packet" CTA.

### Exit gate
- Full demo: RTD finding → accept → build packet → approve (two-party) → dispatch → executor fixes → reassess → verdict moves from BLOCKED to READY.
- Pin drift test: modify worktree mid-approval → approval rejects with `handoff.invalidated`.
- Convergence guard: 3× stuck reassess → escalation notify fires.
- Cross-profile chain tested (code → release).

---

## Phase 6 — Remaining assessors + Release plane

**Duration**: 3 weeks
**Depends on**: Phase 5

### Scope
Complete the assessor catalog. Release plane makes the full Build → Release flow real.

### Deliverables

#### 1. Remaining assessor families
- UX Review (`assessor.ux@1.0.0`)
- Frontend Review (`assessor.frontend@1.0.0`)
- Security Review (`assessor.security@1.0.0`)
- Reliability Review (`assessor.reliability@1.0.0`)
- Performance Review (`assessor.perf@1.0.0`)
- QA Plan (`assessor.qa@1.0.0`)
- Docs & Handoff (`assessor.docs@1.0.0`)
- Launch Readiness (`assessor.launch@1.0.0`)
- Release Readiness (`assessor.release@1.0.0`)
- Growth Readiness (`assessor.growth@1.0.0`)

Each: swarm catalog + profile YAML + synthesizer + default checks per depth level.

#### 2. Additional gates
- `QAComplete`, `ReadyForStaging`, `ReadyToPublish`, `ReadyForGrowth`.

#### 3. Release plane
- `Deploy` page: target table, gate status guard, dispatch via `executor.release@1.0.0`.
- `Publish` page: launch readiness consolidated.
- `Runbooks` generator.
- `Release Notes` generator (from commits + handoffs).
- `Post-release Monitor`: attach Sentry/Datadog observations.

#### 4. Advanced workbench tabs
- `Plan`, `VIL`, `VWFD`, `Signal`, `Memory` tabs (read-only MVP).
- Session export/import.
- Context inspector.

#### 5. More connectors
- `datadog`, `grafana`, `vercel`, `cloudflare`, `posthog`, `ga4`, `mixpanel`, `snyk`, `dependabot`, `lighthouse_ci`, `pagerduty`.

### Exit gate
- All 12 assessor families operational.
- All 6 gates usable.
- Deploy via web successfully tags + pushes via `executor.release` profile with two-party approval.
- Release notes auto-generated match real commit history.

---

## Phase 7 — Hosted dispatch

**Duration**: 3–4 weeks
**Depends on**: Phase 6, upstream VAC PR #10

### Scope
Remote attach pattern (Claude Code Remote Control style). Bridge dials outbound to relay; browser on any network connects to relay.

### Deliverables

#### 1. Upstream VAC
- PR #10: `TeleportToken` mint/verify public API.

#### 2. Relay service
- New service (deploy target TBD) with:
  - Device registration via outbound dial.
  - Session routing by `device_id + session_id`.
  - No content inspection.
  - Optional E2E keypair channel.
  - Rate limiting per device.

#### 3. Bridge changes
- `vac-bridge tunnel --relay <url>` outbound dial mode.
- Reconnect / re-register on connection loss.
- Reuse `TeleportToken` + `RemoteSessionConfig`.

#### 4. Web
- `claude.ai/code`-style session list from any browser.
- QR pairing from TUI / CLI.
- Reconnect + `last_event_id` replay over relay.
- Multi-device attach cross-network.

#### 5. Security
- Additional red-team cases for relay pattern.
- Device revocation flow.

### Exit gate
- Demo: open `https://vac-web.example.com` from phone on different network, scan QR from desktop TUI, attach to session; filesystem never leaves desktop.
- E2E keypair optional mode tested.
- Device revocation tested end-to-end.

---

## Phase 8 — Continuous readiness (ongoing)

**Duration**: ongoing after Phase 7

### Scope
Orchestrator becomes proactive. Backgrounded watchdog maintains live readiness scores.

### Deliverables
- Stage-based triggers (on PR merged, on branch push to protected refs, on CI build complete).
- Continuous mode with configurable re-eval cadence.
- Regression detection (verdict drifted from green to red).
- Guided mode wizard for non-technical founders.
- `executor.migration@1.0.0` profile (deferred from Phase 6 per `capability-profiles.md §4.2`).
- Additional connectors as requested.

---

## Milestone summary

| Milestone | When | What unlocked |
|---|---|---|
| **M1: Docs locked** | End of Phase 0 | ✅ Done |
| **M2: Schemas canonical** | End of Phase 0.5 | Implementation can start |
| **M3: Hello World** | End of Phase 1 | Browser ↔ bridge ↔ engine working |
| **M4: Build cockpit real** | End of Phase 2 | Daily-drivable for coding sessions |
| **M5: Full build parity with TUI** | End of Phase 3 | Users can stop using TUI for most flows |
| **M6: First assessment demo** | End of Phase 4 | Public demo: RTD on a real repo |
| **M7: Full loop demo** | End of Phase 5 | Close the Build → Assess → Fix → Reassess loop |
| **M8: v1 GA** | End of Phase 6 | Full feature set, all gates, full assessor catalog |
| **M9: Remote access** | End of Phase 7 | Use from anywhere without port-forwarding |

---

## Critical dependencies

- **Upstream VAC PRs block specific phases**. If upstream merges are slow, Phase 1 and Phase 4 are the choke points. Draft PRs early, don't block.
- **Profile hashes drift = silent breakage**. CI check that `packages/protocol/v1/profiles/` hashes match what VAC expects must land with Phase 1.
- **Red-team matrix drift = security regression**. New profile → new red-team cases required in same PR.
- **Perf baseline drift = slow degradation**. Baselines checked into main branch; PRs compare against current main.

---

## Risks & parallel work

- **Phase 4 is long**. Can split: one contributor on assessor swarm authoring (prompts, checks) while another builds AssessmentReport UI.
- **Phase 6 can parallelize heavily** across assessor families.
- **Phase 7 can start in parallel with Phase 6** once core relay design is decided.
- **Connectors are pluggable**. Additional connectors can land any phase after Phase 3.

---

## Cadence & review

- **Weekly**: perf baseline review (any regression > 5% trending).
- **Per phase exit**: security review of new profiles + red-team additions.
- **Every upstream VAC PR**: schema regen + codegen update in `vac-web` same PR or follow-up within 24h.
- **Per release**: CHANGELOG entry in both repos.

---

## Related

- [`product-prd.md`](./product-prd.md) §7 — feature matrix view of this roadmap.
- [`upstream-vac-prs.md`](./upstream-vac-prs.md) — PR dependencies.
- [`red-team-test-plan.md`](./red-team-test-plan.md) §7 — phase-gated security tests.
- [`perf-test-plan.md`](./perf-test-plan.md) §3 — phase-gated perf tests.
- [`capability-profiles.md`](./capability-profiles.md) §4 — profile catalog as phased rollout.
