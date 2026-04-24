import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import { attachHighlightObserver } from '../../highlight/visibility';
import { useTranscript } from '../../stores/transcript';
import { MessageRow } from './MessageRow';

const ESTIMATED_ROW = 140;

export function Transcript() {
  const order = useTranscript((s) => s.order);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virt = useVirtualizer({
    count: order.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: 5,
    getItemKey: (i) => order[i] ?? i,
  });

  useEffect(() => {
    return attachHighlightObserver(parentRef.current);
  }, []);

  return (
    <section
      ref={parentRef}
      className="transcript"
      role="log"
      aria-label="Assistant transcript"
      aria-live="polite"
      aria-relevant="additions text"
      style={{
        height: '60vh',
        overflowY: 'auto',
        position: 'relative',
        border: '1px solid #eee',
      }}
    >
      <div
        style={{
          height: virt.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virt.getVirtualItems().map((v) => (
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
            }}
          >
            <MessageRow id={order[v.index]!} />
          </div>
        ))}
      </div>
    </section>
  );
}
