// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/system_pulse.schema.json

export interface SystemPulse {
  action_id?: string;
  kind: 'model' | 'provider' | 'trust' | 'isolation' | 'profile' | 'tokens' | 'rate' | 'connectors' | 'gate_summary' | 'pending_approvals' | 'stale_evidence';
  label: string;
  severity: 'ok' | 'info' | 'warn' | 'error';
}
