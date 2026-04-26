# Shipped — state of the codebase

Snapshot of what's already in `main`. For commit-level detail use `git log`.

## Foundations (Phase 0)

- Monorepo bootstrapped (`apps/web`, `apps/bridge`, `packages/protocol`, `packages/cockpit-tokens`, etc.).
- Canonical JSON Schemas + Rust/TS codegen pipeline.
- Profile catalog (`assessor.*`, `executor.code`, `executor.release`, `executor.migration`).
- Red-team test harness, upstream VAC PRs landed, integration readiness verified.

## Bridge + Web MVP (Phase 1)

- Bridge WebSocket transport, session manager, child-process spawn for VAC native engine.
- Translator + Layer-1 profile enforcement (deny-by-default at the bridge boundary).
- Pairing + JWT + audit log integration.
- Web scaffold, WebSocket transport, minimal transcript + composer.
- End-to-end integration verified at the bridge layer; Playwright E2E deferred.

## Build Cockpit Core (Phase 2)

- Transcript architecture (hot/cold split + markdown).
- Shiki syntax highlight in a worker.
- Command palette + ActionSpec.
- Topbar, notify lanes, Activity rail.
- Overlay manager.
- Perf + red-team exit gates met (vitest UI red-team; Playwright perf deferred).

## Phases 3–8

- Assess, Handoff, Release, Knowledge, Sessions, and integration work landed in v1 GA (`df37173`) followed by the audit-driven hardening pass (`18cb543`).

## Cockpit visual port (Stages A–H)

Ported from the `/vacweb` prototype into the live cockpit, gz initial bundle held under 95 KB:

- **A** — visual foundation.
- **B** — shell (sidebar, topbar, rail, 6-route nav).
- **C** — Build surface with split + 8 workbench tabs (Approvals, Review, Agents, Runtime, Plan, VIL, VWFD, Memory).
- **D** — Assess / Handoff / Release / Knowledge / Sessions in cockpit chrome.
- **E** — Tweaks panel + cockpit store tests.
- **F** — Palette + Toast + Composer in cockpit chrome.
- **G** — Run-assessment drawer, real Agents lanes, gate-ring polish.
- **H** — overlay restyles + tool-call rendering + recent assessments.

## Composer + Report detail (Stages I–J)

- **I** — Composer contentEditable + slash palette + inline mention chips, behind `localStorage['vac.composer.experimental']`. Default remains textarea.
  - Patches: slash trigger via pure `composer/triggers.ts`, Enter routing via `submitDisabled`, single `markUsed` owner.
- **J** — AssessmentReport detail in-place toggle in `ReadinessHub`, new `assessmentReport` slice, extracted `FindingsList`.
  - Patches: Rules-of-Hooks split into `ReadinessHub` wrapper + `ReadinessHubMain`; HandoffBuilder prefill via `visibleHandoffFindings` union (active-run medium+ ∪ any selected) with `carryover` badge.

## Stability fixes

- React #185 in `RunAssessmentDrawer` resolved at `1aa94f8` — Map-ref selector + `useMemo` instead of `Array.from` inside the Zustand selector. Regression covered by `apps/web/src/stores/connectors.test.ts`.

## Architecture lock — Stage X.0

