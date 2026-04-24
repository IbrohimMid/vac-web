// Release plane: Deploy + Publish + Release Notes + Post-release Monitor.
// Gate-guarded: Deploy requires DevComplete + ReadyToDeploy (and ReadyForStaging
// if the target environment is staging). Publish requires ReadyToPublish.

import { useEffect, useMemo } from 'react';
import { useGates, type GateId } from '../../stores/gates';
import { useRelease, type DeployTarget } from '../../stores/release';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

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
    <div role="region" aria-label="Release plane" style={{ padding: 8 }}>
      <h3 style={{ margin: '4px 0' }}>Release plane</h3>
      {targetList.length === 0 ? (
        <div style={{ color: 'var(--text-2)' }}>No deploy targets configured.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {targetList.map((t) => {
            const deployOk = canDeploy(t.environment);
            const publishOk = canPublish();
            const missing = gatesFor(t.environment).filter(
              (id) => gates.get(id)?.state !== 'pass',
            );
            return (
              <li
                key={t.id}
                style={{
                  border: '1px solid var(--border-1, #2a2a2a)',
                  borderRadius: 6,
                  padding: 8,
                  marginBottom: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ flex: 1 }}>
                    {t.label} <span style={{ fontSize: 11, color: 'var(--text-2)' }}>({t.environment})</span>
                  </strong>
                  <button onClick={() => deploy(t)} disabled={!deployOk || !transport}>
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
      <section style={{ marginTop: 12 }}>
        <h4 style={{ margin: '4px 0' }}>Recent deploys</h4>
        {deployOrder.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 12 }}>No deploys yet.</div>
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
        <section style={{ marginTop: 12 }}>
          <h4 style={{ margin: '4px 0' }}>Release notes drafts</h4>
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
        <section style={{ marginTop: 12 }}>
          <h4 style={{ margin: '4px 0' }}>Post-release monitor</h4>
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
