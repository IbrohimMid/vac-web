// Virtualized findings list — extracted from ReadinessHub for reuse by
// AssessmentReportDetail (Stage J). Behavior unchanged from the original
// inline implementation: TanStack Virtual scroll, role="list" / "listitem"
// landmarks, FindingCard render per item, empty state.
//
// Optional selection props (Stage J): when `selection` and `onToggle` are
// passed, each row gets a checkbox at the front. The selection set lives in
// stores/assessmentReport.ts so it persists across report-mode toggles.

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FindingCard } from './FindingCard';
import type { Finding } from '../../stores/assessment';
import type { TransportHandle } from '../../transport';

interface Props {
  findings: Finding[];
  transport: TransportHandle | null;
  selection?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  /** Optional override for max-height (report mode wants more vertical space). */
  maxHeight?: number;
}

export function FindingsList({
  findings,
  transport,
  selection,
  onToggle,
  maxHeight = 520,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: findings.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 120,
    overscan: 8,
  });
  if (findings.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--ink-3)' }}>
        No findings (yet) at current filters.
      </div>
    );
  }
  return (
    <div ref={ref} style={{ maxHeight, overflow: 'auto' }}>
      <div
        role="list"
        aria-label="Findings"
        style={{ height: v.getTotalSize(), position: 'relative' }}
      >
        {v.getVirtualItems().map((item) => {
          const f = findings[item.index];
          if (!f) return null;
          const checked = selection?.has(f.id) ?? false;
          return (
            <div
              key={item.key}
              role="listitem"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${item.start}px)`,
                display: onToggle ? 'flex' : 'block',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              {onToggle && (
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(f.id)}
                  aria-label={`Select finding ${f.title}`}
                  style={{
                    marginTop: 14,
                    marginLeft: 8,
                    accentColor: 'var(--accent)',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <FindingCard finding={f} transport={transport} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
