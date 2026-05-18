// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/assessment_finding.schema.json

import type { EvidenceRef } from './EvidenceRef';

export interface AssessmentFinding {
  category: string;
  confidence: number;
  created_at: string;
  description: string;
  emitted_by: string;
  evidence: EvidenceRef[];
  family_id: string;
  fixability: 'auto' | 'assisted' | 'manual';
  id: string;
  identity_hash: string;
  owner_hint?: string;
  rationale?: string;
  run_id: string;
  severity: 'critical'|'high'|'medium'|'low'|'info';
  subsystem: string;
  suggested_fix?: AssessmentFindingSuggestedFix;
  tags?: string[];
  title: string;
}

export interface AssessmentFindingSuggestedFix {
  diff_hint?: string;
  executor_profile_hint?: string;
  rationale?: string;
  steps?: string[];
}
