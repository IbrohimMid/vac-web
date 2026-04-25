// Cockpit Build surface — Stage C.
// Layout: .build-grid splits transcript-pane (left) + workbench (right);
// shell drawer attaches at the bottom when open. The workbench tabs read
// from real stores; the visual chrome is the prototype's cockpit CSS.
//
// Each tab is a thin wrapper around the existing functional component (which
// owns store reads + transport sends). Static-data tabs (Agents / VIL / VWFD /
// Memory) ship presentational placeholders pending upstream stores in a
// later phase — they're flagged inline.

import { lazy, Suspense, useState } from 'react';
import { Composer } from '../Composer/Composer';
import { Transcript } from '../Transcript/Transcript';
import { useShell } from '../../stores/shell';
import { useApprovals } from '../../stores/approvals';
import { useReview } from '../../stores/review';
import { useRuntime } from '../../stores/runtime';
import { useHandoff } from '../../stores/handoff';
import { useGates } from '../../stores/gates';
import { useTranscript } from '../../stores/transcript';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { Icon } from './primitives';

const ApprovalsTab = lazy(() =>
  import('../Approvals/ApprovalsTab').then((m) => ({ default: m.ApprovalsTab })),
);
const ReviewTab = lazy(() =>
  import('../Review/ReviewTab').then((m) => ({ default: m.ReviewTab })),
);
const RuntimeTab = lazy(() =>
  import('../Runtime/RuntimeTab').then((m) => ({ default: m.RuntimeTab })),
);
const HandoffTab = lazy(() =>
  import('../Handoff/HandoffTab').then((m) => ({ default: m.HandoffTab })),
);

type WBTabId = 'approvals' | 'review' | 'agents' | 'runtime' | 'plan' | 'vil' | 'vwfd' | 'memory';

interface WBTab {
  id: WBTabId;
  label: string;
}

const WB_TABS: WBTab[] = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'review', label: 'Review' },
  { id: 'agents', label: 'Agents' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'plan', label: 'Plan' },
  { id: 'vil', label: 'VIL' },
  { id: 'vwfd', label: 'VWFD' },
  { id: 'memory', label: 'Memory' },
];

interface Props {
  transport: TransportHandle;
}

export function BuildSurface({ transport }: Props) {
  const [tab, setTab] = useState<WBTabId>('approvals');
  const shellOpen = useShell((s) => s.open);
  const setShellOpen = useShell((s) => s.setOpen);

  return (
    <div
      className={`build-grid ${shellOpen ? 'shell-open' : ''}`}
      style={
        {
          ['--transcript-fr' as string]: '1.2fr',
          ['--workbench-fr' as string]: '0.8fr',
        } as React.CSSProperties
      }
    >
      <TranscriptPane transport={transport} />
      <Workbench
        tab={tab}
        setTab={setTab}
        shellOpen={shellOpen}
        setShellOpen={setShellOpen}
        transport={transport}
      />
    </div>
  );
}

function TranscriptPane({ transport }: { transport: TransportHandle }) {
  const sessionId = useSession((s) => s.sessionId);
  const messageCount = useTranscript((s) => s.order.length);
  return (
    <div className="transcript-pane">
      <div className="transcript-hd">
        <Icon name="dot" size={10} style={{ color: 'var(--ok)' }} />
        <span className="session-title">
          {sessionId ? `Session ${sessionId.slice(0, 12)}` : 'No active session'}
        </span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {messageCount} {messageCount === 1 ? 'turn' : 'turns'}
        </span>
        <button className="icon-btn" title="Session info" aria-label="Session info">
          <Icon name="more" size={14} />
        </button>
      </div>
      <div className="transcript-scroll">
        <div className="transcript-inner">
          <Transcript />
        </div>
      </div>
      <Composer transport={transport} />
    </div>
  );
}

interface WorkbenchProps {
  tab: WBTabId;
  setTab: (t: WBTabId) => void;
  shellOpen: boolean;
  setShellOpen: (o: boolean) => void;
  transport: TransportHandle;
}

function Workbench({ tab, setTab, shellOpen, setShellOpen, transport }: WorkbenchProps) {
  const pendingApprovals = useApprovals((s) => s.order.length);
  const reviewFiles = useReview((s) => s.files.length);
  const runningJobs = useRuntime((s) => {
    let n = 0;
    for (const j of s.jobs.values())
      if (j.status === 'running' || j.status === 'pending') n++;
    return n;
  });
  const packets = useHandoff((s) => s.order.length);

  const countFor = (id: WBTabId): number | null => {
    if (id === 'approvals') return pendingApprovals || null;
    if (id === 'review') return reviewFiles || null;
    if (id === 'runtime') return runningJobs || null;
    if (id === 'plan') return packets || null;
    return null;
  };

  return (
    <div className="workbench">
      <div className="tabs">
        {WB_TABS.map((t) => {
          const c = countFor(t.id);
          return (
            <div
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={tab === t.id}
            >
              {t.label}
              {c != null && <span className="count">{c}</span>}
            </div>
          );
        })}
        <div className="spacer"></div>
        <button
          className={`icon-btn ${shellOpen ? 'bordered' : ''}`}
          onClick={() => setShellOpen(!shellOpen)}
          title="Shell drawer (⌘`)"
          aria-label="Toggle shell drawer"
        >
          <Icon name="terminal" size={14} />
        </button>
      </div>
      <div className="wb-body">
        <Suspense fallback={<TabFallback />}>
          {tab === 'approvals' && <ApprovalsTab transport={transport} />}
          {tab === 'review' && <ReviewTab transport={transport} />}
          {tab === 'agents' && <AgentsView />}
          {tab === 'runtime' && <RuntimeTab transport={transport} />}
          {tab === 'plan' && <PlanView transport={transport} />}
          {tab === 'vil' && <VilView />}
          {tab === 'vwfd' && <VwfdView />}
          {tab === 'memory' && <MemoryView />}
        </Suspense>
      </div>
    </div>
  );
}