- [`../agent-runtime.md`](../agent-runtime.md) at commit `cd1ff13`: design lock for the AgentRuntime registry (drivers `mock` | `vac-native` | `acp`), additive `agent_id` on `session.create`, profile `allowed_agent_kinds`, ACP ↔ VAC permission/approval bridge, audit format, red-team cases 121–132.
- Claude Code `--acp` flag flagged **PROVISIONAL/unverified** until handshake test against a real Claude binary lands.
- Stages X.1–X.8 queued — see [`10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md).

## Stage X — ACP agent runtime

- **X.1–X.4** — bridge + profile core locked at `d136b8a`.
- **X.5a** — Rust-native ACP client driver.
- **X.5b** — ACP session handshake + transcript variants mapped.
- **X.5c.1** — Approval bridge locked at `2987fa2`.
- **X.5c.2 backend** — Observe-only tool activity events locked at `7eda69f`. All future work on `main`.
- **X.5c.2 frontend** — Cockpit consumes X.5c.2 events end-to-end:
  - `toolActivity` Zustand store — activities, ACP job logs, inline review diffs, diagnostics.
  - `domain/toolActivity/handlers.ts` — 5 event types; defensive parser; no throws.
  - `ToolActivityLane` — new Activity workbench tab (kind/status/provenance/observed-only badges).
  - `ReviewTab` — ACP inline diffs (old/new text side-by-side, new-file state, approved badge).
  - `RuntimeTab` — ACP execute log (command, output, redaction/truncation notices).
  - 235 total tests pass. `ToolActivityLane` lazy-split at 4.18 kB gzip. Capability guard: clean.
  - Observe-only boundary preserved. No X.5c.3.

## VIL-style workflow layer

Introduced in `feat(bridge): introduce VIL-style workflow layer for cockpit orchestration`:

- **Architecture decision**: Axum is transport substrate only. All product orchestration is VIL-style process/workflow, not raw route handlers. See `docs/architecture/local-bridge-vil-style.md`.
- **`apps/local-bridge/src/workflows/`** — workflow module: spec parser, registry, executor, event builders, adapter, VIL-style process task.
- **5 bundled YAML workflow specs** in `apps/local-bridge/workflows/`: `build.basic`, `build.approval-gated-edit`, `build.observe-tools`, `assess.report`, `handoff.package`.
- **Per-session WorkflowProcess** (VIL ServiceProcess equivalent): subscribes to broadcast, advances executor, emits `workflow.*` events replayably.
- **7 workflow event types**: `workflow.started`, `workflow.step.started`, `workflow.step.updated`, `workflow.step.completed`, `workflow.step.failed`, `workflow.artifact.created`, `workflow.completed`, `workflow.failed`.
- **FE**: `workflow` Zustand store, `WorkflowRail` component (lazy-split), `domain/workflow/handlers.ts`, `'workflow'` tab in BuildSurface.
- **Tests**: backend spec parser tests, adapter tests, executor advance tests, FE store tests, FE WorkflowRail DOM render tests.
- **Guard**: no `vil_vwfd` dependency, no workflow provisioning, no X.5c.3, no Stage K.

## Workflow selection baseline — locked at `230850a`

- **Default workflow** changed from `build.basic` to `build.observe-tools`.
- **New bundled spec** `build.full-cockpit`: prompt → observe tools → collect review → collect runtime → gate decision → end. Total bundled specs: 6.
- **Session create workflow selection**: `session.create` accepts optional `workflow_id`. If found in the bundled registry, that spec is used for the session's WorkflowProcess. **If not found or if the id is a path/URL/arbitrary string, `session.create` acks `ok=false` with `error.code="workflow.not_found"` and no session is created.** There is no fallback to a default for an invalid id — rejection is strict.
- **`SessionHandle.workflow_spec_id`**: handle tracks the active spec id; included in `session.ready` payload along with `workflow_name`.
- **FE**: `useSession` store gains `workflowId` and `workflowName`; populated from `session.ready`.
- **FE WorkflowRail**: shows spec name, compact run_id (last 6 chars), artifact kind chips (review_diff, runtime_log, approval, tool_activity), updated empty state.
- **`system.capabilities`**: emits bundled `workflows` list (id, name, default flag) so FE can populate a selector without hardcoding.
- **Guard**: allowlisted + bundled-only. No upload endpoint, no file path/URL/raw YAML from client.

## Workflow artifact navigation + selector UI

- **Artifact chips navigable**: WorkflowRail artifact chips are now clickable buttons that navigate to the relevant workbench tab (`review_diff` → Review, `runtime_log` → Runtime, `approval` → Approvals, `tool_activity` → Transcript). Tooltip shows `source_event_type`.
- **New artifact kinds in executor**: `tool.observed` creates `tool_activity` artifacts (when `observe_tool_activity` step is active); `approval.pending` creates `approval` artifacts (when `await_approval` step is active).
- **Artifact metadata**: `review_diff` artifacts carry `review_diff_count`; `runtime_log` artifacts carry `runtime_command_preview` (first 120 chars of command); `approval` artifacts carry `approval_id`. Raw output and raw diffs are never included.
- **Workflow selector UI**: SessionPicker now shows a Workflow dropdown (Tool Observation default, Full Cockpit Build, Approval-Gated Edit, Basic Build) and sends `workflow_id` in `session.create`.
- **Guard**: invalid workflow_id from UI is structurally impossible (selector only offers bundled ids).

## Held / not started

- **Stage K (VIL / VWFD live integration)** — placeholder UI only; held pending upstream `vil-expr` event names + schemas. See [`30-stage-k-vil-vwfd.md`](./30-stage-k-vil-vwfd.md).
- **Playwright E2E + perf** — deferred; vitest covers unit + UI red-team.
- **Connector `jira` adapter** — slated for v1.1.
