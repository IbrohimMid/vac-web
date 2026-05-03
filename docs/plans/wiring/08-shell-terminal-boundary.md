---
id: wiring.shell_terminal_boundary
title: 'Shell commands and ACP terminal boundary'
priority: P1
area: terminal
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/web/src/components/Composer', 'apps/local-bridge/src/translator/mod.rs']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Shell commands and ACP terminal boundary

Separate user-facing shell.* cockpit controls from provider/internal terminal.* events.

## Workflow-as-code control plane

```yaml
slice: wiring.shell_terminal_boundary
priority: P1
area: terminal
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - apps/local-bridge/src/agent_runtime/acp/terminal_handler.rs
  - apps/local-bridge/src/session
  - apps/web/src/components/Shell
  - apps/web/src/domain/runtime
backend_surface:
  - shell.start
  - shell.input
  - shell.resize
  - shell.kill
  - shell.started
  - shell.output
  - shell.exited
  - terminal.create
  - terminal.kill
  - terminal.release
  - terminal.lifecycle
frontend_surface:
  - ShellDrawer
  - runtime/tool activity stores
steps:
  - id: step_01
    do: 'Implement bridge-owned shell registry or mark shell.* not_wired.'
  - id: step_02
    do: 'Do not enable ShellDrawer from ACP terminal capability.'
  - id: step_03
    do: 'Route terminal.lifecycle to activity/log surfaces only.'
  - id: step_04
    do: 'Document resize behavior for process-backed vs PTY-backed shell.'
acceptance:
  - 'ShellDrawer availability follows shell.* implementation status.'
  - 'Provider terminal observations are labeled provider/runtime activity.'
  - 'User cannot type into a provider terminal observation as if it were a local shell.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
