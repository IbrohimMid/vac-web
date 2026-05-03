---
id: wiring.auth_ws_security
title: 'Auth, WebSocket envelope, and session security'
priority: P0
area: auth-ws
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/auth/mod.rs', 'apps/local-bridge/src/ws']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Auth, WebSocket envelope, and session security

Audit auth-required WS flows, envelope validation, ACP reauth, and UI error handling.

## Workflow-as-code control plane

```yaml
slice: wiring.auth_ws_security
priority: P0
area: auth-ws
owners:
  - bridge
  - web
depends_on:
  - wiring.protocol_schema_parity
sources:
  - apps/local-bridge/src/auth
  - apps/local-bridge/src/ws
  - apps/local-bridge/src/server.rs
  - apps/web/src/transport
  - apps/web/src/components/cockpit/ReauthAction.tsx
backend_surface:
  - auth.required
  - auth.invalid_token
  - protocol.bad_envelope
  - session.authenticate
  - session.auth_requested
  - session.auth_updated
  - session.auth_failed
  - auth.not_supported
  - auth.env_var_recreate_required
frontend_surface:
  - ws transport
  - ReauthAction
  - session auth metadata
steps:
  - id: step_01
    do: 'Classify WS auth errors as connection-level vs session-level.'
  - id: step_02
    do: 'Render ACP reauth methods with provider-advertised auth metadata.'
  - id: step_03
    do: 'Prevent env-var auth from pretending in-UI token entry works when recreation is required.'
  - id: step_04
    do: 'Audit bad envelope handling and close semantics.'
acceptance:
  - 'User sees whether auth failure is websocket token, ACP provider auth, terminal auth, or env var recreate.'
  - 'Bad envelopes do not corrupt session state.'
  - 'Reauth UI only shows methods supported by active runtime.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
