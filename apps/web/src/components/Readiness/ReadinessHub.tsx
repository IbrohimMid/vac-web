// Readiness Hub: verdict header + 5 scorecards + virtualized findings list.

import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AssessmentDiff } from './AssessmentDiff';
import { FindingCard } from './FindingCard';
import {
  ASSESSOR_FAMILIES,
  useAssessment,
  type AssessorFamily,
  type Category,
  type Finding,
  type Severity,
  type Verdict,
} from '../../stores/assessment';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

const CATEGORIES: Category[] = ['technical', 'product', 'ux', 'release', 'ops'];

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

export function ReadinessHub({ transport }: Props) {
  const runs = useAssessment((s) => s.runs);
  const runOrder = useAssessment((s) => s.runOrder);
  const activeRunId = useAssessment((s) => s.activeRunId);
  const findings = useAssessment((s) => s.findings);
  const sessionId = useSession((s) => s.sessionId);

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

  const run = async (swarm: AssessorFamily) => {
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'assessment.run', { swarm });
    } catch {
      /* ignore */
    }
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
    <div style={{ padding: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Readiness</h2>
        <span style={{ flex: 1 }} />
        <select
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
        <button onClick={() => run(familyToRun)} disabled={!transport || active?.status === 'running'}>
          Run {familyToRun}
        </button>
        {active?.status === 'running' && <button onClick={cancel}>Cancel</button>}
      </header>
      {runOrder.length === 0 ? (
        <div style={{ color: 'var(--text-2)', padding: 16 }}>
          No runs yet — pick a family and click Run.
        </div>
      ) : (
        <>
          <select
            aria-label="Active run"
            value={activeRunId ?? ''}
            onChange={(e) => useAssessment.getState().setActive(e.target.value || null)}
            style={{ marginBottom: 8 }}
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
            <AssessmentDiff prevRunId={priorRunId} nextRunId={active.id} />
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
    </div>
  );
}

function VerdictHeader({ run }: { run: { verdict?: Verdict; status: string; swarm: string } }) {
  const v = run.verdict ?? 'unknown';
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 6,
        border: `1px solid ${VERDICT_COLOR[v]}`,
        marginBottom: 8,
      }}
    >
      <strong style={{ color: VERDICT_COLOR[v], textTransform: 'uppercase' }}>
        {run.swarm} · {v}
      </strong>
      <span style={{ marginLeft: 8, color: 'var(--text-2)', fontSize: 12 }}>{run.status}</span>
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
              border: '1px solid var(--border-1, #2a2a2a)',
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
      {run.progress.current && (
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>
          {run.progress.completed}/{run.progress.total} · {run.progress.current}
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

function FindingsList({
  findings,
  transport,
}: {
  findings: Finding[];
  transport: TransportHandle | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: findings.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 120,
    overscan: 8,
  });
  if (findings.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-2)' }}>
        No findings (yet) at current filters.
      </div>
    );
  }
  return (
    <div ref={ref} style={{ maxHeight: 520, overflow: 'auto' }}>
      <div
        role="list"
        aria-label="Findings"
        style={{ height: v.getTotalSize(), position: 'relative' }}
      >
        {v.getVirtualItems().map((item) => {
          const f = findings[item.index];
          if (!f) return null;
          return (
            <div
              key={item.key}
              role="listitem"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <FindingCard finding={f} transport={transport} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
