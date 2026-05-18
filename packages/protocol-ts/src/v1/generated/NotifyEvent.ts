// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/notify_event.schema.json

import type { EvidenceRef } from './EvidenceRef';

export interface NotifyEvent {
  action_id?: string;
  correlation_id?: string;
  evidence_ref?: EvidenceRef;
  id: string;
  lane: 'transient'|'persistent'|'sticky';
  message: string;
  severity: 'ok' | 'info' | 'warn' | 'error';
  subsystem: string;
  title: string;
  ts: string;
}
