---
id: wiring.persistence_replay_redaction
title: 'Persistence, replay, history, and redaction'
priority: P1
area: persistence
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/session/persistence', 'apps/local-bridge/src/session/persistence/redact.rs']; Pass #27 deep audit: P22 acceptance verified — redact.rs runs before persistence with RedactionLabel return (sink uses redact_event_payload); session.persistence_degraded ServerEvent emitted on append/mark_status failure (sink.rs:240, test at 371-385); replay mode distinguishable via transcriptFreeze + pipelineModeFor + sessionModeBridge (see wave-summary-2026-05-03.md)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Persistence, replay, history, and redaction

Align persisted event model, replay/history UI, redaction, and degraded persistence events.

## Workflow-as-code control plane

```yaml
slice: wiring.persistence_replay_redaction
priority: P1
area: persistence
owners:
  - bridge
  - web
depends_on:
  - wiring.session_rename_history
  - wiring.audit_observability
sources:
  - apps/local-bridge/src/session/persistence
  - apps/local-bridge/src/storage
  - apps/web/src/domain/sessions/history.ts
  - apps/web/src/stores/sessionHistory.ts
backend_surface:
  - session.history.list
  - session.history.listed
  - session.history.forget
  - session.history.forgotten
  - session.persistence_degraded
  - persistence.append_event
  - persistence.mark_status
  - transcript.delta
frontend_surface:
  - PersistentSessions
  - SessionsTab
  - sessionHistory store
steps:
  - id: step_01
    do: 'Define which events are persisted and replayable.'
  - id: step_02
    do: 'Ensure redaction runs before persistence.'
  - id: step_03
    do: 'Surface session.persistence_degraded with remediation.'
  - id: step_04
    do: 'Keep replay events distinguishable from live events.'
acceptance:
  - 'History UI never shows unredacted secrets.'
  - 'Persistence degraded state is visible.'
  - 'Replay cannot be mistaken for live agent output.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
