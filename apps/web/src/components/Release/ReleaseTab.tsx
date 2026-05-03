// Release plane: Deploy + Publish + Release Notes + Post-release Monitor.
// Gate-guarded: Deploy requires DevComplete + ReadyToDeploy (and ReadyForStaging
// if the target environment is staging). Publish requires ReadyToPublish.

import { useEffect, useMemo } from 'react';
import { useGates, type GateId } from '../../stores/gates';
import { useRelease, type DeployTarget } from '../../stores/release';
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

interface Props {
  transport: TransportHandle | null;
}

export function ReleaseTab({ transport }: Props) {
  const targets = useRelease((s) => s.targets);
  const deploys = useRelease((s) => s.deploys);
  const deployOrder = useRelease((s) => s.deployOrder);
  const notes = useRelease((s) => s.notes);
  const observations = useRelease((s) => s.observations);
  const gates = useGates((s) => s.gates);
  const sessionId = useSession((s) => s.sessionId);

  useEffect(() => {
    if (!transport) return;
    transport.send('', 'release.list_targets', {}).catch(() => {});
  }, [transport]);

  const gatesFor = (env: DeployTarget['environment']): GateId[] => {
    const required: GateId[] = ['DevComplete', 'ReadyToDeploy'];
    if (env === 'staging') required.push('ReadyForStaging');
    return required;
  };

  const canDeploy = (env: DeployTarget['environment']) =>
    gatesFor(env).every((id) => gates.get(id)?.state === 'pass');

  const canPublish = () => gates.get('ReadyToPublish')?.state === 'pass';

  // Slice 33 follow-up: route the Deploy button through the declarative
  // affordance catalog so disabled-copy stays consistent with other
  // command-bound surfaces. `release.deploy` is implemented end-to-end
  // today; if a future command-manifest refactor re-tags it, the catalog
  // takes over the disabled tooltip without touching this surface.
  const releaseDeployStatus = toAffordanceStatus('release.deploy');
  const deployAffordance = (env: DeployTarget['environment']) =>
    affordanceFor('release.deploy.button', {
      commandStatus: releaseDeployStatus,
      hasTransport: !!transport,
      hasSessionId: !!sessionId,
      gateReady: canDeploy(env),
    });

  const deploy = async (target: DeployTarget) => {
    if (!transport || !sessionId || !canDeploy(target.environment)) return;
    try {
      await transport.send(sessionId, 'release.deploy', { target_id: target.id });
    } catch {
      /* surfaced via notify */
    }
  };

  const publish = async (target: DeployTarget) => {
    if (!transport || !sessionId || !canPublish()) return;
    try {
      await transport.send(sessionId, 'release.publish', { target_id: target.id });
    } catch {
      /* ignore */
    }
  };

  const generateNotes = async (target: DeployTarget) => {
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'release.generate_notes', { target_id: target.id });
    } catch {
      /* ignore */
    }
  };

  const targetList = useMemo(() => Array.from(targets.values()), [targets]);

  return (
    <div role="region" aria-label="Release plane" className="screen-shell">
      <header className="screen-hero">
        <div className="screen-hero-row">
          <div>
            <h3 className="screen-title">Release plane</h3>
            <div className="screen-subtitle">Coordinate deploy targets, release notes, and post-release monitoring.</div>
          </div>
          <span className="badge">{targets.size} targets</span>
        </div>
      </header>
      {targetList.length === 0 ? (
        <div className="soft-empty">No deploy targets configured.</div>
      ) : (
        <ul className="soft-list panel-card">
          {targetList.map((t) => {
            const publishOk = canPublish();
            const missing = gatesFor(t.environment).filter(
              (id) => gates.get(id)?.state !== 'pass',
            );
            const deployDecision = deployAffordance(t.environment);
            return (
              <li
                key={t.id}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  padding: 8,
                  marginBottom: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ flex: 1 }}>
                    {t.label} <span style={{ fontSize: 11, color: 'var(--text-2)' }}>({t.environment})</span>
                  </strong>
                  <button
                    onClick={() => deploy(t)}
                    disabled={!deployDecision.enabled}
                    data-affordance-id={deployDecision.affordanceId}
                    title={deployDecision.disabledReason ?? ''}
                  >
                    Deploy
                  </button>
                  <button onClick={() => publish(t)} disabled={!publishOk || !transport}>
                    Publish
                  </button>
                  <button onClick={() => generateNotes(t)} disabled={!transport}>
                    Release notes
                  </button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                  last: {t.last_status} {t.last_commit ? `@ ${t.last_commit.slice(0, 8)}` : ''}{' '}
                  {t.last_deployed_at ?? ''}
                </div>
                {missing.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--sev-warn)', marginTop: 4 }}>
                    Blocked by: {missing.join(', ')}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <section className="panel-card panel-card-pad" style={{ marginTop: 12 }}>
        <h4 className="panel-title">Recent deploys</h4>
        {deployOrder.length === 0 ? (
          <div className="panel-subtitle">No deploys yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {deployOrder
              .slice(-8)
              .reverse()
              .map((id) => {
                const d = deploys.get(id);
                if (!d) return null;
                return (
                  <li key={id} style={{ fontSize: 12, padding: '2px 0' }}>
                    <code>{d.commit.slice(0, 8)}</code> → {d.target_id} · {d.status}
                    {d.finished_at && ` · ${d.finished_at}`}
                  </li>
                );
              })}
          </ul>
        )}
      </section>
      {notes.size > 0 && (
        <section className="panel-card panel-card-pad" style={{ marginTop: 12 }}>
          <h4 className="panel-title">Release notes drafts</h4>
          {Array.from(notes.values()).map((d) => (
            <details key={d.id} style={{ marginBottom: 4 }}>
              <summary>
                {d.target_id} · {d.commit_range}
              </summary>
              <pre
                style={{
                  background: 'var(--bg-2, #111)',
                  padding: 8,
                  borderRadius: 4,
                  whiteSpace: 'pre-wrap',
                  fontSize: 12,
                }}
              >
                {d.markdown}
              </pre>
            </details>
          ))}
        </section>
      )}
      {observations.length > 0 && (
        <section className="panel-card panel-card-pad" style={{ marginTop: 12 }}>
          <h4 className="panel-title">Post-release monitor</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {observations.slice(-12).map((o) => (
              <li
                key={o.id}
                style={{
                  fontSize: 12,
                  padding: '2px 0',
                  color:
                    o.severity === 'error'
                      ? 'var(--sev-error)'
                      : o.severity === 'warn'
                        ? 'var(--sev-warn)'
                        : 'var(--text-2)',
                }}
              >
                [{o.connector}] {o.message} — {o.observed_at}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
