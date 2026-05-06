// Post-release monitor feed. Reads useRelease.observations and renders newest
// items first. Severity is treated as optional; when present, it drives the
// data-severity attribute and a row color so future severity-based UI lights
// up without store changes.

import type { CSSProperties } from 'react';
import { useRelease } from '../../stores/release';

const sectionStyle: CSSProperties = { marginTop: 12 };
const listStyle: CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const itemBase: CSSProperties = { padding: '4px 0', fontSize: 12 };

const SEVERITY_COLOR: Record<string, string> = {
  info: 'inherit',
  warn: 'var(--warn, #c98a13)',
  error: 'var(--error, #d04444)',
};

interface Props {
  limit?: number;
}

export function ObservationsFeed(props: Props) {
  const limit = props.limit ?? 200;
  const observations = useRelease((s) => s.observations);
  if (observations.length === 0) return null;

  const slice = observations.slice(-limit).slice().reverse();

  return (
    <section className="panel-card panel-card-pad" style={sectionStyle}>
      <h4 className="panel-title">Post-release monitor</h4>
      <ul style={listStyle} data-testid="observations-feed">
        {slice.map((o) => {
          const severity = (o as { severity?: string }).severity ?? 'info';
          const color = SEVERITY_COLOR[severity] ?? 'inherit';
          const itemStyle: CSSProperties = { ...itemBase, color };
          return (
            <li key={o.id} style={itemStyle} data-severity={severity}>
              [{o.connector}] {o.message} — {o.observed_at}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
