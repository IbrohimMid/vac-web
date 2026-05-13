// Cockpit Build surface — Stage C.
// Layout: .build-grid splits transcript-pane (left) + workbench (right);
// shell drawer attaches at the bottom when open. The workbench tabs read
// from real stores; the visual chrome is the prototype's cockpit CSS.
//
// Each tab is a thin wrapper around the existing functional component (which
// owns store reads + transport sends). Static-data tabs (Agents / VIL / VWFD /
// Memory) ship presentational placeholders pending upstream stores in a
// later phase — they're flagged inline.

import { lazy, Suspense, useState, type KeyboardEvent } from 'react';
import { Composer } from '../Composer/Composer';
import { AgentThread } from '../AgentThread/AgentThread';
import { useShell } from '../../stores/shell';
import { useApprovals } from '../../stores/approvals';
import { useAssessment } from '../../stores/assessment';
import { useReview } from '../../stores/review';
import { useToolActivity } from '../../stores/toolActivity';
import { useRuntime } from '../../stores/runtime';
import { useHandoff } from '../../stores/handoff';
import { useGates } from '../../stores/gates';
import { useTranscript } from '../../stores/transcript';
import { useSession } from '../../stores/session';
import { useWorkflow } from '../../stores/workflow';
import type { TransportHandle } from '../../transport';
import { Icon } from './primitives';

const ApprovalsTab = lazy(() =>
  import('../Approvals/ApprovalsTab').then((m) => ({ default: m.ApprovalsTab })),
);
const ToolActivityLane = lazy(() =>
  import('../toolActivity/ToolActivityLane').then((m) => ({ default: m.ToolActivityLane })),
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
const WorkflowRail = lazy(() =>
  import('../Workflow/WorkflowRail').then((m) => ({ default: m.WorkflowRail })),
);

type WBTabId = 'approvals' | 'review' | 'activity' | 'agents' | 'runtime' | 'plan' | 'workflow' | 'vil' | 'vwfd' | 'memory';

interface WBTab {
  id: WBTabId;
  label: string;
}

const WB_TABS: WBTab[] = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'review', label: 'Review' },
  { id: 'activity', label: 'Activity' },
  { id: 'agents', label: 'Agents' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'plan', label: 'Plan' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'vil', label: 'VIL' },
  { id: 'vwfd', label: 'VWFD' },
  { id: 'memory', label: 'Memory' },
];

function workbenchTabId(tab: WBTabId): string {
  return `workbench-tab-${tab}`;
}

function workbenchPanelId(tab: WBTabId): string {
  return `workbench-panel-${tab}`;
}

function nextWorkbenchTab(current: WBTabId, key: string): WBTabId | null {
  const idx = WB_TABS.findIndex((tab) => tab.id === current);
  if (key === 'ArrowRight' || key === 'ArrowDown') return WB_TABS[(idx + 1) % WB_TABS.length]!.id;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return WB_TABS[(idx - 1 + WB_TABS.length) % WB_TABS.length]!.id;
  if (key === 'Home') return WB_TABS[0]!.id;
  if (key === 'End') return WB_TABS[WB_TABS.length - 1]!.id;
  return null;
}

interface Props {
  transport: TransportHandle;
}

export function BuildSurface({ transport }: Props) {
  const [tab, setTab] = useState<WBTabId>('approvals');
  const [wbCollapsed, setWbCollapsed] = useState(false);
  const shellOpen = useShell((s) => s.open);
  const setShellOpen = useShell((s) => s.setOpen);

  return (
    <div
      className={`build-grid ${shellOpen ? 'shell-open' : ''} ${wbCollapsed ? 'wb-collapsed' : ''}`}
      style={
        {
          ['--transcript-fr' as string]: wbCollapsed ? '1fr' : '1.2fr',
          ['--workbench-fr' as string]: wbCollapsed ? 'auto' : '0.8fr',
        } as React.CSSProperties
      }
    >
      <TranscriptPane transport={transport} setTab={setTab} />
      <Workbench
        tab={tab}
        setTab={setTab}
        shellOpen={shellOpen}
        setShellOpen={setShellOpen}
        transport={transport}
        collapsed={wbCollapsed}
        setCollapsed={setWbCollapsed}
      />
    </div>
  );
}

