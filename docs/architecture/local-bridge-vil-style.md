# local-bridge VIL-style Architecture

## Principle

Axum is transport substrate only. Product logic must be written as
VIL-style process or workflow modules — not as raw Axum route handlers.

## Rules

```text
ALLOWED — pure Axum:
- existing WebSocket transport (ws/handler.rs)
- health/version HTTP endpoints (server.rs)
- auth/pairing glue (auth/)
- relay compatibility (tunnel.rs)

FORBIDDEN for new product logic:
- new business route as raw axum handler
- new approval logic inside raw route fn
- new workflow/assessment/handoff logic as route-local code
```

## VIL-style layers

```text
transport layer     — Axum/WebSocket substrate (compatibility, unchanged)
process layer       — per-session WorkflowProcess (workflows/process.rs)
workflow layer      — declarative YAML + executor (workflows/)
event adapter layer — bridge event → semantic advance (workflows/adapters.rs)
```

## Workflow process

Each session spawns a `WorkflowProcess` (VIL ServiceProcess equivalent):

1. Subscribes to the session's broadcast channel
2. Receives bridge events and classifies them via `adapters::classify_bridge_event`
3. Advances the `WorkflowExecutor` state machine
4. Emits `workflow.*` events back into the ring + broadcast (replayable)

## Workflow specs

YAML-defined, bundled at compile time via `include_str!`. No runtime file I/O.
No `vil_vwfd` dependency yet — adapter pattern first, real dependency when stable.

```text
workflows/
  build.basic.yaml              — default: prompt → observe → done
  build.approval-gated-edit.yaml — approval gate before tool observation
  build.observe-tools.yaml      — with runtime log collection
  assess.report.yaml            — assessment workflow
  handoff.package.yaml          — handoff artifact collection
```

## Future migration path

```text
Step 1 (done): VIL-shaped adapter inside local-bridge
Step 2 (next):  all new features use workflow/process layer
Step 3:         route/server substrate wrapped in VIL-style ServiceProcess
Step 4:         evaluate real vil_server / vil_vwfd dependency
```

## What this is NOT

- Not a full VIL runtime import
- Not workflow provisioning or user-uploaded workflows
- Not Stage K VIL semantic runtime
- Not X.5c.3 fs/terminal enforcement
