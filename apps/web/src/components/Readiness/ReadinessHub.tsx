// Readiness Hub: verdict header + 5 scorecards + virtualized findings list.

import { useEffect, useMemo, useState } from 'react';
import { AssessmentDiff } from './AssessmentDiff';
import { AssessmentReportDetail } from './AssessmentReportDetail';
import { FindingsList } from './FindingsList';
import {
  ASSESSOR_FAMILIES,
  useAssessment,
  type AssessorFamily,
  type Category,
  type Finding,
  type QueryFailure,
  type Severity,
  type Verdict,
} from '../../stores/assessment';
import { useAssessmentReport } from '../../stores/assessmentReport';
import { useSession } from '../../stores/session';
import type { AvailableAgent, TransportHandle } from '../../transport';
import {
  describeAssessmentAgent,
  pickAssessmentAgentId,
} from '../../domain/assessment/agentSelection';
import {
  reasonLabel,
  requestAssessmentFetchReport,
  requestAssessmentListRuns,
  requestAssessmentReplay,
  requestAssessmentRun,
  requestAssessmentSweepCancel,
} from '../../domain/assessment/queries';
import { AssessmentProvenanceChip } from './AssessmentProvenanceChip';

const CATEGORIES: Category[] = ['technical', 'product', 'ux', 'release', 'ops'];

const hubErrorStackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 8,
};
const hubErrorRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '6px 10px',
  border: '1px solid var(--sev-error)',
  borderRadius: 6,
  fontSize: 12,
};
const hubErrorTitleStyle: React.CSSProperties = { color: 'var(--sev-error)' };
const hubErrorMessageStyle: React.CSSProperties = { flex: 1 };

const VERDICT_COLOR: Record<Verdict, string> = {
  pass: 'var(--sev-ok)',
  warn: 'var(--sev-warn)',
  fail: 'var(--sev-error)',
  unknown: 'var(--text-2)',
};

const SEV_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

interface Props {
  transport: TransportHandle | null;
}

/**
 * Public entry point. Splits report-mode out of the hub body so the same
 * component instance never has to render a different number of hooks across
 * renders — addressing the Rules-of-Hooks violation flagged in the Stage J
 * audit. The wrapper itself reads only the two slice fields it needs to
 * decide which child to mount; ReadinessHubMain owns every other hook.
 */
export function ReadinessHub({ transport }: Props) {
  const reportRunId = useAssessmentReport((s) => s.reportRunId);
  const exitReport = useAssessmentReport((s) => s.exitReport);

  if (reportRunId) {
    return (
      <AssessmentReportDetail
        runId={reportRunId}
        transport={transport}
        onBack={exitReport}
      />
    );
  }
  return <ReadinessHubMain transport={transport} />;
}


function verdictBadgeClass(v: string | undefined) {
  if (v === 'pass') return 'ok';
  if (v === 'warn') return 'warn';
  if (v === 'fail') return 'crit';
  return '';
}

