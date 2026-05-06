// Release plane: thin route shell. Composition lives in ReleasePanel and its
// sub-components (TargetCard, DeployProgressList, NotesDraftView, ObservationsFeed),
// each of which reads from useRelease so live store updates flow into the UI
// without prop drilling. Mounting this view also requests the deploy target
// list once via the WS transport.

import { useEffect } from 'react';
import { useRelease } from '../../stores/release';
import type { TransportHandle } from '../../transport';
import { ReleasePanel } from './ReleasePanel';

interface Props {
  transport: TransportHandle | null;
}

export function ReleaseTab({ transport }: Props) {
  const targetCount = useRelease((s) => s.targets.size);

  useEffect(() => {
    if (!transport) return;
    transport.send('', 'release.list_targets', {}).catch(() => {});
  }, [transport]);

  return (
    <div role="region" aria-label="Release plane" className="screen-shell">
      <header className="screen-hero">
        <div className="screen-hero-row">
          <div>
            <h3 className="screen-title">Release plane</h3>
            <div className="screen-subtitle">
              Coordinate deploy targets, release notes, and post-release monitoring.
            </div>
          </div>
          <span className="badge">{targetCount} targets</span>
        </div>
      </header>
      <ReleasePanel transport={transport} />
    </div>
  );
}
