# UX Grammar

**Status**: v1 (locked for Phase 0.5)
**Scope**: Severity glyphs, subsystem labels, notify lanes, overlay semantics, and the vocabulary shared between TUI (VAC) and web (`vac-web`).

---

## 1. Why this exists

Both the existing VAC TUI and `vac-web` speak to the same user cockpit. A finding labelled `critical` in TUI should be visually and semantically identical in web. Drift between surfaces creates cognitive load + support pain. This document is the **SSOT** for user-facing grammar.

---

## 2. Severity glyphs (system-wide)

The four-glyph severity grammar is universal.

| Glyph | Level | Color token | Use |
|---|---|---|---|
| `✓` | ok / pass / success | `--sev-ok` (emerald) | completed, healthy, green |
| `·` | info / neutral / notice | `--sev-info` (slate) | informational, unremarkable |
| `●` | warn / attention | `--sev-warn` (amber) | needs attention, non-blocking |
| `✗` | error / fail / blocker | `--sev-error` (rose) | red, blocking, critical |

Applied consistently across:
- Gate chips
- Notify toasts / lane entries
- Assessment finding badges
- System pulse facet chips
- Runtime job status
- Connector health indicators
- Tool call risk badges (approval)

### Severity mapping

| Context | `✓` | `·` | `●` | `✗` |
|---|---|---|---|---|
| Gate state | green | — | yellow | red |
| Assessment verdict | READY / PASS | — | CONDITIONAL / WARN | BLOCKED / FAIL |
| Finding severity | (not used, findings are always warn+) | info | medium / low | critical / high |
| Tool risk | verified/local | unknown | sensitive | destructive |
| Connector health | online fresh | online aging | degraded | offline |
| Runtime job | completed ok | running | succeeded with warnings | failed/cancelled |

Findings `medium` and `low` both map to `●` by glyph; UI differentiates via secondary label (`medium` / `low`).

---

## 3. Subsystem labels

Consistent short labels for origin identification. Used in notify entries, chip titles, audit log subsystem fields.

| Label | Scope |
|---|---|
| `engine` | VAC engine core |
| `bridge` | local-bridge daemon |
| `session` | session lifecycle |
| `transcript` | conversation streaming |
| `approval` | tool approval flow |
| `review` | changeset/diff |
| `runtime` | background jobs |
| `shell` | shell drawer |
| `plan` | plan editor |
| `vil` | VIL subsystem |
| `memory` | memory subsystem |
| `signal` | signal subsystem |
| `mcp` | MCP servers |
| `model` | LLM provider |
| `provider` | connector / provider layer |
| `trust` | permission / policy |
| `isolation` | sandbox / worktree |
| `profile` | capability profile |
| `assessment.<family>` | assessor family (e.g., `assessment.rtd`) |
| `handoff` | handoff lifecycle |
| `gate.<name>` | gate system |
| `connector.<id>` | specific connector |
| `fs` | filesystem ops |
| `git` | git ops |
| `net` | network egress |
| `audit` | audit logging |
| `sync` | multi-client sync |

Subsystem labels go in snake_case where compound (e.g., `assessment.rtd`, `gate.ready_to_deploy`).

---

## 4. Notify lanes

Three lanes with distinct persistence semantics.

| Lane | Persistence | Placement | Use |
|---|---|---|---|
| `transient` | 3–8s auto-dismiss | Toast overlay top-right | Brief feedback, non-critical |
| `persistent` | Until user dismisses | Activity rail | Important events needing awareness |
| `sticky` | Until source condition clears | Topbar chip or status banner | Ongoing state (build running, outage, stale evidence present) |

### Routing matrix

| Event | Severity | Default lane |
|---|---|---|
| `session.ready` | · | transient |
| `session.closed` | · | transient |
| `approval.pending` | ● | persistent (also triggers workbench badge) |
| `approval.resolved` | ✓ | transient |
| `transcript.error` | ✗ | persistent |
| `assessment.completed` | ✓/●/✗ | persistent |
| `assessment.evidence_stale_detected` | ● | persistent |
| `handoff.created` | · | transient |
| `handoff.approved` | ✓ | persistent |
| `handoff.dispatched` | · | persistent |
| `handoff.completed` | ✓/✗ | persistent |
| `handoff.invalidated` / `.expired` | ✗ | sticky |
| `gate.state_changed` → green | ✓ | persistent |
| `gate.state_changed` → red | ✗ | sticky |
| `gate.override_applied` | ● | persistent (with override banner sticky until expiry) |
| `connector.disconnected` | ● | sticky (until reconnected) |
| `connector.rate_limited` | ● | transient (with retry countdown) |
| `runtime.job_started` | · | transient |
| `runtime.job_failed` | ✗ | persistent |
| `resource.exhausted` | ✗ | sticky |
| `profile.denied` | ● | transient (also logged to audit) |

