// Archive tab: read-only rollups of Plan / VIL / Signal / Memory per
// `phase-6 rollback plan §c`. Filter selector picks which lens to show; all
// data is derived from existing stores (no new bridge state).

import { useState } from 'react';
import { useActivity } from '../../stores/activity';
import { useAssessment } from '../../stores/assessment';
import { useGates } from '../../stores/gates';
import { useHandoff } from '../../stores/handoff';
import { useNotify } from '../../stores/notify';
import { useRelease } from '../../stores/release';
import { useSession } from '../../stores/session';

type Lens = 'plan' | 'vil' | 'signal' | 'memory';

export function ArchiveTab() {
  const [lens, setLens] = useState<Lens>('plan');
  return (
    <div style={{ padding: 8 }}>
      <nav style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['plan', 'vil', 'signal', 'memory'] as Lens[]).map((l) => (
          <button
            key={l}
            onClick={() => setLens(l)}
            aria-pressed={lens === l}
            style={{
              padding: '4px 10px',
              borderRadius: 12,
              border: '1px solid var(--border-1, #333)',
              background: lens === l ? 'var(--bg-2, #222)' : 'transparent',
              color: 'var(--text-1)',
              cursor: 'pointer',
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </nav>
      {lens === 'plan' && <PlanLens />}
      {lens === 'vil' && <VILLens />}
      {lens === 'signal' && <SignalLens />}
      {lens === 'memory' && <MemoryLens />}
    </div>
  );
}

function PlanLens() {
  const packets = useHandoff((s) => s.packets);
  const order = useHandoff((s) => s.order);
  if (order.length === 0) {
    return <div style={{ color: 'var(--text-2)' }}>No packets yet.</div>;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {order.map((id) => {
        const p = packets.get(id);
        if (!p) return null;
        return (
          <li key={id} style={{ padding: 4, fontSize: 13 }}>
            <strong>{p.title}</strong> · {p.status} · {p.tasks.length} tasks ·{' '}
            <code>{p.pin.worktree_digest.slice(0, 8)}</code>
          </li>
        );
      })}
    </ul>
  );
}

function VILLens() {
  const gates = useGates((s) => s.gates);
  const deploys = useRelease((s) => s.deploys);
  const deployOrder = useRelease((s) => s.deployOrder);
  const rows = [
    ...Array.from(gates.values()).map((g) => ({
      ts: g.last_changed_at,
      line: `gate ${g.id} → ${g.state}${g.overridden ? ' (override)' : ''}`,
    })),
    ...deployOrder
      .map((id) => deploys.get(id))
      .filter((d): d is NonNullable<typeof d> => d !== undefined)
      .map((d) => ({
        ts: d.started_at,
        line: `deploy ${d.target_id} ${d.status} @ ${d.commit.slice(0, 8)}`,
      })),
  ].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-2)' }}>Empty ledger.</div>;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'monospace', fontSize: 12 }}>
      {rows.map((r) => (
        // ts + line is stable under sort + unique per entry; safe as key.
        <li key={`${r.ts}|${r.line}`}>
          {r.ts} — {r.line}
        </li>
      ))}
    </ul>
  );
}

function SignalLens() {
  const sticky = useNotify((s) => s.sticky);
  const persistent = useNotify((s) => s.persistent);
  const observations = useRelease((s) => s.observations);
  // Namespace keys so notify + observation ids can't collide.
  const rows = [
    ...Array.from(sticky.values()).map((e) => ({
      key: `sticky:${e.id}`,
      severity: e.severity,
      subsystem: e.subsystem,
      title: e.title,
      message: e.message,
    })),
    ...persistent.map((e) => ({
      key: `pers:${e.id}`,
      severity: e.severity,
      subsystem: e.subsystem,
      title: e.title,
      message: e.message,
    })),
    ...observations.map((o) => ({
      key: `obs:${o.id}`,
      severity: o.severity,
      subsystem: o.connector,
      title: '(observation)',
      message: o.message,
    })),
  ];
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-2)' }}>Quiet.</div>;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {rows.slice(0, 40).map((r) => (
        <li key={r.key} style={{ fontSize: 12, padding: '2px 0' }}>
          <strong>[{r.severity}]</strong> {r.subsystem}: {r.title} — {r.message}
        </li>
      ))}
    </ul>
  );
}

function MemoryLens() {
  const session = useSession();
  const runs = useAssessment((s) => s.runOrder);
  const activity = useActivity((s) => s.entries);
  const exportBundle = () => {
    const bundle = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      session: {
        id: session.sessionId,
        profile: session.profileId,
        project: session.projectRoot,
      },
      assessment_runs: runs,
      activity_tail: activity.slice(-200),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vac-session-${Date.now()}.vacz.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <div style={{ fontSize: 13 }}>
      <div>
        <strong>Session:</strong> {session.sessionId ?? '(none)'}
      </div>
      <div>
        <strong>Profile:</strong> {session.profileId ?? '(none)'}
      </div>
      <div>
        <strong>Project root:</strong> {session.projectRoot ?? '(none)'}
      </div>
      <div>
        <strong>Assessment runs:</strong> {runs.length}
      </div>
      <div style={{ marginTop: 8 }}>
        <button onClick={exportBundle}>Export session bundle (.vacz.json)</button>
      </div>
    </div>
  );
}
