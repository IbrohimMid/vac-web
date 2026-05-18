// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/assessment_run.schema.json

import type { AssessmentVerdict } from './AssessmentVerdict';

export interface AssessmentRun {
  base_run_id?: string;
  cancelled_reason?: string;
  completed_at?: string;
  connector_snapshots?: AssessmentRunConnectorSnapshot[];
  counts?: AssessmentRunCounts;
  family_id: string;
  id: string;
  profile_hash: string;
  profile_id: string;
  scope: AssessmentRunScope;
  session_id: string;
  started_at: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  triggered_by: AssessmentRunTriggeredBy;
  type: 'RTD'|'PM'|'UX'|'Frontend'|'Security'|'Reliability'|'Perf'|'Release'|'Launch'|'QA'|'Docs'|'Growth';
  verdict?: AssessmentVerdict;
}

export interface AssessmentRunConnectorSnapshot {
  captured_at: string;
  connector_id: string;
  etag?: string;
  kind: string;
  snapshot_id: string;
}

export interface AssessmentRunCountsFindings {
  critical?: number;
  high?: number;
  info?: number;
  low?: number;
  medium?: number;
}

export interface AssessmentRunCounts {
  evidence?: number;
  findings?: AssessmentRunCountsFindings;
  tool_calls?: number;
}

export interface AssessmentRunScope {
  base_commit_sha?: string;
  depth: 'quick'|'standard'|'full';
  diff_range?: string;
  path_globs?: string[];
  project_root: string;
  repo_ref?: string;
}

export interface AssessmentRunTriggeredBy {
  kind: 'user' | 'stage' | 'continuous' | 'orchestrator';
  source_ref?: string;
  user_id?: string;
}
