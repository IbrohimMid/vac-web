// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/gate_status.schema.json

import type { EvidenceRef } from './EvidenceRef';

export interface GateStatus {
  blockers?: Record<string, unknown>[];
  branch?: string | null;
  criteria: GateStatusCriteria[];
  gate: 'DevComplete' | 'QAComplete' | 'ReadyForStaging' | 'ReadyToDeploy' | 'ReadyToPublish' | 'ReadyForGrowth' | 'MutationAuditClean';
  last_evaluated_at: string;
  next_auto_evaluation?: string;
  overrides?: GateStatusOverride[];
  project_root: string;
  sign_offs?: GateStatusSignOff[];
  state: 'green' | 'yellow' | 'red' | 'overridden';
  warnings?: Record<string, unknown>[];
}

export interface GateStatusCriteria {
  checked_at?: string;
  description: string;
  evidence_ref?: EvidenceRef;
  id: string;
  required: boolean;
  satisfied: boolean;
  stale?: boolean;
}

export interface GateStatusOverride {
  applied_at: string;
  attached_evidence_refs?: EvidenceRef[];
  by: string;
  expires_at: string;
  id: string;
  reason: string;
  revoke_reason?: string;
  revoked_at?: string;
  revoked_by?: string;
  role: string;
  scope: string;
}

export interface GateStatusSignOff {
  at: string;
  by: string;
  note?: string;
  role: string;
}
