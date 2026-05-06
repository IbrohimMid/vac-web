// Static perf indicator surfaced in the cockpit topbar. The badge is
// intentionally non-reactive for F5c-web slice 1: it announces that the
// perf-baseline pipeline (F5c-CI) is wired and reporting OK by default.
// Future slices will subscribe this to the readiness/perf store and flip
// state based on baseline diffs.

import type { CSSProperties } from 'react';

interface Props {
  state?: 'ok' | 'warn' | 'crit';
  label?: string;
}

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

export function PerfBadge({ state = 'ok', label }: Props) {
  const text = label ?? `perf: ${state}`;
  return (
    <span
      role='status'
      aria-label={text}
      data-testid='perf-badge'
      data-perf-state={state}
      className={`perf-badge ${state}`}
      title='Perf baseline status (F5c-CI). Static OK until perf telemetry lands.'
      style={BADGE_STYLE}
    >
      <span style={DOT_STYLE} aria-hidden='true' />
      {text}
    </span>
  );
}
