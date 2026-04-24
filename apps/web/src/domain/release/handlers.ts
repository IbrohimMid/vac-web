// Wire release.* transport events → release store.

import {
  useRelease,
  type DeployEvent,
  type DeployStatus,
  type DeployTarget,
  type PostDeployObservation,
  type ReleaseNotesDraft,
} from '../../stores/release';
import type { TransportHandle } from '../../transport';

function asDeployStatus(raw: string | undefined): DeployStatus {
  if (
    raw === 'queued' ||
    raw === 'deploying' ||
    raw === 'deployed' ||
    raw === 'failed' ||
    raw === 'rolled_back'
  )
    return raw;
  return 'idle';
}

export function registerReleaseHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('release.targets', (ev) => {
      const p = ev.payload as { targets?: DeployTarget[] } | null;
      if (!p?.targets) return;
      useRelease.getState().setTargets(p.targets);
    }),
  );

  offs.push(
    transport.on('release.deploy_progress', (ev) => {
      const p = ev.payload as {
        deploy_id: string;
        target_id: string;
        commit: string;
        status: string;
        started_at: string;
        finished_at?: string;
        packet_id?: string;
      } | null;
      if (!p?.deploy_id) return;
      const deployEvent: DeployEvent = {
        id: p.deploy_id,
        target_id: p.target_id,
        commit: p.commit,
        status: asDeployStatus(p.status),
        started_at: p.started_at,
        ...(p.finished_at !== undefined ? { finished_at: p.finished_at } : {}),
        ...(p.packet_id !== undefined ? { packet_id: p.packet_id } : {}),
      };
      useRelease.getState().upsertDeploy(deployEvent);
    }),
  );

  offs.push(
    transport.on('release.notes_draft', (ev) => {
      const p = ev.payload as ReleaseNotesDraft | null;
      if (!p?.id) return;
      useRelease.getState().setNotes(p);
    }),
  );

  offs.push(
    transport.on('release.post_deploy_observation', (ev) => {
      const p = ev.payload as PostDeployObservation | null;
      if (!p?.id) return;
      useRelease.getState().appendObservation(p);
    }),
  );

  return () => offs.forEach((off) => off());
}
