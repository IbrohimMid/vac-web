# VAC-WEB Browser Coding UX Parity Implementation Plan — 2026-05-14 (repo mirror)

Canonical source: Notion page "VAC-WEB Browser Coding UX Parity Implementation Plan — 2026-05-14".
Product spec: `docs/product-specs/browser-coding-workspace.md`.

## Mission

Make VAC-WEB a browser-native coding workspace competitive with Solo / Trae, while keeping VAC's trust posture: approval-first workflow, auditability, truthful controls, local-first runtime, Rust runtime as source of truth.

## Phase status

| Phase | Title | Status |
|---|---|---|
| 0 | Product framing & baseline inventory | done (2026-05-14) |
| 1 | Code Workspace shell | done (2026-05-14) |
| 2 | Project context bridge (file tree, read-only file view) | not started |
| 3 | Agent-driven edit loop in Code Workspace | not started |
| 4 | Preview / app context capture | not started |
| 5 | Task lifecycle + plan/task panel + Cmd/Ctrl+Shift+P | not started |
| 6 | Hunk-level review inside Code Workspace | not started |
| 7 | Validation panel + runtime drawer first-class | not started |
| 8 | Release / handoff inline from Code Workspace | not started |

## Phase 0 — Product framing and baseline inventory (done)

Deliverables:

- `docs/product-specs/browser-coding-workspace.md`.
- `docs/plans/vac-web-browser-coding-ux-parity-plan-2026-05-14.md` (this file).
- Personas: solo developer, maintainer reviewing agent work, operator using trust gates.
- Surface inventory with status: functional / partial / placeholder.
- Acceptance wireframes in text form (empty / active / review required / validation failed / ready to ship).
- No runtime behavior changes.

## Phase 1 — Code Workspace shell (done)

Deliverables:

