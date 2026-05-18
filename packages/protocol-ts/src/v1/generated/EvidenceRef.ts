// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/evidence_ref.schema.json

export interface EvidenceRef {
  captured_by: string;
  captured_snapshot_id?: string;
  connector_id?: string;
  digest?: string;
  fresh_until: string;
  id: string;
  kind: 'file' | 'commit' | 'pr' | 'doc' | 'connector' | 'screenshot' | 'metric' | 'log' | 'missing';
  locator?: Record<string, unknown>;
  mime_type?: string;
  observed_at: string;
  size?: number;
  snapshot_id?: string;
  source_etag?: string;
  staleness_policy: 'hard_expire' | 'warn_only' | 'immutable';
  uri: string;
}
