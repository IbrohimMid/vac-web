// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/remediation_plan.schema.json

import type { EvidenceRef } from './EvidenceRef';

export interface RemediationPlan {
  dependency_graph?: Record<string, unknown>;
  groups: RemediationPlanGroup[];
  id: string;
  impact_summary?: string;
  run_id: string;
  total_effort?: string;
}

export interface RemediationPlanGroupTask {
  constraints?: string[];
  depends_on?: string[];
  est_effort?: string;
  evidence_refs?: EvidenceRef[];
  id: string;
  rationale?: string;
  risk_notes?: string[];
  steps?: string[];
  title: string;
}

export interface RemediationPlanGroup {
  rationale?: string;
  tasks: RemediationPlanGroupTask[];
  title: string;
}
