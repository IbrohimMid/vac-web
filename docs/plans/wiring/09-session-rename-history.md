---
id: wiring.session_rename_history
title: 'Session rename, close, history, resume states'
priority: P1
area: session-history
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/session', 'apps/local-bridge/src/session/persistence']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Session rename, close, history, resume states

Complete visible session metadata lifecycle and resume initialization state.

## Workflow-as-code control plane

```yaml
slice: wiring.session_rename_history
priority: P1
area: session-history
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
  - wiring.persistence_replay_redaction
sources:
  - apps/local-bridge/src/translator/mod.rs
  - apps/local-bridge/src/session/persistence
  - apps/web/src/domain/sessions/history.ts
  - apps/web/src/components/Sessions
backend_surface:
  - session.rename
  - session.close
  - session.history.list
  - session.history.forget
  - session.resume.initializing
  - session.resume.started
  - session.resume.warning
  - session.resume.failed
  - session.resumed
frontend_surface:
  - SessionsTab
  - SessionPicker
  - sessionHistory store
steps:
  - id: step_01
    do: 'Implement session.rename with persistence metadata.'
  - id: step_02
    do: 'Wire session.resume.initializing to early resume UI.'
  - id: step_03
    do: 'Clarify close vs forget semantics.'
  - id: step_04
    do: 'Keep history list/forget manifest-classified as implemented.'
acceptance:
  - 'Rename persists across history list.'
  - 'Resume shows initializing before replay/progress.'
  - 'Close/forget have distinct UX copy and state transitions.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
