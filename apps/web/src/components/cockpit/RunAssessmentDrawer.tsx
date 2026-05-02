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
import { ASSESSOR_FAMILIES, type AssessorFamily, type SweepFailurePolicy, type SweepMode } from '../../stores/assessment';
import { useConnectors, type ConnectorHealth } from '../../stores/connectors';
import { useSession } from '../../stores/session';
import type { AvailableAgent, TransportHandle } from '../../transport';
import { describeAssessmentAgent, pickAssessmentAgentId } from '../../domain/assessment/agentSelection';
import {
  requestAssessmentSweepRun,
  type AssessmentDepth,
} from '../../domain/assessment/queries';
import { Icon } from './primitives';

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
    label: 'All families sweep',
    sub: 'Multi-family sweep across all 12 assessors (longer)',
  },
];

const DEPTH_PRESETS: Array<{ id: AssessmentDepth; label: string; eta: string }> = [
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
  const advertisedAgents: AvailableAgent[] = useMemo(
    () => transport?.availableAgents?.() ?? [],
    [transport],
  );
  const defaultAgentId = useMemo(
    () => pickAssessmentAgentId(advertisedAgents),
    [advertisedAgents],
  );
  const [family, setFamily] = useState<AssessorFamily | 'all'>('rtd');
  const [depth, setDepth] = useState<AssessmentDepth>('standard');
  const [agentId, setAgentId] = useState<string>(defaultAgentId);
  const [sweepMode, setSweepMode] = useState<SweepMode>('sequential');
  const [concurrency, setConcurrency] = useState(2);
  const [failurePolicy, setFailurePolicy] = useState<SweepFailurePolicy>('continue');
  const [running, setRunning] = useState(false);
  const selectedAgent = advertisedAgents.find((agent) => agent.id === agentId);

  useEffect(() => {
    setAgentId((current) =>
      advertisedAgents.some((agent) => agent.id === current) ? current : defaultAgentId,
    );
  }, [advertisedAgents, defaultAgentId]);

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
      if (family === 'all') {
        await requestAssessmentSweepRun(transport, sessionId, {
          families: ASSESSOR_FAMILIES,
          depth,
          mode: sweepMode,
          concurrency,
          failure_policy: failurePolicy,
          ...(agentId ? { agent_id: agentId } : {}),
          agent_role: 'assessment-sweep',
        });
      } else {
        await transport.send(sessionId, 'assessment.run', {
          swarm: family as AssessorFamily,
          depth,
          ...(agentId ? { agent_id: agentId } : {}),
          agent_role: 'assessment-worker',
        });
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
        data-testid="run-assessment-drawer"
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
          <strong>Run assessment workflow</strong>
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
          <div className="assessment-drawer-basic">
            <div className="assessment-drawer-section-title">Basic setup</div>
            <Section label="Assessment agent" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <select
              data-testid="assessment-agent-select"
              aria-label="Assessment agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              style={{
                minHeight: 32,
                padding: '0 10px',
                border: '1px solid var(--line)',
                borderRadius: 6,
                background: 'var(--panel)',
              }}
            >
              {advertisedAgents.length === 0 ? (
                <option value="">
                  Bridge default agent
                </option>
              ) : (
                advertisedAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.label}
                    {agent.default ? ' (default)' : ''}
                    {agent.installed === false ? ' • not installed' : ''}
                  </option>
                ))
              )}
            </select>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--ink-3)' }}>
              {selectedAgent
                ? describeAssessmentAgent(selectedAgent)
                : 'Bridge default agent will be used when no advertised agent is selected.'}
            </div>
            </div>

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
                  data-testid={`assessment-family-${o.id}`}
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
                data-testid={`assessment-depth-${d.id}`}
                onClick={() => setDepth(d.id)}
                className={`btn ${depth === d.id ? 'primary' : ''}`}
                style={{ flex: 1 }}
              >
                <span style={{ fontWeight: 500 }}>{d.label}</span>
                <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>{d.eta}</span>
              </button>
            ))}
            </div>
          </div>

          {family === 'all' && (
            <details className="assessment-drawer-advanced" open>
              <summary>Sweep policy</summary>
              <div className="assessment-policy-grid">
                <label className="assessment-policy-row">
                  <span>Mode</span>
                  <select
                    data-testid="assessment-sweep-mode-select"
                    aria-label="Sweep mode"
                    value={sweepMode}
                    onChange={(e) => setSweepMode(e.target.value as SweepMode)}
                  >
                    <option value="sequential">Sequential</option>
                    <option value="parallel">Parallel request</option>
                  </select>
                </label>
                <label className="assessment-policy-row">
                  <span>Concurrency</span>
                  <select
                    data-testid="assessment-sweep-concurrency-select"
                    aria-label="Sweep concurrency"
                    value={concurrency}
                    onChange={(e) => setConcurrency(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
                  >
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="assessment-policy-row">
                  <span>Failure policy</span>
                  <select
                    data-testid="assessment-sweep-failure-policy-select"
                    aria-label="Sweep failure policy"
                    value={failurePolicy}
                    onChange={(e) => setFailurePolicy(e.target.value as SweepFailurePolicy)}
                  >
                    <option value="continue">Continue</option>
                    <option value="stop_on_fail">Stop on fail</option>
                  </select>
                </label>
                <div className="assessment-safety-note">
                  Parallel is recorded as operator intent. Effective runtime stays sequential for deterministic audit ordering.
                </div>
              </div>
            </details>
          )}

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
            data-testid="assessment-run-submit"
            onClick={run}
            disabled={!transport || !sessionId || running}
            style={{ opacity: !transport || !sessionId || running ? 0.5 : 1 }}
          >
            <Icon name="play" size={11} />
            {running ? 'Dispatching…' : family === 'all' ? 'Run multi-family sweep' : 'Run single-family assessment'}
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
