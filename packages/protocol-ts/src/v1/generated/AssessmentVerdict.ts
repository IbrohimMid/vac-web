// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/assessment_verdict.schema.json

export interface AssessmentVerdict {
  blockers?: string[];
  score?: number;
  status: 'READY'|'CONDITIONAL'|'BLOCKED'|'PASS'|'WARN'|'FAIL';
  summary: string;
  synthesizer_agent_id?: string;
  top_wins?: string[];
  warnings?: string[];
}
