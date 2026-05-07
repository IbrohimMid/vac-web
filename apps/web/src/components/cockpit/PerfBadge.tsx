// Perf indicator surfaced in the cockpit topbar. Subscribes to the
// perf store (driven by perf.run_completed frames from the bridge),
// and requests the latest baseline snapshot on mount via perf.latest_run.
//
// Producer: apps/local-bridge/src/perf.rs (Slice F5c-CI / F5c-web).
// Bridge status union: 'unknown' | 'ok' | 'warn' | 'crit'.
//   unknown -> visual='ok', text='perf: \u2014' (em dash placeholder)
//   ok      -> visual='ok'
//   warn    -> visual='warn'
//   crit    -> visual='crit'

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { usePerf } from '../../stores/perf';
import type { TransportHandle } from '../../transport';

interface Props {
  transport?: TransportHandle | null;
}

type VisualState = 'ok' | 'warn' | 'crit';

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
  lineHeight: 1,
  letterSpacing: 0.2,
};

const DOT_STYLE: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  display: 'inline-block',
  background: 'currentColor',
};

export function PerfBadge({ transport = null }: Props) {
  const status = usePerf((s) => s.status);
  const requestStatus = usePerf((s) => s.requestStatus);
  const requestLatest = usePerf((s) => s.requestLatest);

  useEffect(() => {
    if (transport && requestStatus === 'idle') {
      void requestLatest(transport);
    }
  }, [transport, requestStatus, requestLatest]);

  const visual: VisualState =
    status === 'warn' ? 'warn' : status === 'crit' ? 'crit' : 'ok';
  const text = status === 'unknown' ? 'perf: \u2014' : `perf: ${status}`;

  return (
    <span
      role='status'
      aria-label={text}
      data-testid='perf-badge'
      data-perf-state={visual}
      data-perf-status={status}
      className={`perf-badge ${visual}`}
      title='Perf baseline status (F5c-CI). Updated on perf.run_completed.'
      style={BADGE_STYLE}
    >
      <span style={DOT_STYLE} aria-hidden='true' />
      {text}
    </span>
  );
}
