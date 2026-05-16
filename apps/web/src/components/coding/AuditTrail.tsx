import { useMemo } from 'react';
import { useAudit, type AuditEntry, type AuditSource } from '../../stores/audit';

interface Props {
  /** When provided, only entries scoped to this requestId are shown. */
  filterRequestId?: string;
  /** Optional cap on rendered rows. The store is already bounded at AUDIT_CAP. */
  limit?: number;
}

function sourceLabel(s: AuditSource): string {
  if (s === 'bridge') return 'Bridge';
  if (s === 'user') return 'You';
  return 'System';
}

function formatTs(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return String(ts);
  }
}

export function AuditTrail({ filterRequestId, limit }: Props) {
  const entries = useAudit((s) => s.entries);
  const rows = useMemo(() => {
    let list: AuditEntry[] = entries;
    if (filterRequestId) list = list.filter((e) => e.requestId === filterRequestId);
    if (typeof limit === 'number' && limit >= 0) list = list.slice(0, limit);
    return list;
  }, [entries, filterRequestId, limit]);

  if (rows.length === 0) {
    return (
      <section className="codeworkspace-audittrail codeworkspace-audittrail-empty" data-testid="audit-trail-empty" aria-label="Audit trail empty">
        <p className="codeworkspace-audittrail-emptytext">
          No audit entries yet. Bridge events and your decisions will be recorded here as they happen.
        </p>
      </section>
    );
  }

  return (
    <section className="codeworkspace-audittrail" data-testid="audit-trail" aria-label="Audit trail">
      <header className="codeworkspace-audittrail-header">
        <h3>Audit trail</h3>
        <p className="codeworkspace-audittrail-truth">Read-only record of every bridge transition and your approvals.</p>
      </header>
      <ol className="codeworkspace-audittrail-list">
        {rows.map((e) => (
          <li
            key={e.id}
            className={`codeworkspace-audittrail-entry codeworkspace-audittrail-${e.source}`}
            data-testid="audit-trail-entry"
            data-source={e.source}
            data-request-id={e.requestId ?? ''}
          >
            <span className="codeworkspace-audittrail-ts">
              <time dateTime={new Date(e.ts).toISOString()}>{formatTs(e.ts)}</time>
            </span>
            <span className={`codeworkspace-audittrail-chip codeworkspace-audittrail-chip-${e.source}`}>{sourceLabel(e.source)}</span>
            <span className="codeworkspace-audittrail-kind">{e.kind}</span>
            {e.requestId ? <span className="codeworkspace-audittrail-req">{e.requestId}</span> : null}
            <span className="codeworkspace-audittrail-summary">{e.summary}</span>
            {e.status ? <span className="codeworkspace-audittrail-status" data-status={e.status}>{e.status}</span> : null}
            {e.detail ? <span className="codeworkspace-audittrail-detail">{e.detail}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function useAuditEntryCount(): number {
  return useAudit((s) => s.entries.length);
}