function ReadinessHubMain({ transport }: Props) {
  const runs = useAssessment((s) => s.runs);
  const runOrder = useAssessment((s) => s.runOrder);
  const activeRunId = useAssessment((s) => s.activeRunId);
  const findings = useAssessment((s) => s.findings);
  const sessionId = useSession((s) => s.sessionId);
  const advertisedAgents: AvailableAgent[] = useMemo(
    () => transport?.availableAgents?.() ?? [],
    [transport],
  );
  const defaultAssessmentAgentId = useMemo(
    () => pickAssessmentAgentId(advertisedAgents),
    [advertisedAgents],
  );

  const [minSev, setMinSev] = useState<Severity>('info');
  const [categoryFilter, setCategoryFilter] = useState<Category | 'all'>('all');
  const [diffMode, setDiffMode] = useState(false);

  const active = activeRunId ? runs.get(activeRunId) : null;

  // Prior completed run of the same swarm = baseline for the diff view.
  const priorRunId = useMemo(() => {
    if (!active) return null;
    for (let i = runOrder.indexOf(active.id) - 1; i >= 0; i--) {
      const id = runOrder[i];
      if (!id) continue;
      const r = runs.get(id);
      if (r && r.swarm === active.swarm && r.status === 'completed') return id;
    }
    return null;
  }, [active, runOrder, runs]);

  const [familyToRun, setFamilyToRun] = useState<AssessorFamily>('rtd');

  useEffect(() => {
    if (!transport || !sessionId) return;
    void requestAssessmentListRuns(transport, sessionId, { limit: 50 }).catch(() => { });
  }, [transport, sessionId]);

  const queryErrors = useAssessment((s) => s.queryErrors);
  const clearQueryFailure = useAssessment((s) => s.clearQueryFailure);
  const headerErrors = useMemo<QueryFailure[]>(() => {
    const out: QueryFailure[] = [];
    for (const action of ['list_runs', 'run', 'sweep.run', 'sweep.cancel'] as const) {
      for (const [key, failure] of queryErrors.entries()) {
        if (key === action || key.startsWith(`${action}:`)) out.push(failure);
      }
    }
    return out;
  }, [queryErrors]);

  const retryHeaderError = (failure: QueryFailure) => {
    if (!transport || !sessionId) return;
    clearQueryFailure(failure.action, failure.targetId);
    if (failure.action === 'list_runs') {
      void requestAssessmentListRuns(transport, sessionId, { limit: 50 }).catch(() => { });
    } else if (failure.action === 'run') {
      void requestAssessmentRun(transport, sessionId, {
        swarm: familyToRun,
        ...(defaultAssessmentAgentId ? { agent_id: defaultAssessmentAgentId } : {}),
        agent_role: 'assessment-worker',
      }).catch(() => { });
    } else if (failure.action === 'sweep.cancel' && failure.targetId) {
      void requestAssessmentSweepCancel(transport, sessionId, failure.targetId).catch(() => { });
    }
  };

  const run = async (swarm: AssessorFamily) => {
    if (!transport || !sessionId) return;
    try {
      await requestAssessmentRun(transport, sessionId, {
        swarm,
        ...(defaultAssessmentAgentId ? { agent_id: defaultAssessmentAgentId } : {}),
        agent_role: 'assessment-worker',
      });
    } catch {
      /* ignore */
    }
  };

  const compareRun = (runId: string) => {
    const run = runs.get(runId);
    if (!run) return;
    const idx = runOrder.indexOf(run.id);
    let priorRunId: string | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      const id = runOrder[i];
      if (!id) continue;
      const candidate = runs.get(id);
      if (candidate && candidate.swarm === run.swarm && candidate.status === 'completed') {
        priorRunId = id;
        break;
      }
    }
    if (!priorRunId) return;
    useAssessment.getState().setActive(run.id);
    setDiffMode(true);
  };

  const cancel = async () => {
    if (!transport || !sessionId || !active) return;
    try {
      await transport.send(sessionId, 'assessment.cancel', { run_id: active.id });
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    const list: Finding[] = [];
    for (const f of findings.values()) {
      if (active && f.run_id !== active.id) continue;
      if (SEV_ORDER[f.severity] < SEV_ORDER[minSev]) continue;
      if (categoryFilter !== 'all' && f.category !== categoryFilter) continue;
      list.push(f);
    }
    list.sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]);
    return list;
  }, [findings, active, minSev, categoryFilter]);

  return (
    <div className="readiness-shell">
      <header className="readiness-hero">
        <div className="readiness-hero-top">
          <div className="readiness-title-block">
            <h2>Readiness Hub</h2>
            <div className="subtitle">
              Run assessment workflows, inspect evidence-backed findings, and recover reports from the assessment index.
            </div>
          </div>
          <div className="readiness-actions">
            <select
              className="readiness-action-select"
              data-testid="assessment-family-select"
              value={familyToRun}
              onChange={(e) => setFamilyToRun(e.target.value as AssessorFamily)}
              aria-label="Assessor family"
            >
              {ASSESSOR_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button
              className="btn primary"
              data-testid="run-assessment-button"
              onClick={() => run(familyToRun)}
              disabled={!transport || active?.status === 'running'}
            >
              Run {familyToRun}
            </button>
            {active?.status === 'running' && (
              <button className="btn ghost" data-testid="assessment-cancel-button" onClick={cancel}>
                Cancel active run
              </button>
            )}
          </div>
        </div>
        <div className="readiness-hero-meta">
          {active ? (
            <>
              <span className={`badge ${active.verdict ? verdictBadgeClass(active.verdict) : ''}`}>
                {active.verdict ? `Verdict: ${active.verdict}` : `Status: ${active.status}`}
              </span>
              <AssessmentProvenanceChip
                {...(active as typeof active & {
                  query_source?: 'index' | 'event_log';
                  fallback_reason?: 'index_missing' | 'index_incomplete' | 'index_error' | null;
                })}
                testId="assessment-provenance-chip"
              />
            </>
          ) : (
            <span className="badge">No active run</span>
          )}
          {defaultAssessmentAgentId && (
            <span
              className="badge"
              title={describeAssessmentAgent(
                advertisedAgents.find((agent) => agent.id === defaultAssessmentAgentId) ??
                advertisedAgents[0] ??
                {
                  id: defaultAssessmentAgentId,
                  label: defaultAssessmentAgentId,
                  kind: 'unknown',
                  default: false,
                },
              )}
            >
              Default worker: {defaultAssessmentAgentId}
            </span>
          )}
        </div>
      </header>
      {headerErrors.length > 0 && (
        <div role="alert" data-testid="assessment-query-error-banner" style={hubErrorStackStyle}>
          {headerErrors.map((failure) => (
            <div
              key={`${failure.action}:${failure.targetId ?? ''}:${failure.ts}`}
              style={hubErrorRowStyle}
            >
              <strong style={hubErrorTitleStyle}>
                {reasonLabel(failure.reason)}
              </strong>
              <span className="muted" style={hubErrorMessageStyle}>
                {failure.action}: {failure.message}
              </span>
              {(failure.action === 'list_runs' ||
                failure.action === 'run' ||
                failure.action === 'sweep.cancel') && (
                  <button
                    className="btn xs"
                    data-testid="assessment-query-error-retry"
                    onClick={() => retryHeaderError(failure)}
                    disabled={!transport || !sessionId}
                  >
                    Retry
                  </button>
                )}
              <button
                className="btn xs ghost"
                onClick={() => clearQueryFailure(failure.action, failure.targetId)}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
      {runOrder.length === 0 ? (
        <div className="readiness-empty">
          <strong>No assessment runs yet.</strong>
          <div>Pick a family for a single-family run, or use the drawer to launch a multi-family Gemini ACP sweep.</div>
        </div>
      ) : (
        <>
          <div className="readiness-control-strip">
            <select
              className="readiness-active-select"
              data-testid="assessment-active-run-select"
              aria-label="Active run"
              value={activeRunId ?? ''}
              onChange={(e) => useAssessment.getState().setActive(e.target.value || null)}
            >
            {runOrder.map((id) => {
              const r = runs.get(id);
              return (
                <option key={id} value={id}>
                  {r?.swarm.toUpperCase()} · {r?.status} · {id.slice(0, 12)}
                </option>
              );
            })}
            </select>
            <span className="muted">Active report context</span>
          </div>
          {active && <VerdictHeader run={active} />}
          {active && <Scorecards score={active.score} />}
          <ProgressBar run={active ?? null} />
          {priorRunId && active && (
            <div style={{ marginBottom: 6 }}>
              <button onClick={() => setDiffMode((v) => !v)} aria-pressed={diffMode}>
                {diffMode ? 'Hide diff' : `Compare vs prior ${active.swarm} run`}
              </button>
            </div>
          )}
          {diffMode && priorRunId && active ? (
            <AssessmentDiff prevRunId={priorRunId} nextRunId={active.id} transport={transport} />
          ) : null}
          {!diffMode && (
            <>
              <Filters
                minSev={minSev}
                setMinSev={setMinSev}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
                count={filtered.length}
              />
              <FindingsList findings={filtered} transport={transport} />
            </>
          )}
        </>
      )}
      <RecentAssessmentsTimeline transport={transport} onCompareRun={compareRun} />
    </div>
  );
}

function RecentAssessmentsTimeline({
  transport,
  onCompareRun,
}: {
  transport: TransportHandle | null;
  onCompareRun(runId: string): void;
}) {
  const runs = useAssessment((s) => s.runs);
  const runOrder = useAssessment((s) => s.runOrder);
  const sweeps = useAssessment((s) => s.sweeps);
  const sweepOrder = useAssessment((s) => s.sweepOrder);
  const findings = useAssessment((s) => s.findings);
  const activeSweepId = useAssessment((s) => s.activeSweepId);
  const sessionId = useSession((s) => s.sessionId);
  const enterReport = useAssessmentReport((s) => s.enterReport);

  const rows = runOrder
    .slice()
    .reverse()
    .map((id) => runs.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .slice(0, 6);
  const sweepRows = sweepOrder
    .slice()
    .reverse()
    .map((id) => sweeps.get(id))
    .filter((sweep): sweep is NonNullable<typeof sweep> => !!sweep)
    .slice(0, 6);
  if (rows.length === 0 && sweepRows.length === 0) return null;

  const countByRun = new Map<string, { crit: number; high: number; total: number }>();
  for (const f of findings.values()) {
    const cur = countByRun.get(f.run_id) ?? { crit: 0, high: 0, total: 0 };
    cur.total++;
    if (f.severity === 'critical') cur.crit++;
    else if (f.severity === 'high') cur.high++;
    countByRun.set(f.run_id, cur);
  }

  const openRunReport = async (runId: string) => {
    if (transport && sessionId) {
      try {
        await requestAssessmentFetchReport(transport, sessionId, runId);
      } catch {
        // hydrate best-effort via existing store if backend is unavailable
      }
    }
    enterReport(runId);
  };

  const replayRun = async (runId: string) => {
    if (!transport || !sessionId) return;
    try {
      await requestAssessmentReplay(transport, sessionId, runId);
    } catch {
      // no-op
    }
    enterReport(runId);
  };

  const cancelSweep = async (sweepId: string) => {
    if (!transport || !sessionId) return;
    try {
      await requestAssessmentSweepCancel(transport, sessionId, sweepId);
    } catch {
      // no-op
    }
  };

  const primaryRunIdForSweep = (sweepId: string): string | null => {
    const sweep = sweeps.get(sweepId);
    if (!sweep) return null;
    for (const runId of [...sweep.run_ids].reverse()) {
      if (runs.has(runId)) return runId;
    }
    return sweep.run_ids.at(-1) ?? null;
  };

  return (
    <section style={{ marginTop: 18 }}>
      {sweepRows.length > 0 && (
        <>
          <header
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14 }}>Recent multi-family sweeps</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              last {sweepRows.length}
            </span>
          </header>
          <div className="timeline-card" style={{ marginBottom: 14 }}>
            {sweepRows.map((sweep) => {
              const sweepRunId = primaryRunIdForSweep(sweep.id);
              const primaryRun = sweepRunId ? runs.get(sweepRunId) : null;
              const counts = primaryRun ? countByRun.get(primaryRun.id) ?? { crit: 0, high: 0, total: 0 } : { crit: 0, high: 0, total: 0 };
              const sevDot =
                counts.crit > 0 ? 'crit' : counts.high > 0 ? 'high' : counts.total > 0 ? 'med' : 'low';
              const familiesLabel = sweep.families.length > 0 ? sweep.families.join(' · ') : 'multi-family sweep';
              const sweepPolicyLabel = `${sweep.effective_mode ?? sweep.mode ?? 'sequential'} · ${sweep.failure_policy ?? 'continue'}`;
              const isActive = activeSweepId === sweep.id;
              return (
                <div
                  key={sweep.id}
                  data-testid="assessment-sweep-row"
                  data-sweep-id={sweep.id}
                  className="timeline-row"
                  style={{
                    borderLeft: isActive ? '3px solid var(--accent)' : undefined,
                    paddingLeft: isActive ? 9 : undefined,
                  }}
                >
                  <span className={`sev-dot ${sevDot}`}></span>
                  <span className="when">
                    {sweep.started_at} · <span className="actor">{familiesLabel}</span>
                  </span>
                  <span className="assessment-row-main">
                    <span className="assessment-row-title">Multi-family sweep · {sweep.id.slice(0, 12)}</span>
                    <span className="assessment-row-meta">
                      {sweep.status} · {sweepPolicyLabel}
                      {typeof sweep.running_count === 'number' || typeof sweep.pending_count === 'number'
                        ? ` · ${sweep.running_count ?? 0} running · ${sweep.pending_count ?? 0} pending · ${sweep.completed_count ?? sweep.progress.completed} done`
                        : ''}
                      {sweep.counts && typeof sweep.counts === 'object'
                        ? ` · ${Object.values(sweep.counts).reduce((acc, value) => acc + (typeof value === 'number' ? value : 0), 0)} signals`
                        : ''}
                    </span>
                    {primaryRun && <span className="badge">Primary run: {primaryRun.swarm}</span>}
                  </span>
                  {sweep.verdict && <span className={`badge ${verdictBadgeClass(sweep.verdict)}`}>{sweep.verdict}</span>}
                  {isActive && <span className="badge accent">active</span>}
                  <div className="assessment-row-actions">
                    <button
                      className="btn sm ghost"
                      onClick={() => sweepRunId && void openRunReport(sweepRunId)}
                      disabled={!sweepRunId}
                      aria-label={`Open report for sweep ${sweep.id}`}
                    >
                      Open report
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => sweepRunId && void replayRun(sweepRunId)}
                      disabled={!sweepRunId}
                      aria-label={`Replay sweep ${sweep.id}`}
                    >
                      Replay
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => sweepRunId && onCompareRun(sweepRunId)}
                      disabled={!sweepRunId}
                      aria-label={`Compare sweep ${sweep.id}`}
                    >
                      Compare
                    </button>
                    {sweep.status === 'running' && (
                      <button
                        className="btn sm ghost"
                        data-testid="assessment-sweep-cancel-button"
                        onClick={() => void cancelSweep(sweep.id)}
                        aria-label={`Cancel sweep ${sweep.id}`}
                      >
                        Cancel sweep
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {rows.length > 0 && (
        <>
          <header
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14 }}>Recent single-family runs</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              last {rows.length}
            </span>
          </header>
          <div className="timeline-card">
            {rows.map((r) => {
              const counts = countByRun.get(r.id) ?? { crit: 0, high: 0, total: 0 };
              const sevDot =
                counts.crit > 0 ? 'crit' : counts.high > 0 ? 'high' : counts.total > 0 ? 'med' : 'low';
              return (
                <div key={r.id} data-testid="assessment-run-row" data-run-id={r.id} className="timeline-row">
                  <span className={`sev-dot ${sevDot}`}></span>
                  <span className="when">
                    {r.started_at} · <span className="actor">single-family run · {r.swarm.toUpperCase()}</span>
                  </span>
                  <span className="assessment-row-main">
                    <span className="assessment-row-title">{r.swarm.toUpperCase()} · {r.status}</span>
                    <span className="assessment-row-meta">
                      {counts.total} finding{counts.total === 1 ? '' : 's'}
                      {counts.crit > 0 && ` · ${counts.crit} critical`}
                      {counts.high > 0 && ` · ${counts.high} high`}
                    </span>
                    {r.agent_id && <span className="badge">Worker: {r.agent_id}</span>}
                  </span>
                  {r.verdict && <span className={`badge ${verdictBadgeClass(r.verdict)}`}>{r.verdict}</span>}
                  <div className="assessment-row-actions">
                    <button
                      className="btn sm ghost"
                      onClick={() => void openRunReport(r.id)}
                      aria-label={`View report for run ${r.id}`}
                    >
                      View report
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => void replayRun(r.id)}
                      aria-label={`Replay run ${r.id}`}
                    >
                      Replay
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => onCompareRun(r.id)}
                      aria-label={`Compare run ${r.id}`}
                    >
                      Compare
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function VerdictHeader({ run }: { run: { verdict?: Verdict; status: string; swarm: string } }) {
  const v = run.verdict ?? 'unknown';
  const extendedRun = run as typeof run & {
    agent_id?: string;
    agent_kind?: string;
    worker_session_id?: string;
    verdict_detail?: { status: string; delivery_state?: string; reason?: string };
    failure?: { status: string; reason: string; detail?: string };
    query_source?: 'index' | 'event_log';
    fallback_reason?: 'index_missing' | 'index_incomplete' | 'index_error' | null;
  };
  return (
    <div className={`readiness-verdict-card ${verdictBadgeClass(v)}`}>
      <div className="readiness-verdict-main">
        <strong style={{ color: VERDICT_COLOR[v] }}>{run.swarm} · {v}</strong>
        <span className="badge">{run.status}</span>
        {extendedRun.verdict_detail?.delivery_state && (
          <span className="badge accent">{extendedRun.verdict_detail.delivery_state}</span>
        )}
        {extendedRun.failure?.reason && (
          <span className={`badge ${extendedRun.failure.status === 'cancelled' ? 'warn' : 'crit'}`}>
            {extendedRun.failure.reason}
          </span>
        )}
      </div>
      <div className="readiness-debug-chips">
        <AssessmentProvenanceChip {...extendedRun} testId="assessment-provenance-chip" />
        {extendedRun.agent_id && <span className="badge debug-only">Worker: {extendedRun.agent_id}</span>}
        {extendedRun.agent_kind && <span className="badge debug-only">{extendedRun.agent_kind}</span>}
        {extendedRun.worker_session_id && (
          <span className="badge debug-only" title={extendedRun.worker_session_id}>
            session {extendedRun.worker_session_id.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}

function Scorecards({ score }: { score: Record<Category, number> | undefined }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${CATEGORIES.length}, 1fr)`,
        gap: 6,
        marginBottom: 8,
      }}
    >
      {CATEGORIES.map((c) => {
        const v = score?.[c] ?? 0;
        return (
          <div
            key={c}
            style={{
              padding: 8,
              border: '1px solid var(--line)',
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-2)' }}>
              {c}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(v * 100)}</div>
          </div>
        );
      })}
    </div>
  );
}

function ProgressBar({ run }: { run: { progress: { completed: number; total: number; current?: string }; status: string } | null }) {
  if (!run) return null;
  const pct = run.progress.total === 0 ? 0 : (run.progress.completed / run.progress.total) * 100;
  const detail = run.progress.current ?? (run.progress as { phase?: string }).phase ?? (run.progress as { reason?: string }).reason;
  const passLabel =
    typeof (run.progress as { pass?: number }).pass === 'number' &&
      typeof (run.progress as { max_passes?: number }).max_passes === 'number'
      ? ` · pass ${(run.progress as { pass?: number }).pass}/${(run.progress as { max_passes?: number }).max_passes}`
      : '';
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          height: 4,
          background: 'var(--bg-2, #222)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--accent, #5af)',
            transition: 'width 120ms linear',
          }}
        />
      </div>
      {detail && (
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>
          {run.progress.completed}/{run.progress.total} · {detail}
          {passLabel}
        </div>
      )}
    </div>
  );
}

function Filters({
  minSev,
  setMinSev,
  categoryFilter,
  setCategoryFilter,
  count,
}: {
  minSev: Severity;
  setMinSev: (s: Severity) => void;
  categoryFilter: Category | 'all';
  setCategoryFilter: (c: Category | 'all') => void;
  count: number;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 12 }}>
      <label>
        sev ≥{' '}
        <select value={minSev} onChange={(e) => setMinSev(e.target.value as Severity)}>
          <option value="info">info</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </select>
      </label>
      <label>
        cat{' '}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as Category | 'all')}
        >
          <option value="all">all</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <span style={{ color: 'var(--text-2)' }}>{count} findings</span>
    </div>
  );
}
