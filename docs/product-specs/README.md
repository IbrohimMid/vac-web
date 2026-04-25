# Product Specs

Surface-level product specs for the four primary VAC Web planes. These are the product-truth documents — what each surface does, who it's for, what it must guarantee, and how it integrates with the rest of the cockpit. Architecture/protocol/profile mechanics live in the sibling docs (`../agent-runtime.md`, `../protocol.md`, `../capability-profiles.md`, `../gates.md`).

All four assume the Stage X agent-runtime model: VAC Web is agent-runtime-agnostic, Claude Code / OpenCode / Codex can be plugged in via ACP, but the bridge always owns policy, approval, audit, gate, and handoff authority.

| Spec | Surface | Role |
| --- | --- | --- |
| [assess.md](./assess.md) | Assess | Read-only assessment runs, evidence-first findings, verdicts |
| [handoff.md](./handoff.md) | Handoff | Pinned, approved, scoped execution packets from findings to executors |
| [release.md](./release.md) | Release | Gate-guarded deploy/publish/notes/runbooks/monitor/rollback |
| [build.md](./build.md) | Build | Agentic engineering workbench — chat, plan, execute, review, approve |

## Cross-surface flow

```text
Build  → produces changes
Assess → judges them, emits findings
Handoff → packages findings into scoped executor work
Release → ships the result through gates
```

Each spec includes data models, commands/events, red-team cases, and a rollout plan. Stage X.0 (`../agent-runtime.md`) is the architectural counterpart that locks how external agents are bound to these surfaces.
