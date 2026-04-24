# Phase 3 — Execution surfaces

**Total duration**: ~9 days (6 sub-phases, 6 granular plans)
**Position**: after Phase 2.6 (cockpit polish green); before Phase 4 (Assessment MVP)
**Status**: 🔴 **NOT STARTED**

## Goal

Turn the polished-but-empty cockpit from Phase 2 into a **daily-drivable execution surface**. A user must be able to complete a real build session end-to-end in the browser alone — no TUI fallback — covering: prompt → tool-call approval → file diff review → revert → shell poke → connector context.

Three tracks converge:

1. **Workbench tabs** (Approvals, Review, Sessions, Runtime) wired to real bridge events.
2. **Heavy surfaces** (Shell drawer with xterm.js, diff worker for large files) lazy-loaded to stay within bundle budget.
3. **Context ingress** (Connector OAuth + mention search + paste tray) so the agent can reach beyond the local repo.

Exit criteria: E2E smoke `prompt → edit_file call → approval → file diff in review → revert works`, plus shell drawer usable alongside transcript without lag, plus GitHub + Notion connectors health-green.

## Sub-phase map

| Sub-phase | Focus | Days | Granular plan |
|---|---|---|---|
| **3.1** | Approvals tab | 1.5 | [20-approvals-tab](./20-approvals-tab.md) |
| **3.2** | Review tab + diff worker | 2 | [21-review-diff](./21-review-diff.md) |
| **3.3** | Sessions + Runtime tabs | 1 | [22-sessions-runtime](./22-sessions-runtime.md) |
| **3.4** | Shell drawer (xterm.js) | 1 | [23-shell-drawer](./23-shell-drawer.md) |
| **3.5** | Connector manager + OAuth | 2 | [24-connector-manager](./24-connector-manager.md) |
| **3.6** | Mention search + context attach | 1 | [25-mention-search](./25-mention-search.md) |
| **3.7** | Perf gates + red-team + exit sweep | 0.5 | — |

## Critical path

```
3.1 ──▶ 3.2 ──▶ 3.3 ──▶ 3.4 ──▶ 3.5 ──▶ 3.6 ──▶ 3.7
```

Mostly linear, with two possible parallelizations once infra is in place:

- **3.3 Sessions/Runtime** can run in parallel with 3.4 Shell (no shared code; both consume `session.*` events already emitted).
- **3.5 Connector** (bridge-heavy) can start in parallel with 3.4 once 3.3 ships — different layers.

Default: execute sequentially; only split if calendar forces it.

### Why this order
- **3.1 first** because approvals are the blocker for any useful tool-call flow; without them, 3.2 review has nothing to show.
- **3.2 after 3.1** because diffs only materialize post-approval.
- **3.3 before 3.4** because session resume feeds shell re-attach.
- **3.4 before 3.5** because shell proves the bridge binary-frame path that connector webhooks piggyback on (if applicable).
- **3.5 before 3.6** because mention search's connector-source stubs need the Connector trait shape locked.
- **3.7 last** — perf/red-team/exit sweep only makes sense once the surface is complete.

## Prerequisites

- Phase 2.6 green: 38+ vitest, 94+ workspace, 15+ red-team, vite build.
- Bridge stable: `tool_call.*`, `changeset.*`, `session.*`, `runtime.job.*` event shapes from `docs/protocol.md`.
- Overlay manager (Plan 19) proven — Phase 3 adds ≥ 3 overlays (`approval_inspector`, `diff_viewer`, `shell_drawer`) through it.
- `ignore`, `nucleo-matcher`, `keyring`, `oauth2` Rust crates vetted.
- xterm.js + `xterm-addon-fit` + `xterm-addon-web-links` vetted for license + bundle size.

## What's explicitly OUT of Phase 3

- **Assessment UI** (Readiness Hub, AssessmentReport, findings) — Phase 4.
- **Handoff builder / Reassess loop** — Phase 5.
- **Release plane / gates override UX** — Phase 6.
- **Connector write methods** (PR create, Notion page edit) — Phase 6.
- **Multi-shell split views / terminal recording** — post-v1.
- **Trust-builder auto-approve rules** — post-v1.

Phase 3 ends with a **complete execution surface but empty assessment surface**. Phase 4 fills the latter.

## Cross-cutting concerns

### Bridge emissions expanded
Additive protocol traffic across 3.1–3.6:

- `tool_call.pending` / `tool_call.decided` (3.1).
- `changeset.updated`, `changeset.file.diff_chunk` (3.2).
- `runtime.job.*` lifecycle + `runtime.job.log` stream (3.3).
- `shell.opened` / `shell.closed` + binary PTY frames on a sub-channel (3.4).
- `connector.*` (list, health, oauth.url, oauth.callback, rate_limit) (3.5).
- `context.mention_search` request/response (3.6).

All namespaced; no breaking changes to existing envelopes.