### NotifyRouter

Lane routing is computed in **bridge**, not client, so TUI and web agree on lane for identical events. Client may override to a different lane only by explicit user-initiated pin (e.g., "Pin this to sticky").

Envelope:
```jsonc
{ "type": "notify.event",
  "payload": {
    "id":        "ntfy_<ulid>",
    "lane":      "transient | persistent | sticky",
    "severity":  "ok | info | warn | error",
    "subsystem": "assessment.rtd",
    "title":     "short",
    "message":   "markdown, ≤ 300 chars",
    "actionId":  "palette.invoke_action target?",
    "evidenceRef": {...?},
    "correlationId": "related entity id (run_/handoff_/etc)",
    "ts": "ISO8601"
  }
}
```

---

## 5. Overlay semantics

### OverlayKind (shared semantic enum, not TUI-specific)

| Kind | Typical use |
|---|---|
| `command_palette` | ⌘K |
| `file_search` | Ctrl+F / @mention picker |
| `model_switcher` | — |
| `profile_switcher` | session profile |
| `rulebook_switcher` | — |
| `isolation_switcher` | sandbox mode |
| `shell_drawer` | xterm.js |
| `approval_inspector` | deep-inspect a pending tool call |
| `diff_viewer` | file review modal (narrow screens) |
| `handoff_builder` | packet builder |
| `gate_detail` | gate drawer |
| `assessment_report` | full report modal (narrow screens) |
| `connector_manager` | connector list/connect |
| `override_dialog` | gate override confirm |
| `signoff_dialog` | gate signoff confirm |
| `confirm` | generic confirm prompt |
| `ask_user` | freeform input prompt from agent |
| `share_session` | pairing QR + URL |

### Stack rules (mirrored from TUI)
- Max depth: 2. Attempting to open a third → dismiss bottom.
- Esc precedence: innermost overlay → outermost → clear focus → (no-op).
- Focus restore: on dismissing overlay, focus returns to the element that opened it.
- Visual layering: dim + blur background on web; TUI equivalent is dim attribute.
- `overlay.opened` / `overlay.dismissed` events broadcast to all subscribers for multi-client sync.

### Responsive behaviour (web)
- Wide viewport: overlays like `diff_viewer`, `assessment_report` prefer **split pane** instead of modal.
- Narrow viewport: same kinds → modal.
- Kind does not change; presentation does.

---

## 6. System pulse facets

System pulse is the set of clickable chips on Topbar.

### FacetKind enum

| Kind | Label format | Click action |
|---|---|---|
| `model` | `model/<name>` | open `model_switcher` |
| `provider` | `@<provider>` | open settings → providers |
| `trust` | `trust/<mode>` | open `rulebook_switcher` |
| `isolation` | `iso/<mode>` | open `isolation_switcher` |
| `profile` | `prof/<family>` | open profile detail (read-only for non-admin) |
| `tokens` | `N tok` | open usage panel |
| `rate` | `N tok/s` | — (non-interactive) |
| `connectors` | `<n> online` | open connector manager |
| `gate_summary` | `✓ 3 ● 1 ✗ 0` | open Readiness Hub |
| `pending_approvals` | `● N` | jump to Approvals tab |
| `stale_evidence` | `⟳ N` | open assessment list filtered stale |

Facets hidden when irrelevant (e.g., no pending approvals → chip hidden).

Payload:
```jsonc
{ "type": "system_pulse.updated",
  "payload": {
    "facets": [
      { "kind": "model", "label": "opus-4.7", "severity": "ok", "actionId": "overlay.open.model_switcher" },
      { "kind": "gate_summary", "label": "✓3 ●1 ✗0", "severity": "warn", ... },
      { "kind": "pending_approvals", "label": "●2", "severity": "warn", ... }
    ]
  }
}
```

---

## 7. Activity timeline

Persistent record of significant events in session. Renders in right rail (desktop) or sessions drawer (mobile).

