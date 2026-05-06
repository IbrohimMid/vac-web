// Single deploy target card. Reads live state from useRelease/useGates/useSession
// so setTargets/upsertDeploy in the store flow through to the UI without prop drilling.
// Keeps the affordance gating identical to the legacy ReleaseTab.

import type { CSSProperties } from 'react';
import { useGates, type GateId } from '../../stores/gates';
import { useRelease } from '../../stores/release';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import {
  affordanceFor,
  type AffordanceCommandStatus,
} from '../../domain/capabilities/affordanceCatalog';
import { commandStatus } from '../../generated/commandCatalog';

function toAffordanceStatus(id: string): AffordanceCommandStatus {
  const s = commandStatus(id);
  if (s === 'implemented' || s === 'frontend_owned' || s === 'not_wired') return s;
  return 'unknown';
}

const rowStyle: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-soft, rgba(255,255,255,0.06))',
};
const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const labelStyle: CSSProperties = { fontWeight: 600 };
const envStyle: CSSProperties = { opacity: 0.65, fontWeight: 400, fontSize: 12 };
const statusStyle: CSSProperties = { fontSize: 12, opacity: 0.75, marginTop: 4 };
const blockedStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--warn, #c98a13)',
  marginTop: 4,
};

interface Props {
  targetId: string;
  transport: TransportHandle | null;
}

export function TargetCard({ targetId, transport }: Props) {
  const target = useRelease((s) => s.targets.get(targetId));
  const gates = useGates((s) => s.gates);
  const sessionId = useSession((s) => s.sessionId);

  if (!target) return null;

  const required: GateId[] = ['DevComplete', 'ReadyToDeploy'];
  if (target.environment === 'staging') required.push('ReadyForStaging');
  const missing = required.filter((id) => gates.get(id)?.state !== 'pass');
  const gateReady = missing.length === 0;
  const publishOk = gates.get('ReadyToPublish')?.state === 'pass';

  const releaseDeployStatus = toAffordanceStatus('release.deploy');
  const deployDecision = affordanceFor('release.deploy.button', {
    commandStatus: releaseDeployStatus,
    hasTransport: !!transport,
    hasSessionId: !!sessionId,
    gateReady,
  });

  const deploy = async () => {
    if (!transport || !sessionId || !gateReady) return;
    try {
      await transport.send(sessionId, 'release.deploy', { target_id: target.id });
    } catch {
      /* surfaced via notify */
    }
  };
  const publish = async () => {
    if (!transport || !sessionId || !publishOk) return;
    try {
      await transport.send(sessionId, 'release.publish', { target_id: target.id });
    } catch {
      /* surfaced via notify */
    }
  };
  const generateNotes = async () => {
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'release.generate_notes', { target_id: target.id });
    } catch {
      /* surfaced via notify */
    }
  };

  return (
    <li style={rowStyle} data-testid={`release-target-${target.id}`}>
      <div style={headerStyle}>
        <strong style={labelStyle}>
          {target.label} <span style={envStyle}>({target.environment})</span>
        </strong>
        <button
          onClick={deploy}
          disabled={!deployDecision.enabled}
          data-affordance-id={deployDecision.affordanceId}
          title={deployDecision.disabledReason ?? ''}
        >
          Deploy
        </button>
        <button onClick={publish} disabled={!publishOk || !transport}>
          Publish
        </button>
        <button onClick={generateNotes} disabled={!transport}>
          Release notes
        </button>
      </div>
      <div style={statusStyle}>
        last: {target.last_status}
        {target.last_commit ? ` @ ${target.last_commit.slice(0, 8)}` : ''}
        {target.last_deployed_at ? ` · ${target.last_deployed_at}` : ''}
      </div>
      {missing.length > 0 && (
        <div style={blockedStyle}>Blocked by: {missing.join(', ')}</div>
      )}
    </li>
  );
}