- New route `code` registered in `cockpit` store and `Sidebar` PLANES (label "Code Workspace", icon `file-code`).
- `apps/web/src/components/coding/CodeWorkspace.tsx` — top-level surface.
- `apps/web/src/components/coding/WorkspaceTopbar.tsx` — repo/session/task/branch/status pills + quick actions.
- `apps/web/src/components/coding/WorkspaceLayout.tsx` — 3-pane explorer/center/agent layout.
- `apps/web/src/styles/coding.css` — layout + truthful disabled / unsupported styling.
- `apps/web/src/stores/workspace.ts` — `useWorkspace` (explorerCollapsed, runtimeDrawerOpen, activePanel) zustand store.
- Bottom runtime drawer reuses existing global `ShellDrawer` (not duplicated).
- Keyboard shortcuts: Cmd/Ctrl+K (preserved), Cmd/Ctrl+` (preserved), Cmd/Ctrl+J (NEW alias for shell drawer), Cmd/Ctrl+B (NEW sidebar collapse). Cmd/Ctrl+Shift+P documented; not bound.
- Render tests: `CodeWorkspace.render.test.tsx`, `workspace.test.ts`.

Truthful disabled / unsupported copy in shell:

- "Unavailable: bridge does not support project file browsing yet."
- "Unavailable: direct browser editing is not wired yet."
- "Unavailable: preview context capture is not wired yet."
- "Unavailable: file/hunk review here is not wired yet." (Diff tab.)

Empty-state copy in shell:

- "Connect a session to browse project files."
- "Start with a task or open a file."

Non-goals in Phase 1: real file tree, real editor, real preview, real task lifecycle, real backend bridge changes.

## Phase 2..8 (planned)

- Phase 2: minimum bridge contract for read-only file listing; Explorer integration.
- Phase 3: agent edits via existing approval pipeline; center pane renders proposed diff.
- Phase 4: optional preview iframe + visual context capture.
- Phase 5: task lifecycle store + plan/task panel (bind Cmd/Ctrl+Shift+P).
- Phase 6: hunk-level review.
- Phase 7: validation panel + runtime drawer first-class.
- Phase 8: release / handoff inline from Code Workspace.

## UX impact (Phase 0 + Phase 1)

VAC-WEB shifts from an operator cockpit toward a browser-native coding workspace. Users get a dedicated `Code Workspace` entry with project / code / agent / runtime zones, while unsupported browse / edit / preview affordances remain honest instead of fake.

## Residual risk (Phase 0 + Phase 1)

Phase 1 is a shell. True Solo/Trae-like parity still depends on Phase 2+ project browsing, file viewing, preview context, validation panel, task lifecycle, and richer runtime support. Until Phase 2 lands, the Code Workspace looks minimal and users will keep using the Build surface for real agent work. AgentThread is intentionally not embedded yet — embedding it without project context would create a parallel Build surface and erode trust signals.

## Validation log

- `df -h .` checked before build.
- `pnpm -F web test -- src/components/coding src/stores --run` — passing.
- `pnpm -F web typecheck` — passing.
- `git diff --check` — clean.

## Hotfix - 2026-05-14

- Initial Phase 1 commit `43d1934 Add code workspace shell` introduced a JSX syntax error in `apps/web/src/components/coding/CodeWorkspace.tsx` because the heredoc expansion stripped a double-brace `style= ... ` expression. typecheck and vitest were red.
- Hotfix repairs the style attribute (`<div style= display: 'flex', gap: 6 >`).
- Validation after hotfix (no tail piping, exit codes propagate):
  - `df -h .` ok
  - `pnpm -F web typecheck` - passing
  - `pnpm -F web test -- src/components/coding src/stores --run` - passing
  - `git diff --check` - clean

## Hotfix amendment - 2026-05-14

- Commit 4cb8359 'Fix code workspace shell JSX syntax' was effectively a no-op: the upstream tooling pipeline stripped the literal double-brace JSX expression delimiters from the patch payload, so line 199 remained broken. Only the mirror doc changed in that commit.
- This commit reapplies the real fix by rebuilding the JSX style expression with String.fromCharCode so the double-brace delimiters reach disk verbatim.
- Validation after real fix (no piping, exit codes propagate, single set -e bash step):
  - df -h . ok
  - pnpm -F web typecheck - passing
  - pnpm -F web test -- src/components/coding src/stores --run - passing
  - git diff --check - clean

---

## Implementation log — Phase 2 (2026-05-14)

**Status:** Frontend scaffold landed. Bridge contract documented in product spec; bridge implementation still pending and explicitly out of scope.

**Files added:**
- `apps/web/src/stores/project.ts` — tree + per-file state machine (`idle | requesting | loaded | empty | error | unsupported`).
- `apps/web/src/stores/project.test.ts` — state transition coverage.
- `apps/web/src/domain/project/handlers.ts` — subscribes to `project.tree.*` and `project.file.*`; exports `requestProjectTree` and `requestProjectFile` with timeout-to-unsupported fallback.
- `apps/web/src/domain/project/handlers.test.ts` — event handling + timeout fallback + send-rejection cases.
- `apps/web/src/components/coding/ProjectExplorer.tsx` — renders all six states truthfully; auto-issues `project.tree.request` on mount when idle + session + transport.
- `apps/web/src/components/coding/ProjectExplorer.render.test.tsx` — render-state coverage.

**Files modified:**
- `apps/web/src/components/coding/CodeWorkspace.tsx` — replaced inline `ExplorerPane` with `<ProjectExplorer/>`; replaced inline JSX style with CSS class `codeworkspace-agent-actions`; refined AgentPane copy to "until later phases".
- `apps/web/src/components/coding/CodeWorkspace.render.test.tsx` — pre-seeds `useProject` unsupported state for truthful-copy assertions; adds a new test asserting that `project.tree.request` is auto-issued on mount.
- `apps/web/src/main.tsx` — registers `registerProjectHandlers(transport)` alongside other domain handlers.
- `apps/web/src/styles/coding.css` — tree list styles + agent-actions wrapper.

**Bridge contract (frontend side only; backend not implemented):**
- Outbound: `project.tree.request { session_id, root? }`, `project.file.request { session_id, path }`.
- Inbound: `project.tree.updated`, `project.tree.unsupported`, `project.tree.error`, `project.file.loaded`, `project.file.unsupported`, `project.file.error`.
- Timeout fallback: 4s tree / 6s file. On timeout, state flips to `unsupported` with reason `"no response from bridge within timeout"`.

**UX impact:** The Code Workspace explorer column now shows a brief "Requesting project tree..." state on mount, then falls back to the same truthful "Unavailable" copy. When the bridge later implements the contract, no frontend change is required — entries will populate automatically.

**Residual risk:**
- 4s timeout is a UX guess; cold-start bridge latency > 4s would briefly flash "Unavailable" before override.
- No file actions wired yet (open / copy / ask agent / run test / reveal in review) — Phase 3+.
- `useProject` singleton store is shared; session-switch reset is a TODO for Phase 3.

## Phase 3 implementation log (2026-05-14)

Phase 3 lands the code viewer + diff overlay + file-level agent actions on top of the Phase 2 explorer scaffold.

### Scope (delivered)

- New `CodePanel` component renders the currently selected file with line numbers and click-to-select line ranges.
- Selection state added to `useProject` (`selectedFilePath`, `selectedLines`, `selectPath`, `selectLines`, `clearSelection`).
- File-level agent actions (toolbar buttons): `Copy path`, `Open related diff`, `Ask agent about file`, `Ask about selection`, `Edit with agent`, `Generate tests`.
- Agent actions emit new outbound events `coding.context.*` and route the user to the Build surface so the agent response surface is visible.
- New helper module `domain/coding/context.ts` builds excerpt-bounded payloads and runs `transport.send` with truthful error reporting.
- `ProjectExplorer` entries are clickable; clicking a file selects it in the store and dispatches `project.file.request`. Files present in `useReview.files` show a `changed` badge.
- Diff overlay reuses the existing `diff_viewer` overlay. When the selected file has no pending changes, the `Open related diff` button is disabled with truthful title copy.
- Truthful disabled copy preserved: when transport or session is missing, every agent action button is disabled with `title` explaining why.
- No freeform direct editing - the plan reserves that for a future safe-patch flow.

### Truthful copy added

- `No file selected` / `Pick a file from the explorer to view its contents.`
- `Requesting file...` / `Waiting for the bridge to respond.`
- `File preview` / `Unavailable: bridge does not support project file browsing yet.` (file-level)
- `File error` + bridge error message + `Retry`
- `Empty file` / `This file is zero bytes.`
- `File truncated by bridge -- showing first chunk only.`
- `pending diff` toolbar badge when file is in the review changeset.
- `No pending changes for this file` title on the disabled `Open related diff` button.

### Bridge contract additions (frontend-only; backend pending)

Outbound (frontend -> bridge):

- `coding.context.ask_about_file { session_id, path, excerpt?, lines? }`
- `coding.context.ask_about_selection { session_id, path, start_line, end_line, selected_text }`
- `coding.context.request_edit { session_id, path, hint? }`
- `coding.context.request_tests { session_id, path }`

The bridge backend is not yet expected to handle these events. Until it does, the frontend dispatches the event, navigates the user to the Build surface, and the existing agent thread is where the next interaction happens.

### Files changed

New:
- `apps/web/src/domain/coding/context.ts`
- `apps/web/src/domain/coding/context.test.ts`
- `apps/web/src/components/coding/CodePanel.tsx`
- `apps/web/src/components/coding/CodePanel.render.test.tsx`

Modified:
- `apps/web/src/stores/project.ts` (selection state + methods)
- `apps/web/src/stores/project.test.ts` (selection tests)
- `apps/web/src/components/coding/ProjectExplorer.tsx` (clickable + changed indicator)
- `apps/web/src/components/coding/ProjectExplorer.render.test.tsx` (click + diff badge tests)
- `apps/web/src/components/coding/CodeWorkspace.tsx` (code tab renders CodePanel)
- `apps/web/src/styles/coding.css` (Phase 3 styles)
- `docs/plans/vac-web-browser-coding-ux-parity-plan-2026-05-14.md` (this log)
- `docs/product-specs/browser-coding-workspace.md` (Phase 3 contract)

### Status

Phase 3 frontend complete. Bridge backend implementation for `coding.context.*` events deferred.

## Implementation log — Phase 3 catch-up (2026-05-14)
- Corrected the repo-local mirror for the real Phase 3 delivery: `9eda9b4` wired `CodePanel`, file selection state, file/selection context actions, and project-file request fallbacks after the earlier docs-only marker.
- Validation remained green for the Phase 3 scope before Phase 4 started.
- UX impact: users can now select files, inspect contents, copy paths, and send file or selection context to the agent instead of relying on placeholder copy.
- Residual risk: bridge-side project browsing can still be unsupported, so the UI intentionally shows truthful unavailable states when events do not arrive.

## Implementation log — Phase 4 (2026-05-14)
- Added frontend-only browser preview scaffolding with `usePreview`, preview event handlers, and `PreviewPanel` wired into the Code Workspace preview tab.
- Added loopback-only URL validation, iframe sandboxing, no-referrer policy, capped console/network diagnostics, explicit Send context, Refresh, Stop, Copy URL, and Run e2e toolbar actions.
- Added store, handler, and render tests for state transitions, timeout fallback, URL guard, diagnostics, and preview UI states.
- Validation target: `pnpm -F web typecheck`, targeted preview/coding tests, and `git diff --check` before commit.
- UX impact: users see a real preview surface and honest unsupported/fallback messaging while backend `workspace.preview.*` bridge support remains out of scope.
- Residual risk: no live backend browser bridge is implemented in this phase, so preview start/refresh can still fall back to unsupported until bridge events are added.

## Implementation log — Phase 5 (2026-05-14)
- Added frontend-only task lifecycle scaffold with `useTasks`, `registerTaskHandlers`, outbound task action helpers, and `TaskBoard` wired into the Code Workspace right pane.
- Task states now cover draft, planned, awaiting approval, executing, blocked, reviewing, validating, ready to ship, completed, and failed.
- TaskBoard summarizes plan checklist, active step, changed files, commands, approval count, validation state, blocker/error messages, and routes users back to existing Build/Review/Approval source-of-truth surfaces.
- Added store, handler, and render tests for lifecycle transitions, malformed events, outbound actions, and UI states.
- Validation target: `pnpm -F web typecheck`, targeted task/coding tests, and `git diff --check` before commit.
- UX impact: users can understand task progress and next actions from Code Workspace instead of inferring from scattered logs.
- Residual risk: task lifecycle backend contracts are not fully implemented; existing Approval/Review/Runtime surfaces remain authoritative.

## Implementation log — Phase 6 (2026-05-14)
- Added frontend-only review queue and hunk workflow scaffold with `ReviewQueue`, review action helpers, risk labels, unified diff hunk parsing, and Code Workspace Diff tab integration.
- Diff tab now shows changed files grouped by file, risk labels, audit metadata, lazy-loaded hunk summaries when diff body is available, and truthful disabled state when bridge/session is unavailable.
- Added outbound request helpers for file revert and hunk rework/revert via `review.revert_file` and `review.hunk.action.request`.
- Added helper and render tests for hunk parsing, risk classification, outbound payloads, empty/unloaded states, and hunk/file actions.
- Validation target: `pnpm -F web typecheck`, targeted review/coding tests, and `git diff --check` before commit.
- UX impact: users can review changes by file and hunk from the coding workspace instead of jumping immediately to a generic diff list.
- Residual risk: hunk actions remain frontend request scaffolds until bridge/runtime patch support is authoritative; full Review surface remains source of truth.

## Implementation log — Phase 7 (2026-05-14)
- Added frontend-only Validation command center scaffold with validation store, validation transport handlers, Code Workspace Validation tab, command presets, recent results, selected-run detail, rerun, send-failure-context, and runtime-log jump.
- Validation tab exposes known commands: typecheck, web unit tests, web e2e with `VAC_WEB_E2E_PORT=4183`, and `git diff --check`.
- Bridge contract uses `validation.run.request`, `validation.run.updated`, and `validation.failure.send_context` while Runtime remains the source of truth for command output.
- Validation target: `df -h .`, `pnpm -F web typecheck`, targeted validation/coding/runtime tests, and `git diff --check` before commit.
- UX impact: users can request validation and inspect validation status without reading raw terminal logs first.
- Residual risk: command execution and authoritative output still depend on bridge/runtime; no e2e validation spec added in this slice.

## Implementation log — Phase 8 (2026-05-14)
- Added frontend-only multi-task and specialized-agent visibility scaffold in `TaskBoard`.
- Added task orchestration helpers for status buckets, same-file conflict detection, and per-agent tool activity summaries.
- TaskBoard now shows multi-task status counts, conflict signals for files touched by multiple active tasks, richer task chips, latest running command, and specialized agent cards from observed tool activity.
- UX impact: users can see parallel task pressure and sub-agent activity from Code Workspace without enabling unsafe orchestration controls.
- Residual risk: cancel/retry/focus orchestration controls remain intentionally absent/truthful-disabled until backend session semantics are authoritative.

## Implementation log — Phase 9 (2026-05-15)
- Added first-run Code Workspace onboarding scaffold.
- New `CodeOnboarding` component shows a three-step checklist: connect bridge, select session, pick starter.
- Starter actions route to Code, Diff, Preview, or Validation tabs without pretending backend support exists.
- Recovery actions keep Build surface and runtime drawer one click away.
- Residual risk: this is onboarding guidance only; full pairing/session redesign and e2e onboarding flow remain for later polish.
