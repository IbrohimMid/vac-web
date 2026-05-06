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

interface Props {
  transport: TransportHandle | null;
}

export function ReleasePanel({ transport }: Props) {
  const targets = useRelease((s) => s.targets);
  const targetIds = useMemo(() => Array.from(targets.keys()), [targets]);

  return (
    <div style={gridStyle} data-testid="release-panel">
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
