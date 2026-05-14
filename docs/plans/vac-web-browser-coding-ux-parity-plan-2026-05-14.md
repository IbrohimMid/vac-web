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
