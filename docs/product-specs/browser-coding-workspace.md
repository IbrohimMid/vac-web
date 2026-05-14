# Browser Coding Workspace — Product Spec

Status: draft (Phase 0 complete, Phase 1 shell shipped)
Last updated: 2026-05-14
Canonical plan: `docs/plans/vac-web-browser-coding-ux-parity-plan-2026-05-14.md`
Notion canonical: VAC-WEB Browser Coding UX Parity Implementation Plan — 2026-05-14

## Goal

Make VAC-WEB feel like a browser-native coding workspace competitive with Solo/Trae, without giving up VAC's identity: approval-first workflow, auditability, truthful controls, local-first runtime.

## Target personas

- Solo developer — describes a task, watches the agent draft/edit/validate/ship from the browser. Cares about iteration speed, clear next action, and not getting buried in operator-grade panels.
- Maintainer reviewing agent work — wants to see what changed and why, with diff + provenance + validation linked. Cares about trust, rollback, rework signaling.
- Operator using trust gates — wants gates, approvals, audit, persistence drift, release truthfulness to stay first-class. Cares that browser coding UX never erodes existing trust controls.

## North-star loop

1. Pick active repo / session.
2. Compose a task.
3. See agent plan; approve plan or request revision.
4. Watch agent read/edit files, run commands.
5. Inspect explorer, code/diff/preview, agent thread, runtime/terminal in one screen.
6. Review changeset.
7. Run validation.
8. Commit / PR / handoff.

## Product principles

- Browser first.
- Truthful controls (capability-detect; never fake a button).
- Trust by default (approval, provenance, redaction, validation, audit).
- Progressive complexity (novice flow first, advanced surfaces one click away).
- No fake IDE (read-only viewer + agent edit request when direct edit is not wired).

## Surface inventory (baseline 2026-05-14)

| Surface | Status | Notes |
|---|---|---|
| Build surface (`BuildSurface`) | functional | Composer + AgentThread + workbench tabs (Approvals/Review/Runtime). Source of truth for chat-driven work today. |
| AgentThread | functional | Inside BuildSurface; turn-by-turn tool activity, reasoning, final answers. |
| Approvals tab | functional | Approve/Reject wired post audit Phase 4 trust fix. |
| Review tab | functional | File-level diff rows; hunk-level workflow scheduled for Phase 6+. |
| Runtime tab | functional | Runtime logs / shell stream. |
| Sessions surface | functional | Session picker + sessions list. |
| Workflow rail | functional | VIL-inspired workflow lane on cockpit rail. |
| Readiness Hub (Assess) | functional | Assessment runs, findings, freshness. |
| Release surface | functional | NotWired / DryRun providers labeled truthfully (post audit Phase 3). |
| Handoff surface | functional | Packet builder, two-party signoff. |
| Shell drawer | functional | Bottom drawer terminal/runtime preview, global. |
| Connectors | partial | Surface exists; broader wiring continues. |
| Knowledge / Archive | placeholder | Lenses on session state; deeper view pending. |
| Extensions / Settings | partial | Pending approvals + promotion modal exist; richer trust ops pending. |
| Migration tab | placeholder | Migration helper UI pending. |
| Code Workspace (new, Phase 1) | partial | Shell layout; explorer/center/preview/agent are truthful unsupported states. |

## Code Workspace surface (Phase 1 shell)

Phase 1 introduces a new top-level route `code` (sidebar label "Code Workspace") with the following layout:

```text
+-------------------------------------------------------------+
| Topbar: repo / session / task / branch / status / palette   |
+---------------+-------------------------------+-------------+
| Project       | Code / Diff / Preview         | Agent       |
| Explorer      | primary workspace             | Thread      |
| (unsupported) | (unsupported until Phase 2/3) | placeholder |
+---------------+-------------------------------+-------------+
| Bottom drawer: Runtime / Terminal / Validation / Approvals  |
+-------------------------------------------------------------+
```

Truthful disabled / unsupported copy in shell:

- Explorer: "Unavailable: bridge does not support project file browsing yet."
- Center (Code tab): "Unavailable: direct browser editing is not wired yet."
- Center (Preview tab): "Unavailable: preview context capture is not wired yet."
- Center (Diff tab): "Unavailable: file/hunk review here is not wired yet." (Use Build → Review tab.)
- Agent thread placeholder: "Use the Build surface for the live agent thread until Phase 2 wires file context here."

The bottom runtime drawer reuses the existing global `ShellDrawer` mounted from `main.tsx`.

## Acceptance wireframes (text form)

### Empty state (no session)

```
Topbar: "No session" • blocked
Explorer: "Connect a session to browse project files."
Center: "Start with a task or open a file."
Agent: "Agent thread placeholder."
Runtime drawer: hidden by default; Cmd/Ctrl+J or Cmd/Ctrl+` to open.
```

### Active coding task

```
Topbar: repo "vac-web" • session "sess-abc" • task "…" • branch "main" • ready
Explorer: file tree (Phase 2+); Phase 1 shows unsupported notice.
Center: code viewer (Phase 3+); Phase 1 shows unsupported notice.
Agent: AgentThread (Phase 2+); Phase 1 links to Build surface.
Runtime drawer: live runtime log + validation results when open.
```

### Review required

```
Topbar: task badge "Review required"
Center: open diff (Phase 6+); Phase 1 references existing Build → Review tab.
Agent: agent waiting for approve / request revision.
Runtime drawer: last validation result block.
```

### Validation failed

```
Topbar: task badge "Validation failed"
Center: failing test summary (Phase 7+); Phase 1 references existing Runtime tab.
Agent: agent suggests next attempt.
Runtime drawer: failing command output + rerun action.
```

### Ready to ship

```
Topbar: task badge "Ready to ship"
Center: change summary (Phase 5+); Phase 1 references existing Release / Handoff surfaces.
Agent: agent summarizes what changed and proposes commit / PR / handoff.
Runtime drawer: passing validation snapshot.
```

## Keyboard shortcuts (Phase 1)

| Shortcut | Action | Status |
|---|---|---|
| Cmd/Ctrl+K | Command palette | preserved |
| Cmd/Ctrl+` | Toggle shell / runtime drawer | preserved |
| Cmd/Ctrl+J | Toggle shell / runtime drawer (alias) | new (Phase 1) |
| Cmd/Ctrl+B | Toggle sidebar collapse | new (Phase 1) |
| Cmd/Ctrl+Shift+P | Plan / task panel | documented; not bound (Phase 5+) |

## Out of scope (Phase 1)

- Real project file browsing.
- Real code edit affordance from the browser.
- Real preview iframe and context capture.
- Real task lifecycle store.
- Replacing Rust runtime logic.
- Multi-user real-time collab.
- Cloud IDE runtime.

## Phase 1 success criteria

- `code` route renders the shell.
- Build surface remains functional and default.
- Layout is keyboard accessible.
- All unsupported coding controls visibly disabled with truthful copy.
- No fake file/editor/preview data.
- Targeted vitest passes; typecheck clean; `git diff --check` clean.
