// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/assessment_diff.schema.json

import type { AssessmentVerdict } from './AssessmentVerdict';
import type { EvidenceRef } from './EvidenceRef';

export interface AssessmentDiff {
  base_run_id: string;
  computed_at: string;
  convergence_counter?: number;
  family_id: string;
  head_run_id: string;
  id: string;
  new_findings?: AssessmentDiffNewFinding[];
  persistent?: AssessmentDiffPersistent[];
  regressed?: AssessmentDiffRegressed[];
  resolved?: AssessmentDiffResolved[];
  verdict_delta: AssessmentDiffVerdictDelta;
}

export interface AssessmentDiffNewFinding {
  finding_id: string;
}

export interface AssessmentDiffPersistent {
  finding_id: string;
  unchanged_reason?: string;
}

export interface AssessmentDiffRegressed {
  drift_evidence?: EvidenceRef[];
  finding_id: string;
  severity_after: 'critical'|'high'|'medium'|'low'|'info';
  severity_before: 'critical'|'high'|'medium'|'low'|'info';
}

export interface AssessmentDiffResolved {
  finding_id: string;
  resolution_evidence?: EvidenceRef[];
}

export interface AssessmentDiffVerdictDelta {
  after: AssessmentVerdict;
  before: AssessmentVerdict;
  direction: 'improved' | 'same' | 'worsened';
}
