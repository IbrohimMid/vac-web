// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/gate_policy.schema.json

export interface GatePolicy {
  absolute_max_override: string;
  allowed_override_roles: string[];
  auto_reevaluate_every?: string;
  gate: string;
  max_override_duration: string;
  min_reason_length: number;
  non_overridable_criteria?: string[];
  require_evidence_on_override: boolean;
  require_two_party: boolean;
  required_criteria: string[];
  two_party_roles?: string[];
  version: string;
  warnings_block?: boolean;
}