### Entry schema
```jsonc
{
  "id": "act_<ulid>",
  "ts": "ISO8601",
  "subsystem": "handoff",
  "severity": "ok | info | warn | error",
  "summary":  "short sentence",
  "detailRef": { "kind": "run_id | handoff_id | finding_id", "id": "..." },
  "actionId":  "palette.invoke_action.open_<something>?"
}
```

What appears in activity:
- Session start / close
- Assessment run started / completed (with verdict)
- Handoff created / approved / dispatched / completed / invalidated
- Gate state changes
- Override applied / revoked
- Signoff added
- Connector connected / disconnected
- Critical errors
- Stream cancellations

What does NOT appear:
- Every transcript message (too chatty)
- Every tool call (goes to audit)
- Transient UI interactions

---

## 8. Command palette

Universal modal, `⌘K` / `Ctrl+K`.

### Content
- Populated from `ActionSpec[]` emitted by bridge at session init.
- Filtered by current profile: actions outside profile greyed with tooltip explanation.
- Grouped by `ActionSpec.group` (Build, Assess, Handoff, Release, Session, System).
- Recency-weighted ordering within group.

### ActionSpec schema (mirrored from VAC)
```jsonc
{
  "id":               "assessment.run_rtd",
  "label":            "Ready to Deploy?",
  "description":      "Run RTD assessment on this project",
  "group":            "Assess",
  "keybinding":       "⌘⇧R?",
  "slashAlias":       "/rtd?",
  "paletteVisible":   true,
  "footerVisible":    false,
  "requiredCapabilities": ["assessment.run"],
  "availableWhen":    "session.open && !session.streaming"
}
```

Client evaluates `availableWhen` via safe expression interpreter (lodash-style) against current session state.

---

## 9. Iconography

Keep icon set minimal. Shared pairings:

| Purpose | Icon | Source |
|---|---|---|
| Build | `</>` | text |
| Assess | `🔍` conceptually, render as icon | |
| Handoff | `↝` | text arrow |
| Release | `🚀` conceptually | |
| Gate | `◇` | text |
| Connector | plug icon | lucide `plug` |
| Approval | shield icon | lucide `shield-check` |
| Diff | arrows | lucide `git-pull-request` |
| Session | window | lucide `app-window` |
| Shell | terminal | lucide `terminal` |
| Audit | clipboard | lucide `clipboard-list` |

Use lucide-react icons where possible; keep text glyphs for severity to match TUI.

---

## 10. Color tokens

CSS variables in `apps/web/src/styles/tokens.css`, dark mode variants in `[data-theme="dark"]`.

```css
--sev-ok:     hsl(152 60% 40%);
--sev-info:   hsl(215 16% 47%);
--sev-warn:   hsl(38  92% 50%);
--sev-error:  hsl(354 70% 54%);

--surface-1:  ...;
--surface-2:  ...;
--border:     ...;
--text-1:     ...;
--text-2:     ...;
--accent:     ...;

--focus-ring: 0 0 0 2px hsl(215 100% 60% / 0.5);
```

Severity colors MUST NOT be repurposed elsewhere; reserve them for semantic state.

---

## 11. Copy guidelines

- Titles: sentence case, ≤ 60 chars.
- Notify messages: action-oriented, what happened + (optional) what to do next.
- Severity adjectives: "blocked", "not ready", "needs attention", "ready", "clear".
- Avoid: "oops", "something went wrong" (use specific cause or `subsystem` label).
- Evidence references: "see PR #123" not "relevant PR".
- Gate names in UI: exact capitalization per §2 of `gates.md` (`Ready to Deploy`, `Ready to Publish`, etc.).

---

## 12. Accessibility

- All severity states MUST have a non-color indicator (glyph + text label). Never color-only.
- Focus rings visible at all zoom levels.
- All overlays must be dismissable via Esc and via a visible close control.
- Screen reader: lane severity announced via `aria-live` with politeness per lane (transient=polite, persistent=polite, sticky=assertive).

---

## 13. Related

- [`protocol.md`](./protocol.md) §4.9 — system_pulse, notify, overlay events.
- [`frontend-rules.md`](./frontend-rules.md) — component-level enforcement.
- [`capability-profiles.md`](./capability-profiles.md) — profile-awareness of action availability.
- [`gates.md`](./gates.md) — gate chip presentation.
