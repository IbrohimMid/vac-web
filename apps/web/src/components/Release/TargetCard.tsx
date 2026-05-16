// Single deploy target card. Reads live state from useRelease/useGates/useSession
// so setTargets/upsertDeploy in the store flow through to the UI without prop drilling.
// Keeps the affordance gating identical to the legacy ReleaseTab.

import { useEffect, useMemo, type CSSProperties } from 'react';
import { useGates, type Gate, type GateId } from '../../stores/gates';
import { useRelease } from '../../stores/release';
import {
  mutationIntentList,
  useMutations,
  type MutationIntent,
  type MutationStatus,
} from '../../stores/mutations';
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

// Phase 3 (AUDIT-013) - provider chip styling. Two flavors:
// not_wired -> warn tone (deploy will be denied), dry_run -> info tone.
const providerBadgeBase: CSSProperties = {
  fontSize: 10.5,
  padding: '1px 6px',
  borderRadius: 4,
  marginLeft: 4,
};
const providerBadgeNotWired: CSSProperties = {
  ...providerBadgeBase,
  background: 'var(--warn-bg, rgba(201,138,19,0.18))',
  color: 'var(--warn, #c98a13)',
};
const providerBadgeDryRun: CSSProperties = {
  ...providerBadgeBase,
  background: 'var(--info-bg, rgba(58,142,219,0.18))',
  color: 'var(--info, #3a8edb)',
};

const RELEASE_BLOCKING_MUTATION_STATUSES = new Set<MutationStatus>([
  'pending',
  'approved',
  'applying',
  'failed',
]);

function isReleaseBlockingMutation(intent: MutationIntent): boolean {
  return RELEASE_BLOCKING_MUTATION_STATUSES.has(intent.status);
}

export function buildMutationAuditGate(intents: MutationIntent[], now = new Date().toISOString()): Gate {
  const blockers = intents
    .filter(isReleaseBlockingMutation)
    .map((intent) => `${intent.requestId} · ${intent.status} · ${intent.summary}`);
  const failedCount = intents.filter((intent) => intent.status === 'failed').length;
  const unresolvedCount = blockers.length;
  return {
    id: 'MutationAuditClean',
    state: unresolvedCount === 0 ? 'pass' : failedCount > 0 ? 'fail' : 'open',
    summary:
      unresolvedCount === 0
        ? 'Mutation audit is clean.'
        : `${unresolvedCount} mutation${unresolvedCount === 1 ? '' : 's'} must be resolved before release.`,
    blockers,
    criteria: [
      {
        id: 'no_unresolved_mutations',
        label: 'No pending, applying, or failed bridge mutations remain',
        satisfied: unresolvedCount === 0,
      },
    ],
    signers: [],
    required_signers: 0,
    overridden: false,
    last_changed_at: now,
  };
}

export function TargetCard({ targetId, transport }: Props) {
  const target = useRelease((s) => s.targets.get(targetId));
  const gates = useGates((s) => s.gates);
  const mutationIntentsById = useMutations((s) => s.intents);
  const mutationOrder = useMutations((s) => s.order);
  const sessionId = useSession((s) => s.sessionId);
  const openOverlay = useOverlays((s) => s.open);

  const mutationIntents = useMemo(
    () => mutationIntentList({ intents: mutationIntentsById, order: mutationOrder }),
    [mutationIntentsById, mutationOrder],
  );
  const mutationAuditGate = useMemo(
    () => buildMutationAuditGate(mutationIntents),
    [mutationIntents],
  );
  useEffect(() => {
    useGates.getState().upsert(mutationAuditGate);
  }, [mutationAuditGate]);
  const effectiveGates = useMemo(() => {
    const next = new Map(gates);
    next.set('MutationAuditClean', mutationAuditGate);
    return next;
  }, [gates, mutationAuditGate]);

  if (!target) return null;

  const required: GateId[] = ['DevComplete', 'ReadyToDeploy', 'MutationAuditClean'];
  if (target.environment === 'staging') required.push('ReadyForStaging');
  const missing = required.filter((id) => effectiveGates.get(id)?.state !== 'pass');
  const gateReady = missing.length === 0;
  const publishOk =
    effectiveGates.get('ReadyToPublish')?.state === 'pass' &&
    effectiveGates.get('MutationAuditClean')?.state === 'pass';

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
        {target.provider ? (
          <span
            data-testid={`release-target-${target.id}-provider`}
            data-provider={target.provider}
            style={
              target.provider === 'not_wired'
                ? providerBadgeNotWired
                : providerBadgeDryRun
            }
            aria-label={
              target.provider === 'not_wired'
                ? 'Release executor not wired - deploy will be denied'
                : 'Release executor in dry-run mode - no real ship'
            }
          >
            {target.provider === 'not_wired' ? 'not wired' : 'dry-run'}
          </span>
        ) : null}
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
