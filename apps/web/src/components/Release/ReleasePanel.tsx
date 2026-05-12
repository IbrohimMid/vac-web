// Two-column composition for the release plane. Reads useRelease.targets to
// drive the deploy-target column; the deploys/notes/observations columns own
// their own selectors so each subview re-renders on its own slice.

import { useMemo, type CSSProperties } from 'react';
import { useRelease } from '../../stores/release';
import type { TransportHandle } from '../../transport';
import { TargetCard } from './TargetCard';
import { DeployProgressList } from './DeployProgressList';
import { NotesDraftView } from './NotesDraftView';
import { ObservationsFeed } from './ObservationsFeed';

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
  gap: 16,
  alignItems: 'start',
};
const columnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const targetListStyle: CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };

// Phase 3 (AUDIT-013) - provider banner styles. not_wired uses warn tone
// (actions will be denied), dry_run uses info tone (synthetic event only).
const providerBannerBase: CSSProperties = {
  gridColumn: '1 / -1',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 12.5,
  lineHeight: 1.45,
};
const providerBannerNotWired: CSSProperties = {
  ...providerBannerBase,
  background: 'var(--warn-bg, rgba(201,138,19,0.18))',
  color: 'var(--warn, #c98a13)',
};
const providerBannerDryRun: CSSProperties = {
  ...providerBannerBase,
  background: 'var(--info-bg, rgba(58,142,219,0.18))',
  color: 'var(--info, #3a8edb)',
};

interface Props {
  transport: TransportHandle | null;
}

export function ReleasePanel({ transport }: Props) {
  const targets = useRelease((s) => s.targets);
  const targetIds = useMemo(() => Array.from(targets.keys()), [targets]);
  // Phase 3 (AUDIT-013) - surface a panel-level banner whenever the bridge is
  // in `not_wired` mode (deploy/publish will be denied) or in `dry_run` mode
  // (no real ship). Provider is shared across targets in practice; collapse
  // to the strongest signal (`not_wired` wins over `dry_run`).
  const providerSummary = useMemo(() => {
    const all = Array.from(targets.values());
    if (all.length === 0) return null;
    if (all.some((t) => t.provider === 'not_wired')) return 'not_wired' as const;
    if (all.every((t) => t.provider === 'dry_run')) return 'dry_run' as const;
    return null;
  }, [targets]);

  return (
    <div style={gridStyle} data-testid="release-panel">
      {providerSummary === 'not_wired' && (
        <div
          data-testid="release-provider-banner"
          data-provider="not_wired"
          role="alert"
          style={providerBannerNotWired}
        >
          Release executor is not wired. Deploy and publish actions will be
          rejected by the bridge with <code>release.provider_not_wired</code>.
        </div>
      )}
      {providerSummary === 'dry_run' && (
        <div
          data-testid="release-provider-banner"
          data-provider="dry_run"
          role="status"
          style={providerBannerDryRun}
        >
          Release executor is in dry-run mode. Deploys and publishes return a
          single synthetic event - no real ship is performed.
        </div>
      )}
      <div style={columnStyle}>
        <section className="panel-card panel-card-pad">
          <h4 className="panel-title">
            Deploy targets <span className="badge">{targetIds.length}</span>
          </h4>
          {targetIds.length === 0 ? (
            <div className="panel-subtitle">No deploy targets configured.</div>
          ) : (
            <ul style={targetListStyle}>
              {targetIds.map((id) => (
                <TargetCard key={id} targetId={id} transport={transport} />
              ))}
            </ul>
          )}
        </section>
        <DeployProgressList />
      </div>
      <div style={columnStyle}>
        <NotesDraftView />
        <ObservationsFeed />
      </div>
    </div>
  );
}
