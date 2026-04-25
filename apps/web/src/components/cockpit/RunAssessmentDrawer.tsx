// Cockpit Run Assessment drawer — Stage G.
// Right-anchored slide-in that picks family + depth, then dispatches
// `assessment.run` to the bridge. Replaces the inline "Run RTD/Run PM"
// buttons in ReadinessHub for a more deliberate flow.
//
// Wires to:
//  - useConnectors → real connector list (read-only on/off shown for context)
//  - transport.send(sessionId, 'assessment.run', { swarm }) — same command the
//    ReadinessHub buttons use today; the drawer becomes an alternate entry.

import { useEffect, useMemo, useState } from 'react';
import { ASSESSOR_FAMILIES, type AssessorFamily } from '../../stores/assessment';
import { useConnectors, type ConnectorHealth } from '../../stores/connectors';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { Icon } from './primitives';

type Depth = 'quick' | 'standard' | 'full';

interface Props {
  transport: TransportHandle | null;
  onClose: () => void;
}

const FAMILY_OPTIONS: Array<{ id: AssessorFamily | 'all'; label: string; sub: string }> = [
  {
    id: 'rtd',
    label: 'Ready to Deploy',
    sub: 'Deployment prerequisites, infra, rollback, observability',
  },
  { id: 'pm', label: 'Product Review', sub: 'Flow logic, market fit, acceptance' },
  { id: 'ux', label: 'UX Review', sub: 'User flow, CTA clarity, states, onboarding' },
  { id: 'security', label: 'Security Review', sub: 'Auth/authz, secrets, deps, misconfig' },
  {
    id: 'all',
    label: 'All families',
    sub: 'Full sweep across all 12 assessors (longer)',
  },
];

const DEPTH_PRESETS: Array<{ id: Depth; label: string; eta: string }> = [
  { id: 'quick', label: 'Quick', eta: '~1m' },
  { id: 'standard', label: 'Standard', eta: '~5m' },
  { id: 'full', label: 'Full', eta: '~15m' },
];

const HEALTH_BADGE: Record<ConnectorHealth, string> = {
  connected: 'ok',
  degraded: 'warn',
  disconnected: 'crit',
  unknown: '',
};

export function RunAssessmentDrawer({ transport, onClose }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  // Subscribe to the Map identity (stable across snapshots that don't mutate
  // it), then derive the array via useMemo. Returning `Array.from(...)`
  // directly from the selector creates a fresh array every render → trips
  // Zustand's strict-mode equality check and (per audit) ships React error
  // #185 on the run-sweep drawer.
  const connectorMap = useConnectors((s) => s.items);
  const connectors = useMemo(() => Array.from(connectorMap.values()), [connectorMap]);
  const [family, setFamily] = useState<AssessorFamily | 'all'>('rtd');
  const [depth, setDepth] = useState<Depth>('standard');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async () => {
    if (!transport || !sessionId || running) return;
    setRunning(true);
    try {
      const targets: AssessorFamily[] =
        family === 'all' ? ASSESSOR_FAMILIES : [family as AssessorFamily];
      // Dispatch sequentially so the bridge can stagger; mock-engine handles
      // each independently and the UI activeRunId follows the most recent.
      for (const swarm of targets) {
        await transport.send(sessionId, 'assessment.run', { swarm, depth });
      }
      onClose();
    } catch {
      /* notify lane handles errors */
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(2px)',
          zIndex: 95,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Run assessment"
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          width: 'min(420px, 90vw)',
          background: 'var(--panel)',
          borderLeft: '1px solid var(--line)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: 'var(--pad)',
            borderBottom: '1px solid var(--line)',
            gap: 8,
          }}
        >
          <Icon name="play" size={14} style={{ color: 'var(--accent-2)' }} />
          <strong>Run assessment</strong>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close"
            className="icon-btn"
            style={{
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--ink-3)',
              fontSize: 16,
              width: 28,
              height: 28,
            }}
          >
            ×
          </button>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--pad)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--gap)',
          }}
        >
          <Section label="What should VAC look at?" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {FAMILY_OPTIONS.map((o) => (
              <label
                key={o.id}
                className="card"
                style={{
                  padding: 12,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  cursor: 'pointer',
                  background: family === o.id ? 'var(--accent-soft-2)' : 'var(--panel)',
                  borderColor: family === o.id ? 'var(--accent)' : 'var(--line)',
                }}
              >
                <input
                  type="radio"
                  name="family"
                  checked={family === o.id}
                  onChange={() => setFamily(o.id)}
                  style={{ marginTop: 3, accentColor: 'var(--accent)' }}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>{o.label}</div>
                  <div
                    style={{
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 1.45,
                      color: 'var(--ink-3)',
                    }}
                  >
                    {o.sub}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <Section label="Depth" />
          <div style={{ display: 'flex', gap: 6 }}>
            {DEPTH_PRESETS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDepth(d.id)}
                className={`btn ${depth === d.id ? 'primary' : ''}`}
                style={{ flex: 1 }}
              >
                <span style={{ fontWeight: 500 }}>{d.label}</span>
                <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>{d.eta}</span>
              </button>
            ))}
          </div>

          {connectors.length > 0 && (
            <>
              <Section label="Connectors" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {connectors.slice(0, 6).map((c) => (
                  <div
                    key={c.id}
                    className="card"
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 13, flex: 1 }}>{c.label}</span>
                    {HEALTH_BADGE[c.health] && (
                      <span className={`badge ${HEALTH_BADGE[c.health]}`}>{c.health}</span>
                    )}
                    <span className="badge" style={{ fontSize: 10, padding: '1px 5px' }}>
                      read-only
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <footer
          style={{
            display: 'flex',
            gap: 8,
            padding: 'var(--pad)',
            borderTop: '1px solid var(--line)',
          }}
        >
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn primary"
            onClick={run}
            disabled={!transport || !sessionId || running}
            style={{ opacity: !transport || !sessionId || running ? 0.5 : 1 }}
          >
            <Icon name="play" size={11} />
            {running ? 'Dispatching…' : 'Run assessment'}
          </button>
        </footer>
      </aside>
    </>
  );
}

function Section({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--ink-3)',
      }}
    >
      {label}
    </div>
  );
}
