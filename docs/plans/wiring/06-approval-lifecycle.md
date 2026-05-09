---
id: wiring.approval_lifecycle
title: 'Approval lifecycle completeness'
priority: P1
area: approvals
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/web/src/components/Approvals/ApprovalsTab.tsx', 'apps/local-bridge/src/translator/mod.rs']; Pass #27 deep audit: P06 acceptance verified — approval.expired distinct from option_not_found (approvalErrors.test.ts:27); 5 invalid-option codes precisely mapped (approvalErrors.ts:25-49); approval.approve_all + inspect NotWired (command_catalog.rs:75-76); ApprovalsTab gated by affordance
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Approval lifecycle completeness

Complete approval inspect/bulk/expiry/error rendering so approval UX is trustable.

## Workflow-as-code control plane

```yaml
slice: wiring.approval_lifecycle
priority: P1
area: approvals
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - apps/local-bridge/src/translator/mod.rs
  - apps/local-bridge/src/session/handle.rs
  - apps/web/src/domain/approvals
  - apps/web/src/components/Approvals
backend_surface:
  - approval.approve
  - approval.reject
  - approval.approve_all
  - approval.inspect
  - approval.pending
  - approval.resolved
  - approval.expired
frontend_surface:
  - ApprovalsTab
  - ReauthAction where ACP auth overlaps approval
steps:
  - id: step_01
    do: 'Classify approval.approve_all and approval.inspect.'
  - id: step_02
    do: 'Wire approval.expired into ApprovalsTab.'
  - id: step_03
    do: 'Render not_found/not_acp/option_forbidden/option_kind_mismatch/option_not_found distinctly.'
  - id: step_04
    do: 'Keep bulk approval disabled unless scope is explicit and auditable.'
acceptance:
  - 'Expired approvals cannot be approved silently.'
  - 'Invalid approval options show precise copy.'
  - 'Bulk approval is not available without visible scope and confirmation.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
