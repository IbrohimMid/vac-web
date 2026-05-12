// Recent deploys feed. Reads useRelease.deploys + deployOrder for live updates
// emitted by release.deploy_progress events.

import type { CSSProperties } from 'react';
import { useRelease } from '../../stores/release';

const sectionStyle: CSSProperties = { marginTop: 12 };
const listStyle: CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const itemBase: CSSProperties = { padding: '4px 0', fontSize: 12 };

const STATUS_COLOR: Record<string, string> = {
  idle: 'var(--muted, #9aa)',
  queued: 'var(--info, #3a8edb)',
  deploying: 'var(--warn, #c98a13)',
  deployed: 'var(--success, #3aab66)',
  // Phase 3 (AUDIT-013) - dry-run is a no-op event, render in info tone
  // so it never reads as a successful ship.
  dry_run: 'var(--info, #3a8edb)',
  failed: 'var(--error, #d04444)',
  rolled_back: 'var(--warn, #c98a13)',
};

// Phase 3 (AUDIT-013) - badge style for the dry-run annotation in deploy rows.
const dryRunBadgeStyle: CSSProperties = {
  marginLeft: 6,
  fontSize: 10.5,
  opacity: 0.9,
};

interface Props {
  limit?: number;
}

export function DeployProgressList(props: Props) {
  const limit = props.limit ?? 8;
  const deploys = useRelease((s) => s.deploys);
  const deployOrder = useRelease((s) => s.deployOrder);

  if (deployOrder.length === 0) {
    return (
      <section className="panel-card panel-card-pad" style={sectionStyle}>
        <h4 className="panel-title">Recent deploys</h4>
        <div className="panel-subtitle">No deploys yet.</div>
      </section>
    );
  }

  const recent = deployOrder.slice(-limit).slice().reverse();

  return (
    <section className="panel-card panel-card-pad" style={sectionStyle}>
      <h4 className="panel-title">Recent deploys</h4>
      <ul style={listStyle} data-testid="deploy-progress-list">
        {recent.map((id) => {
          const d = deploys.get(id);
          if (!d) return null;
          const color = STATUS_COLOR[d.status] ?? 'inherit';
          const itemStyle: CSSProperties = { ...itemBase, color };
          return (
            <li key={id} style={itemStyle} data-status={d.status}>
              <code>{d.commit.slice(0, 8)}</code> → {d.target_id} · {d.status}
              {d.status === 'dry_run' ? (
                <span
                  data-testid={`deploy-${id}-dry-run`}
                  style={dryRunBadgeStyle}
                  aria-label="Dry-run deploy: no real release was performed"
                >
                  {' (no real ship)'}
                </span>
              ) : null}
              {d.finished_at ? ` · ${d.finished_at}` : ''}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
