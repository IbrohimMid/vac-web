import { useMemo, useState } from 'react';
import {
  useAudit,
  auditErrorCodeCounts,
  type AuditEntry,
  type AuditSource,
} from '../../stores/audit';

interface Props {
  /** When provided, only entries scoped to this requestId are shown. */
  filterRequestId?: string;
  /** Optional cap on rendered rows. The store is already bounded at AUDIT_CAP. */
  limit?: number;
  /**
   * B11 — when true, render a chip row above the list with one chip per
   * distinct errorCode + count. Click a chip to narrow the trail to just that
   * code; click again (or the dedicated clear button) to reset.
   */
  showErrorCodeFilter?: boolean;
  /**
   * B11 — when true, runs of consecutive entries with the same errorCode
   * collapse into a single <details> group showing the count and the code, so
   * a single agent hammering the shell allowlist with the same blocked
   * command does not flood the trail. Click the group to expand the children.
   */
  groupDeniedAttempts?: boolean;
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

type RowItem =
  | { type: 'entry'; entry: AuditEntry }
  | { type: 'group'; code: string; entries: AuditEntry[] };

function groupConsecutiveByErrorCode(rows: AuditEntry[]): RowItem[] {
  const out: RowItem[] = [];
  let cluster: AuditEntry[] = [];
  let clusterCode: string | null = null;
  const flush = () => {
    if (cluster.length >= 2 && clusterCode) {
      out.push({ type: 'group', code: clusterCode, entries: cluster });
    } else {
      for (const e of cluster) out.push({ type: 'entry', entry: e });
    }
    cluster = [];
    clusterCode = null;
  };
  for (const e of rows) {
    if (e.errorCode && e.errorCode === clusterCode) {
      cluster.push(e);
    } else {
      flush();
      if (e.errorCode) {
        cluster = [e];
        clusterCode = e.errorCode;
      } else {
        out.push({ type: 'entry', entry: e });
      }
    }
  }
  flush();
  return out;
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  return (
    <li
      className={`codeworkspace-audittrail-entry codeworkspace-audittrail-${entry.source}`}
      data-testid="audit-trail-entry"
      data-source={entry.source}
      data-request-id={entry.requestId ?? ''}
      data-error-code={entry.errorCode ?? ''}
    >
      <span className="codeworkspace-audittrail-ts">
        <time dateTime={new Date(entry.ts).toISOString()}>{formatTs(entry.ts)}</time>
      </span>
      <span className={`codeworkspace-audittrail-chip codeworkspace-audittrail-chip-${entry.source}`}>{sourceLabel(entry.source)}</span>
      <span className="codeworkspace-audittrail-kind">{entry.kind}</span>
      {entry.requestId ? <span className="codeworkspace-audittrail-req">{entry.requestId}</span> : null}
      <span className="codeworkspace-audittrail-summary">{entry.summary}</span>
      {entry.status ? <span className="codeworkspace-audittrail-status" data-status={entry.status}>{entry.status}</span> : null}
      {entry.errorCode ? (
        <span className="codeworkspace-audittrail-errorcode" data-error-code={entry.errorCode}>{entry.errorCode}</span>
      ) : null}
      {entry.detail ? <span className="codeworkspace-audittrail-detail">{entry.detail}</span> : null}
    </li>
  );
}

export function AuditTrail({ filterRequestId, limit, showErrorCodeFilter, groupDeniedAttempts }: Props) {
  const entries = useAudit((s) => s.entries);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const codeCounts = useMemo(
    () => (showErrorCodeFilter ? auditErrorCodeCounts({ entries }) : []),
    [entries, showErrorCodeFilter],
  );

  const rows = useMemo(() => {
    let list: AuditEntry[] = entries;
    if (filterRequestId) list = list.filter((e) => e.requestId === filterRequestId);
    if (selectedCode) list = list.filter((e) => e.errorCode === selectedCode);
    if (typeof limit === 'number' && limit >= 0) list = list.slice(0, limit);
    return list;
  }, [entries, filterRequestId, selectedCode, limit]);

  const items = useMemo(
    () =>
      groupDeniedAttempts
        ? groupConsecutiveByErrorCode(rows)
        : rows.map<RowItem>((entry) => ({ type: 'entry', entry })),
    [rows, groupDeniedAttempts],
  );

  const hasEntries = entries.length > 0;
  const showEmpty = rows.length === 0;

  return (
    <section
      className={`codeworkspace-audittrail${showEmpty && !hasEntries ? ' codeworkspace-audittrail-empty' : ''}`}
      data-testid={hasEntries ? 'audit-trail' : 'audit-trail-empty'}
      aria-label={hasEntries ? 'Audit trail' : 'Audit trail empty'}
    >
      {hasEntries ? (
        <header className="codeworkspace-audittrail-header">
          <h3>Audit trail</h3>
          <p className="codeworkspace-audittrail-truth">Read-only record of every bridge transition and your approvals.</p>
        </header>
      ) : null}

      {showErrorCodeFilter && codeCounts.length > 0 ? (
        <div
          className="codeworkspace-audittrail-filterbar"
          data-testid="audit-trail-filterbar"
          role="group"
          aria-label="Filter by error code"
        >
          {codeCounts.map(({ code, count }) => {
            const active = selectedCode === code;
            return (
              <button
                key={code}
                type="button"
                className={`codeworkspace-audittrail-filterchip${active ? ' codeworkspace-audittrail-filterchip-active' : ''}`}
                data-testid={`audit-trail-filter-chip-${code}`}
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
                onClick={() => setSelectedCode(active ? null : code)}
              >
                <span className="codeworkspace-audittrail-filterchip-code">{code}</span>
                <span className="codeworkspace-audittrail-filterchip-count">{count}</span>
              </button>
            );
          })}
          {selectedCode ? (
            <button
              type="button"
              className="codeworkspace-audittrail-filterclear"
              data-testid="audit-trail-filter-clear"
              onClick={() => setSelectedCode(null)}
            >
              Clear filter
            </button>
          ) : null}
        </div>
      ) : null}

      {showEmpty ? (
        <p className="codeworkspace-audittrail-emptytext" data-testid="audit-trail-empty-text">
          {hasEntries
            ? `No audit entries match this filter${selectedCode ? ` (${selectedCode})` : ''}.`
            : 'No audit entries yet. Bridge events and your decisions will be recorded here as they happen.'}
        </p>
      ) : (
        <ol className="codeworkspace-audittrail-list">
          {items.map((item) => {
            if (item.type === 'entry') {
              return <EntryRow key={item.entry.id} entry={item.entry} />;
            }
            return (
              <li key={`group-${item.entries[0]?.id ?? item.code}`} className="codeworkspace-audittrail-grouprow">
                <details
                  className="codeworkspace-audittrail-group"
                  data-testid="audit-trail-group"
                  data-error-code={item.code}
                  data-count={item.entries.length}
                >
                  <summary className="codeworkspace-audittrail-group-summary">
                    <span className="codeworkspace-audittrail-group-count">{item.entries.length}×</span>
                    <span className="codeworkspace-audittrail-group-code">{item.code}</span>
                    <span className="codeworkspace-audittrail-group-label">denied (consecutive)</span>
                  </summary>
                  <ol className="codeworkspace-audittrail-group-children">
                    {item.entries.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} />
                    ))}
                  </ol>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function useAuditEntryCount(): number {
  return useAudit((s) => s.entries.length);
}
