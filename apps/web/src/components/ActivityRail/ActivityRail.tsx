import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { SeverityIcon } from '../SeverityIcon';
import { useActivity } from '../../stores/activity';

export function ActivityRail() {
  const entries = useActivity((s) => s.entries);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virt = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 5,
    getItemKey: (i) => entries[i]?.id ?? i,
  });

  if (entries.length === 0) {
    return (
      <aside style={{ padding: 8, fontSize: 12, color: 'var(--text-2)' }}>
        No activity yet.
      </aside>
    );
  }

  return (
    <aside
      ref={parentRef}
      aria-label="Activity timeline"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        height: 200,
        overflowY: 'auto',
        position: 'relative',
        margin: '8px 0',
      }}
    >
      <header
        style={{
          padding: 8,
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
          fontWeight: 600,
          position: 'sticky',
          top: 0,
          background: 'var(--surface-1)',
        }}
      >
        Activity
      </header>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((v) => {
          const e = entries[v.index];
          if (!e) return null;
          return (
            <div
              key={v.key}
              ref={virt.measureElement}
              data-index={v.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${v.start}px)`,
                padding: '6px 8px',
                borderBottom: '1px solid var(--border)',
                fontSize: 12,
                display: 'flex',
                gap: 8,
              }}
            >
              <SeverityIcon severity={e.severity} />
              <div style={{ flex: 1 }}>
                <div>{e.summary}</div>
                <div style={{ color: 'var(--text-2)', fontSize: 11 }}>
                  <code>{e.subsystem}</code> · {new Date(e.ts).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
