// Workbench tab shell. Default 'transcript'; Phase 3 tabs swap primary pane.
// Badges on tabs carry live counts (pending approvals, jobs running).

import type { ReactNode } from 'react';
import { useApprovals } from '../../stores/approvals';
import { useAssessment } from '../../stores/assessment';
import { useHandoff } from '../../stores/handoff';
import { useRuntime } from '../../stores/runtime';
import { useReview } from '../../stores/review';
import { useWorkbench, type WorkbenchTab } from '../../stores/workbench';

const TABS: { id: WorkbenchTab; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'review', label: 'Review' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'handoff', label: 'Handoff' },
  { id: 'release', label: 'Release' },
  { id: 'migration', label: 'Migration' },
  { id: 'archive', label: 'Archive' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'connectors', label: 'Connectors' },
];

interface Props {
  panes: Partial<Record<WorkbenchTab, ReactNode>>;
}

export function Workbench({ panes }: Props) {
  const active = useWorkbench((s) => s.active);
  const select = useWorkbench((s) => s.select);
  const pendingCount = useApprovals((s) => s.pendingOrder.length);
  const jobsCount = useRuntime((s) => s.order.length);
  const reviewCount = useReview((s) => s.files.length);
  // Reduce over Map values — primitive return keeps selector stable without a
  // shallow-equality comparator.
  const runningRuns = useAssessment((s) => {
    let n = 0;
    for (const r of s.runs.values()) if (r.status === 'running') n++;
    return n;
  });
  const pendingPackets = useHandoff((s) => {
    let n = 0;
    for (const p of s.packets.values())
      if (
        p.status === 'pending_approval' ||
        p.status === 'dispatched' ||
        p.status === 'executing'
      )
        n++;
    return n;
  });

  const badge = (tab: WorkbenchTab): number | null => {
    if (tab === 'approvals') return pendingCount || null;
    if (tab === 'runtime') return jobsCount || null;
    if (tab === 'review') return reviewCount || null;
    if (tab === 'readiness') return runningRuns || null;
    if (tab === 'handoff') return pendingPackets || null;
    return null;
  };

  return (
    <section aria-label="Workbench" style={{ marginTop: 8 }}>
      <nav
        role="tablist"
        aria-label="Workbench tabs"
        style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--line)',
        }}
      >
        {TABS.map((t) => {
          const isActive = active === t.id;
          const b = badge(t.id);
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => select(t.id)}
              style={{
                background: isActive ? 'var(--bg-2, #222)' : 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--accent, #5af)' : '2px solid transparent',
                color: 'var(--text-1)',
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              {t.label}
              {b ? (
                <span
                  aria-label={`${b} items`}
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    padding: '0 5px',
                    borderRadius: 9,
                    background: 'var(--accent, #5af)',
                    color: '#000',
                  }}
                >
                  {b}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div role="tabpanel" aria-label={active}>
        {panes[active] ?? <div style={{ padding: 16, color: 'var(--text-2)' }}>Not available.</div>}
      </div>
    </section>
  );
}