function TranscriptPane({
  transport,
  setTab,
}: {
  transport: TransportHandle;
  setTab: (t: WBTabId) => void;
}) {
  const sessionId = useSession((s) => s.sessionId);
  const messageCount = useTranscript((s) => s.order.length);
  // X.5f.3 Patch B: AgentThread tool/diff/terminal/turn actions
  // need to switch the workbench tab to Review or Runtime, and to
  // send message.cancel_stream / message.submit. Plumb the same
  // transport + setTab BuildSurface already owns so the buttons
  // perform real navigation/state changes (no cosmetic shells).
  return (
    <div className="transcript-pane">
      <div className="transcript-hd">
        <Icon name="dot" size={10} style={ { color: 'var(--ok)' } } />
        <span className="session-title">
          {sessionId ? `Session ${sessionId.slice(0, 12)}` : 'No active session'}
        </span>
        <span className="muted" style={ { marginLeft: 'auto', fontSize: 12 } }>
          {messageCount} {messageCount === 1 ? 'turn' : 'turns'}
        </span>
        <button className="icon-btn" title="Session info" aria-label="Session info">
          <Icon name="more" size={14} />
        </button>
      </div>
      <div className="transcript-scroll">
        <div className="transcript-inner">
          <AgentThread
            sessionId={sessionId}
            transport={transport}
            onOpenTab={(t) => setTab(t as WBTabId)}
          />
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
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

function Workbench({ tab, setTab, shellOpen, setShellOpen, transport, collapsed, setCollapsed }: WorkbenchProps) {
  const pendingApprovals = useApprovals((s) => s.pendingOrder.length);
  const reviewFiles = useReview((s) => s.files.length);
  const runningJobs = useRuntime((s) => {
    let n = 0;
    for (const j of s.jobs.values())
      if (j.status === 'running' || j.status === 'pending') n++;
    return n;
  });
  const packets = useHandoff((s) => s.order.length);
  const toolActivityCount = useToolActivity((s) => s.activityOrder.length);
  const sessionId = useSession((s) => s.sessionId);
  const workflowRunning = useWorkflow((s) => {
    if (!sessionId) return 0;
    const run = s.runs.get(sessionId);
    return run && run.status === 'running' ? 1 : 0;
  });

  const countFor = (id: WBTabId): number | null => {
    if (id === 'approvals') return pendingApprovals || null;
    if (id === 'review') return reviewFiles || null;
    if (id === 'runtime') return runningJobs || null;
    if (id === 'plan') return packets || null;
    if (id === 'activity') return toolActivityCount || null;
    if (id === 'workflow') return workflowRunning || null;
    return null;
  };

  const activateTab = (id: WBTabId) => {
    if (collapsed) setCollapsed(false);
    setTab(id);
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: WBTabId) => {
    const next = nextWorkbenchTab(id, event.key);
    if (!next) return;
    event.preventDefault();
    activateTab(next);
    requestAnimationFrame(() => document.getElementById(workbenchTabId(next))?.focus());
  };

  return (
    <div className={`workbench ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="tabs" role="tablist" aria-label="Workbench sections">
        {WB_TABS.map((t) => {
          const c = countFor(t.id);
          const isActive = tab === t.id && !collapsed;
          return (
            <button
              key={t.id}
              id={workbenchTabId(t.id)}
              type="button"
              className={`tab ${isActive ? 'active' : ''}`}
              onClick={() => activateTab(t.id)}
              onKeyDown={(event) => onTabKeyDown(event, t.id)}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-controls={workbenchPanelId(t.id)}
            >
              {t.label}
              {c != null && <span className="count">{c}</span>}
            </button>
          );
        })}
        <div className="spacer"></div>
        <button
          className="icon-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand workbench' : 'Collapse workbench'}
          aria-label={collapsed ? 'Expand workbench' : 'Collapse workbench'}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? 'chevron-u' : 'chevron-d'} size={14} />
        </button>
        <button
          className={`icon-btn ${shellOpen ? 'bordered' : ''}`}
          onClick={() => setShellOpen(!shellOpen)}
          title="Shell drawer (⌘`)"
          aria-label="Toggle shell drawer"
        >
          <Icon name="terminal" size={14} />
        </button>
      </div>
      {!collapsed && (
      <div className="wb-body" id={workbenchPanelId(tab)} role="tabpanel" aria-labelledby={workbenchTabId(tab)}>
        <Suspense fallback={<TabFallback />}>
          {tab === 'approvals' && <ApprovalsTab transport={transport} />}
          {tab === 'review' && <ReviewTab transport={transport} />}
          {tab === 'activity' && <ToolActivityLane />}
          {tab === 'agents' && <AgentsView />}
          {tab === 'runtime' && <RuntimeTab transport={transport} />}
          {tab === 'plan' && <PlanView transport={transport} />}
          {tab === 'workflow' && (
            <Suspense fallback={<div className="build-loading">Loading…</div>}>
              <WorkflowRail onSelectArtifactTarget={(target) => setTab(target as WBTabId)} />
            </Suspense>
          )}
          {tab === 'vil' && <VilView />}
          {tab === 'vwfd' && <VwfdView />}
          {tab === 'memory' && <MemoryView />}
        </Suspense>
      </div>
      )}
    </div>
  );
}

function TabFallback() {
  return (
    <div className="build-loading">Loading…</div>
  );
}

// Plan tab → reuse the existing HandoffTab, which already shows packet
// list + builder + dispatch. Keeps a single source of truth for handoff state.
function PlanView({ transport }: { transport: TransportHandle }) {
  return (
    <div className="build-placeholder" style={{ minHeight: 0 }}>
      <HandoffTab transport={transport} />
    </div>
  );
}

// ---- Static-data tabs (presentational placeholders) ---------------------

function AgentsView() {
  // Tri-lane derived from real stores until upstream agent telemetry ships:
  //   Planner  ← active assessment run (running family + current check)
  //   Executor ← handoff packet currently dispatched / executing
  //   Reviewer ← pending approvals queue depth (human-in-loop check)
  const runs = useAssessment((s) => s.runs);
  const activeRunId = useAssessment((s) => s.activeRunId);
  const packets = useHandoff((s) => s.packets);
  const order = useHandoff((s) => s.order);
  const approvalsCount = useApprovals((s) => s.pendingOrder.length);

  const activeRun = activeRunId ? runs.get(activeRunId) : null;
  const planner = activeRun
    ? {
        state: activeRun.status === 'running' ? 'running' : 'idle',
        work: activeRun.progress.current
          ? `${activeRun.swarm} · ${activeRun.progress.current}`
          : `${activeRun.swarm} · ${activeRun.progress.completed}/${activeRun.progress.total}`,
      }
    : { state: 'idle', work: 'Awaiting input' };

  const executingPacket = order
    .map((id) => packets.get(id))
    .find((p) => p && (p.status === 'executing' || p.status === 'dispatched'));
  const executor = executingPacket
    ? { state: 'running', work: `${executingPacket.title} · ${executingPacket.status}` }
    : { state: 'idle', work: 'No packet dispatched' };

  const reviewer =
    approvalsCount > 0
      ? {
          state: 'running',
          work: `${approvalsCount} approval${approvalsCount === 1 ? '' : 's'} pending`,
        }
      : { state: 'idle', work: 'No approvals queued' };

  const lanes: Array<{ name: string; role: string; state: string; work: string }> = [
    { name: 'Planner', role: 'lane A · plan', ...planner },
    { name: 'Executor', role: 'lane B · write', ...executor },
    { name: 'Reviewer', role: 'lane C · review', ...reviewer },
  ];

  return (
    <div className="build-placeholder">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {lanes.map((a) => {
          const running = a.state === 'running';
          return (
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
                <span className={`badge ${running ? 'accent' : ''}`}>
                  <span
                    className="dot"
                    style={{ background: running ? 'var(--accent)' : 'var(--ink-4)' }}
                  ></span>
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
          );
        })}
      </div>
      <p className="muted" style={{ marginTop: 18, fontSize: 12 }}>
        Lanes derived from active assessment / packet / approval state.
        Per-agent token budgets land with upstream agent telemetry.
      </p>
    </div>
  );
}

function VilView() {
  // VIL semantic IR view — placeholder until upstream `vil-expr` integration.
  return (
    <div className="build-placeholder">
      <div className="card">
        <div className="card-hd">
          <Icon name="vil" size={14} style={{ color: 'var(--accent-2)' }} />
          <div className="card-title">vil-expr · semantic IR</div>
          <span className="badge">awaiting integration</span>
        </div>
        <div className="panel-card-pad">
          <p className="build-placeholder-copy" style={{ marginTop: 0 }}>
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
    <div className="build-placeholder">
      <div className="card">
        <div className="card-hd">
          <Icon name="vil" size={14} style={{ color: 'var(--accent-2)' }} />
          <div className="card-title">VWFD inspector</div>
          <span className="badge">awaiting integration</span>
        </div>
        <div className="panel-card-pad">
          <p className="build-placeholder-copy" style={{ marginTop: 0 }}>
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
    <div className="build-placeholder">
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
