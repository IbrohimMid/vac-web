// Migration tab. Trust-model-strict UI per `docs/capability-profiles.md §4.2`:
// dry-run button always visible; dispatch only exposes when canDispatch is
// true; reversibility result is surfaced prominently.

import { useState } from 'react';
import { canDispatchMigration, useMigration } from '../../stores/migration';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

interface Props {
  transport: TransportHandle | null;
}

export function MigrationTab({ transport }: Props) {
  const packets = useMigration((s) => s.packets);
  const order = useMigration((s) => s.order);
  const active_id = useMigration((s) => s.active_id);
  const sessionId = useSession((s) => s.sessionId);
  const [creating, setCreating] = useState(false);

  const active = active_id ? packets.get(active_id) : null;

  const createDraft = async () => {
    if (!transport || !sessionId) return;
    setCreating(true);
    try {
      await transport.send(sessionId, 'migration.create_draft', {
        title: 'New migration',
      });
    } catch {
      /* ignore */
    } finally {
      setCreating(false);
    }
  };

  // TODO(phase-8.5 integration): wire dry-run / verify / dispatch buttons
  // once the bridge `migration.*` commands land alongside `executor.migration`.
  // Surface below already shows phase/log/reversibility coming from store events.

  return (
    <div role="region" aria-label="Migrations" style={{ padding: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <h3 style={{ margin: 0 }}>Migrations</h3>
        <span style={{ flex: 1 }} />
        <button onClick={createDraft} disabled={!transport || creating}>
          New draft
        </button>
      </header>
      {order.length === 0 ? (
        <div style={{ color: 'var(--text-2)', padding: 16 }}>
          No migration packets yet. Click "New draft" to start.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 8, marginTop: 8 }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {order.map((id) => {
              const p = packets.get(id);
              if (!p) return null;
              return (
                <li
                  key={id}
                  onClick={() => useMigration.getState().setActive(id)}
                  style={{
                    padding: 6,
                    cursor: 'pointer',
                    background: id === active_id ? 'var(--bg-2, #222)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 13 }}>{p.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{p.phase}</div>
                </li>
              );
            })}
          </ul>
          {active ? <PacketDetail transport={transport} /> : null}
        </div>
      )}
    </div>
  );
}

function PacketDetail({ transport: _transport }: { transport: TransportHandle | null }) {
  const active_id = useMigration((s) => s.active_id);
  const packet = useMigration((s) => (active_id ? s.packets.get(active_id) : undefined));
  if (!packet) return null;
  const canRun = canDispatchMigration(packet, new Date());

  return (
    <section>
      <h4 style={{ margin: '0 0 6px 0' }}>{packet.title}</h4>
      <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
        phase: <strong>{packet.phase}</strong> · window:{' '}
        {packet.maintenance_start} → {packet.maintenance_end}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary>Forward SQL</summary>
        <pre style={preStyle}>{packet.forward_sql || '(empty)'}</pre>
      </details>
      <details>
        <summary>Rollback SQL</summary>
        <pre style={preStyle}>{packet.rollback_sql || '(empty)'}</pre>
      </details>
      <section style={{ marginTop: 8 }}>
        <strong>Signers ({packet.signers.length}/2 required)</strong>
        <ul style={{ fontSize: 12, margin: '4px 0', paddingLeft: 16 }}>
          {packet.signers.map((s) => (
            <li key={s.name}>
              {s.role}: {s.name}
            </li>
          ))}
        </ul>
      </section>
      <section style={{ marginTop: 8, fontSize: 12 }}>
        <div>
          reversibility:{' '}
          <strong
            style={{
              color:
                packet.reversibility_ok === true
                  ? 'var(--sev-ok)'
                  : packet.reversibility_ok === false
                    ? 'var(--sev-error)'
                    : 'var(--text-2)',
            }}
          >
            {packet.reversibility_ok === undefined
              ? 'not verified'
              : packet.reversibility_ok
                ? 'verified'
                : 'FAILED'}
          </strong>
        </div>
      </section>
      <section style={{ marginTop: 8 }}>
        <strong>Dry-run log</strong>
        <pre
          style={{
            ...preStyle,
            maxHeight: 200,
          }}
        >
          {packet.dry_run_log.join('\n') || '(no dry-run yet)'}
        </pre>
      </section>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)' }}>
        dispatchable:{' '}
        <strong style={{ color: canRun ? 'var(--sev-ok)' : 'var(--sev-warn)' }}>
          {canRun ? 'yes' : 'no'}
        </strong>
      </div>
    </section>
  );
}

const preStyle: React.CSSProperties = {
  background: 'var(--bg-2, #111)',
  padding: 6,
  borderRadius: 4,
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  overflow: 'auto',
};