### Profile enforcement additions
New command types that **must** hit Layer 1 deny-by-default when profile forbids:

- `approval.decide`, `approval.batch_decide`.
- `changeset.revert_file`, `changeset.revert_all`.
- `shell.open`, `shell.write`, `shell.resize`, `shell.close`.
- `connector.oauth_start`, `connector.disconnect`.
- `runtime.job.cancel`.

Red-team tests for each new command type (one profile-denied case apiece = +6 red-team cases minimum).

### Perf budgets (enforced at 3.7 exit)
- FPS p95 during shell flood (1MB/s PTY output): ≥ 50.
- Diff render for 50KB file: first paint ≤ 150ms.
- Approval queue interaction latency (key press → UI update): ≤ 16ms.
- Mention search for 10k-file repo: first results ≤ 80ms.
- Post-Phase-3 bundle: ≤ 900KB gz (xterm is the big swing — budget accordingly with route-level splitting).
- Memory: no growth > 50MB/hour idle with shell drawer open.

### Red-team expansion
Phase 3 adds:
- Profile-denied `approval.decide` / `shell.open` / `connector.oauth_start` / `runtime.job.cancel` / `changeset.revert_all`.
- Double-approve race (two clients decide same `tool_call.id` simultaneously — second must get `conflict.stale`).
- Diff worker XSS (malicious file content with script tags in diff context).
- OAuth state CSRF (fake callback without matching state → reject).
- xterm binary frame fuzz (malformed frames don't crash drawer).
- Mention search path traversal (`@../../etc/passwd` must not escape root).

Target: **≥ 35 red-team cases by Phase 3 exit** (current 15 + ~20 new).

### Test targets (Phase 3 exit)
- Workspace (Rust): ≥ 130 tests.
- Red-team: ≥ 35 tests.
- vitest (web): ≥ 70 tests.
- Playwright E2E smoke (new in 3.7): ≥ 1 green run covering approvals + review.

## Phase 3 exit criteria (gate to Phase 4)

From 3.7:

- [ ] All 3.1–3.6 sub-phases hit their individual exit criteria.
- [ ] E2E smoke: `pair → session → prompt → tool_call.pending → approve → changeset.updated → diff render → revert_file → shell.open → echo hi → close → session.close` all green.
- [ ] Perf baselines captured + within budgets.
- [ ] Red-team ≥ 35 cases green.
- [ ] Tests: 130+ workspace / 70+ vitest / 35+ red-team.
- [ ] GitHub + Notion OAuth flows complete a real round-trip against live endpoints (manual verification; tokens in OS keyring).
- [ ] Bundle analyzer confirms xterm is lazy-chunked (not in initial bundle).
- [ ] Clippy `-D warnings` + fmt + TS strict + vite build all green.
- [ ] Root README + `docs/plans/phase-3/README.md` + each sub-phase README marked ✅.

## Rollback plan

Phase 3 is additive at the UI/bridge-endpoint layer. Rollback policy per sub-phase:

- **3.1 / 3.2 / 3.3**: feature-flag the tab; transcript remains usable. Bridge endpoints stay (harmless if unused).
- **3.4 Shell**: if xterm integration destabilizes, disable the drawer entry-point; keep `shell.*` endpoints behind profile gate `deny` for safety.
- **3.5 Connector**: revoke tokens + disable OAuth routes; connector trait can ship without active adapters.
- **3.6 Mention**: hide the `@` trigger; composer reverts to plain text.

If bundle blows past budget: split xterm + shiki + diff-worker into their own chunks with `vite.config.ts` `manualChunks`; if still over, defer 3.5 Notion to Phase 4.

## Execution policy

- Run sub-phases in the order above. Each sub-phase = one focused work block; do not open multiple in parallel in the same session.
- After each sub-phase: run `cargo clippy -D warnings`, `cargo test --workspace`, `pnpm --filter @vac-web/web typecheck && test && build`. No moving on with red.
- Budget contingency: if a sub-phase exceeds estimate by > 50%, stop + re-scope; don't cascade overrun. Likely candidates for scope-trim: connector second adapter (Notion), mention connector-source stubs, runtime log virtualization polish.
- Audit cycle after 3.7 (code reviewer + architect lens), matching the Phase 1 / Phase 2 post-audit hardening pattern.

## Related

- [`docs/roadmap.md §Phase 3`](../../roadmap.md) — scope in roadmap context.
- [`docs/protocol.md`](../../protocol.md) — envelope definitions for new events.
- [`docs/capability-profiles.md`](../../capability-profiles.md) — profile gates for new command types.
- [`docs/ux-grammar.md`](../../ux-grammar.md) — severity + notify usage across tabs.
- [`docs/connectors.md`](../../connectors.md) — adapter trait + OAuth shape SSOT.
- [`docs/perf-test-plan.md`](../../perf-test-plan.md) — bench specs feeding 3.7.
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) — red-team case catalog.