function TabFallback() {
  return (
    <div style={{ padding: 18, color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
  );
}

// Plan tab → reuse the existing HandoffTab, which already shows packet
// list + builder + dispatch. Keeps a single source of truth for handoff state.
function PlanView({ transport }: { transport: TransportHandle }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      <HandoffTab transport={transport} />
    </div>
  );
}

// ---- Static-data tabs (presentational placeholders) ---------------------

function AgentsView() {
  // Pending an `agents` store — Phase 8 mock-engine doesn't surface per-agent
  // state distinctly. For now this mirrors the prototype's tri-lane layout
  // with "idle" placeholder cards so the surface isn't a blank pane.
  const lanes = [
    { name: 'Planner', role: 'tri-lane', state: 'idle', work: 'Awaiting input' },
    { name: 'Executor', role: 'tri-lane', state: 'idle', work: 'Awaiting input' },
    { name: 'Reviewer', role: 'tri-lane', state: 'idle', work: 'Awaiting input' },
  ];
  return (
    <div style={{ flex: 1, padding: 18, overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {lanes.map((a) => (
          <div key={a.name} className="card">
            <div className="card-hd">
              <div className="msg-avatar agent" style={{ borderRadius: 6 }}>
                <Icon name="bot" size={13} />
              </div>
              <div>
                <div className="card-title">{a.name}</div>
                <div className="card-sub">{a.role}</div>
              </div>
              <div className="spacer"></div>
              <span className="badge">
                <span className="dot" style={{ background: 'var(--ink-4)' }}></span>
                {a.state}
              </span>
            </div>
            <div className="card-body" style={{ fontSize: 12.5 }}>
              <div className="kv-row">
                <span className="k">Working on</span>
                <span className="v" style={{ fontFamily: 'var(--font-sans)' }}>
                  {a.work}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 18, fontSize: 12 }}>
        Per-agent state lands when upstream PR #11 ships agent telemetry.
      </p>
    </div>
  );
}

function VilView() {
  // VIL semantic IR view — placeholder until upstream `vil-expr` integration.
  return (
    <div style={{ flex: 1, padding: 18, overflowY: 'auto', fontSize: 13 }}>
      <div className="card">
        <div className="card-hd">
          <Icon name="vil" size={14} style={{ color: 'var(--accent-2)' }} />
          <div className="card-title">vil-expr · semantic IR</div>
          <span className="badge">awaiting integration</span>
        </div>
        <div style={{ padding: 14 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            VIL inspector will render the semantic IR for the current schema +
            invariants once <code>vil-expr</code> ships in upstream
            vac-web/vastar-agentic-cli (tracked separately).
          </p>
        </div>
      </div>
    </div>
  );
}

function VwfdView() {
  // VWFD inspector — placeholder until VWFD store/protocol lands.
  return (
    <div style={{ flex: 1, padding: 18, overflowY: 'auto' }}>
      <div className="card">
        <div className="card-hd">
          <Icon name="vil" size={14} style={{ color: 'var(--accent-2)' }} />
          <div className="card-title">VWFD inspector</div>
          <span className="badge">awaiting integration</span>
        </div>
        <div style={{ padding: 14 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            VWFD (View of What's Flowing Downstream) reassess chains land with
            Phase 8 continuous-readiness data feeds.
          </p>
        </div>
      </div>
    </div>
  );
}

function MemoryView() {
  // Memory view — derived from useGates + handoff signers as a stand-in for a
  // dedicated facts store. Listing 6 most recent gate transitions + signers.
  const gates = useGates((s) => s.gates);
  const handoff = useHandoff((s) => s.packets);
  const facts: { kind: 'pinned' | 'auto'; text: string }[] = [];
  for (const g of gates.values()) {
    facts.push({
      kind: 'auto',
      text: `Gate ${g.id} → ${g.state}${g.overridden ? ' (override)' : ''}`,
    });
  }
  for (const p of handoff.values()) {
    if (p.signers.length === 0) continue;
    facts.push({
      kind: 'pinned',
      text: `Packet ${p.id.slice(0, 12)}: ${p.signers.map((s) => s.name).join(', ')}`,
    });
  }
  return (
    <div style={{ flex: 1, padding: 18, overflowY: 'auto' }}>
      <div className="muted" style={{ marginBottom: 10, fontSize: 12.5 }}>
        {facts.length} facts derived from current session state
      </div>
      {facts.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          No memory yet — run an assessment or build a packet first.
        </p>
      ) : (
        facts.slice(0, 20).map((m, i) => (
          <div
            key={i}
            className="card"
            style={{ padding: '10px 14px', marginBottom: 8, display: 'flex', gap: 10 }}
          >
            <Icon name="tag" size={14} style={{ color: 'var(--accent-2)' }} />
            <div className="flex1" style={{ fontSize: 13 }}>
              {m.text}
            </div>
            <span className={`badge ${m.kind === 'pinned' ? 'accent' : ''}`}>{m.kind}</span>
          </div>
        ))
      )}
    </div>
  );
}
