---
id: wiring.profile_policy
title: 'Profile-core policy and side-effect enforcement'
priority: P0
area: security-policy
owners:
  - bridge
  - profile-core
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/profile_layer', 'packages/profile-core']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Profile-core policy and side-effect enforcement

Keep profile enforcement aligned with command manifest, shell/filesystem/connector side effects, and bridge executors.

## Workflow-as-code control plane

```yaml
slice: wiring.profile_policy
priority: P0
area: security-policy
owners:
  - bridge
  - profile-core
depends_on:
  - wiring.command_manifest
sources:
  - packages/profile-core/src/enforce.rs
  - packages/protocol/v1/profiles
  - apps/local-bridge/src/profile_layer
  - docs/capability-profiles.md
backend_surface:
  - profile.tool_denied
  - profile.fs_out_of_scope
  - profile.shell_bin_not_allowed
  - profile.egress_*
  - connector.write.*
  - shell.exec
steps:
  - id: step_01
    do: 'Every bridge executor declares side-effect class.'
  - id: step_02
    do: 'Manifest includes required profile capability for executable commands.'
  - id: step_03
    do: 'Do not rely on frontend gating for security.'
  - id: step_04
    do: 'Add denial UX mapping for profile-core error codes.'
acceptance:
  - 'Profile denial is enforced bridge-side before side effects.'
  - 'Denial codes render as precise UI copy.'
  - 'Connector/file/shell writes require explicit profile capability.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
