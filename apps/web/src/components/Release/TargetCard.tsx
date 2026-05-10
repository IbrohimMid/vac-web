// Single deploy target card. Reads live state from useRelease/useGates/useSession
// so setTargets/upsertDeploy in the store flow through to the UI without prop drilling.
// Keeps the affordance gating identical to the legacy ReleaseTab.

import type { CSSProperties } from 'react';
import { useGates, type GateId } from '../../stores/gates';
import { useRelease } from '../../stores/release';
import { useSession } from '../../stores/session';
import { useOverlays } from '../../stores/overlays';
import type { TransportHandle } from '../../transport';
import {
  affordanceFor,
  toAffordanceStatus,
} from '../../domain/capabilities/affordanceCatalog';

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
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};
const gateLinkStyle: CSSProperties = {
  appearance: 'none',
  border: 0,
  padding: 0,
  margin: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  cursor: 'pointer',
};
const disabledReasonListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 6,
};
const disabledReasonStyle: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.45,
  color: 'var(--ink-3)',
};

interface Props {
  targetId: string;
  transport: TransportHandle | null;
}

export function TargetCard({ targetId, transport }: Props) {
  const target = useRelease((s) => s.targets.get(targetId));
  const gates = useGates((s) => s.gates);
  const sessionId = useSession((s) => s.sessionId);
  const openOverlay = useOverlays((s) => s.open);

  if (!target) return null;

  const required: GateId[] = ['DevComplete', 'ReadyToDeploy'];
  if (target.environment === 'staging') required.push('ReadyForStaging');
  const missing = required.filter((id) => gates.get(id)?.state !== 'pass');
  const gateReady = missing.length === 0;
  const publishOk = gates.get('ReadyToPublish')?.state === 'pass';

  const deployDecision = affordanceFor('release.deploy.button', {
    commandStatus: toAffordanceStatus('release.deploy'),
    hasTransport: !!transport,
    hasSessionId: !!sessionId,
    gateReady,
  });
  const publishDecision = affordanceFor('release.publish.button', {
    commandStatus: toAffordanceStatus('release.publish'),
    hasTransport: !!transport,
    hasSessionId: !!sessionId,
    gateReady: publishOk,
  });
  const notesDecision = affordanceFor('release.generate_notes.button', {
    commandStatus: toAffordanceStatus('release.generate_notes'),
    hasTransport: !!transport,
    hasSessionId: !!sessionId,
  });
  const disabledReasons = [
    { label: 'Deploy', decision: deployDecision },
    { label: 'Publish', decision: publishDecision },
    { label: 'Release notes', decision: notesDecision },
  ].filter((item) => !item.decision.enabled && item.decision.disabledReason);

  const deploy = async () => {
    if (!deployDecision.enabled) return;
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'release.deploy', { target_id: target.id });
    } catch {
      /* surfaced via notify */
    }
  };
  const publish = async () => {
    if (!publishDecision.enabled) return;
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'release.publish', { target_id: target.id });
    } catch {
      /* surfaced via notify */
    }
  };
  const generateNotes = async () => {
    if (!notesDecision.enabled) return;
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'release.generate_notes', { target_id: target.id });
    } catch {
      /* surfaced via notify */
    }
  };

  const openGate = (gateId: GateId) => {
    openOverlay('gate_detail', { gateId, transport });
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
        <button
          onClick={publish}
          disabled={!publishDecision.enabled}
          data-affordance-id={publishDecision.affordanceId}
          title={publishDecision.disabledReason ?? ''}
        >
          Publish
        </button>
        <button
          onClick={generateNotes}
          disabled={!notesDecision.enabled}
          data-affordance-id={notesDecision.affordanceId}
          title={notesDecision.disabledReason ?? ''}
        >
          Release notes
        </button>
      </div>
      <div style={statusStyle}>
        last: {target.last_status}
        {target.last_commit ? ` @ ${target.last_commit.slice(0, 8)}` : ''}
        {target.last_deployed_at ? ` · ${target.last_deployed_at}` : ''}
      </div>
      {disabledReasons.length > 0 && (
        <div style={disabledReasonListStyle} aria-label="Disabled release actions">
          {disabledReasons.map(({ label, decision }) => (
            <div
              key={label}
              role="note"
              tabIndex={0}
              style={disabledReasonStyle}
            >
              {label}: {decision.disabledReason}
            </div>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <div style={blockedStyle} aria-label="Blocked release gates">
          <span>Blocked by:</span>
          {missing.map((gateId, index) => (
            <span key={gateId}>
              {index > 0 && <span aria-hidden="true">, </span>}
              <button
                type="button"
                style={gateLinkStyle}
                onClick={() => openGate(gateId)}
                data-testid={`release-blocked-gate-${gateId}`}
                aria-label={`Open ${gateId} gate detail`}
                title={`Open ${gateId} gate detail`}
              >
                {gateId}
              </button>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
