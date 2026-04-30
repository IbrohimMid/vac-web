import { beforeEach, describe, expect, it } from 'vitest';
import {
  freshnessTier,
  queryFailureKey,
  useAssessment,
  type EvidenceRef,
  type QueryFailure,
  type Sweep,
} from './assessment';
import type { DiffResult } from './assessmentDiff';

function reset() {
  useAssessment.getState().clear();
}

const baseRun = {
  id: 'r1',
  swarm: 'rtd' as const,
  status: 'running' as const,
  started_at: 't',
  progress: { completed: 0, total: 5 },
};

const baseSweep: Sweep = {
  id: 's1',
  families: ['rtd', 'security'],
  status: 'running' as const,
  started_at: 't',
  progress: { completed: 0, total: 2 },
  run_ids: [] as string[],
};

const baseFinding = {
  id: 'f1',
  identity_hash: 'h1',
  run_id: 'r1',
  category: 'technical' as const,
  subject: 's',
  check: 'c',
  severity: 'high' as const,
  confidence: 0.9,
  title: 't',
  summary: 'sum',
  evidence_ids: [],
  emitted_at: 't',
};

describe('assessment store', () => {
  beforeEach(reset);

  it('upsertRun sets active on first insert', () => {
    useAssessment.getState().upsertRun(baseRun);
    expect(useAssessment.getState().activeRunId).toBe('r1');
  });

  it('completeRun records verdict + score', () => {
    useAssessment.getState().upsertRun(baseRun);
    useAssessment.getState().completeRun('r1', 'pass', {
      technical: 1,
      product: 1,
      ux: 1,
      release: 1,
      ops: 1,
    });
    const r = useAssessment.getState().runs.get('r1');
    expect(r?.status).toBe('completed');
    expect(r?.verdict).toBe('pass');
  });

  it('failRun records failed status and failure metadata', () => {
    useAssessment.getState().upsertRun(baseRun);
    useAssessment.getState().failRun('r1', 'cancelled', 'user requested cancel', 'stop now', {
      agent_id: 'agent-1',
      agent_kind: 'acp',
      agent_role: 'assessment-worker',
      worker_session_id: 'worker-1',
    });
    const r = useAssessment.getState().runs.get('r1');
    expect(r?.status).toBe('cancelled');
    expect(r?.failure?.status).toBe('cancelled');
    expect(r?.failure?.reason).toBe('user requested cancel');
    expect(r?.failure?.detail).toBe('stop now');
    expect(r?.agent_id).toBe('agent-1');
    expect(r?.worker_session_id).toBe('worker-1');
  });

  it('records candidate received/rejected counts and reasons', () => {
    useAssessment.getState().upsertRun(baseRun);
    useAssessment.getState().recordCandidateReceived('r1', 2);
    useAssessment.getState().recordCandidateRejected('r1', 'missing_evidence');
    useAssessment.getState().recordCandidateRejected('r1', 'missing_evidence');
    const r = useAssessment.getState().runs.get('r1');
    expect(r?.validation?.received).toBe(2);
    expect(r?.validation?.rejected).toBe(2);
    expect(r?.validation?.rejection_reasons.missing_evidence).toBe(2);
  });

  it('emitFinding dedups by identity_hash (replaces old id)', () => {
    useAssessment.getState().emitFinding(baseFinding);
    useAssessment.getState().emitFinding({ ...baseFinding, id: 'f2', title: 'newer' });
    const s = useAssessment.getState();
    expect(s.findings.size).toBe(1);
    expect(s.findings.get('f2')?.title).toBe('newer');
    expect(s.findingsByHash.get('h1')).toBe('f2');
  });

  it('links runs into sweeps and tracks sweep state', () => {
    useAssessment.getState().upsertSweep(baseSweep);
    useAssessment.getState().upsertRun({ ...baseRun, sweep_id: 's1' });
    useAssessment.getState().setSweepProgress('s1', {
      completed: 1,
      total: 2,
      current: 'rtd',
      phase: 'family_complete',
    });
    useAssessment.getState().completeSweep('s1', 'warn', {
      completed: 1,
      total: 2,
    });

    const sweep = useAssessment.getState().sweeps.get('s1');
    expect(useAssessment.getState().activeSweepId).toBe('s1');
    expect(sweep?.run_ids).toContain('r1');
    expect(sweep?.progress.completed).toBe(1);
    expect(sweep?.status).toBe('completed');
    expect(sweep?.verdict).toBe('warn');
  });

  it('stores diff snapshots under run pairs', () => {
    const diff: DiffResult = {
      entries: [],
      counts: {
        resolved: 1,
        persistent: 2,
        regressed: 3,
        new: 4,
      },
    };
    useAssessment.getState().upsertDiff('base', 'next', diff);
    expect(useAssessment.getState().diffs.get('base\x00next')?.counts.regressed).toBe(3);
    expect(useAssessment.getState().diffOrder).toEqual(['base\x00next']);
  });

  it('setEvidencePreview merges preview onto existing evidence', () => {
    useAssessment.getState().upsertEvidence({
      id: 'ev1',
      connector: 'github',
      kind: 'pr',
      label: 'pr 42',
      captured_at: 't',
      ttl_seconds: 60,
    });
    useAssessment.getState().setEvidencePreview('ev1', 'preview body');
    expect(useAssessment.getState().evidence.get('ev1')?.preview).toBe('preview body');
  });
});

describe('freshnessTier', () => {
  const now = Date.parse('2026-04-24T12:00:00Z');
  const mk = (agoSec: number, ttlSec: number): EvidenceRef => ({
    id: 'e',
    connector: 'x',
    kind: 'k',
    label: 'l',
    captured_at: new Date(now - agoSec * 1000).toISOString(),
    ttl_seconds: ttlSec,
  });

  it('fresh < 0.5 ttl', () => {
    expect(freshnessTier(mk(10, 100), now)).toBe('fresh');
  });
  it('aging < ttl', () => {
    expect(freshnessTier(mk(70, 100), now)).toBe('aging');
  });
  it('stale < 2*ttl', () => {
    expect(freshnessTier(mk(150, 100), now)).toBe('stale');
  });
  it('hard_expire >= 2*ttl', () => {
    expect(freshnessTier(mk(300, 100), now)).toBe('hard_expire');
  });
});

describe('queryErrors (P2)', () => {
  beforeEach(() => reset());

  const failure = (overrides: Partial<QueryFailure> = {}): QueryFailure => ({
    action: 'fetch_report',
    reason: 'not_found',
    message: 'Run not found',
    ts: 't',
    targetId: 'r1',
    ...overrides,
  });

  it('queryFailureKey composes action and targetId', () => {
    expect(queryFailureKey('fetch_report', 'r1')).toBe('fetch_report:r1');
    expect(queryFailureKey('list_runs')).toBe('list_runs');
  });

  it('recordQueryFailure stores the failure under the keyed entry', () => {
    useAssessment.getState().recordQueryFailure(failure());
    const stored = useAssessment.getState().queryErrors.get('fetch_report:r1');
    expect(stored?.reason).toBe('not_found');
    expect(stored?.message).toBe('Run not found');
  });

  it('clearQueryFailure removes only the matching entry', () => {
    const s = useAssessment.getState();
    s.recordQueryFailure(failure({ action: 'fetch_report', targetId: 'r1' }));
    s.recordQueryFailure(failure({ action: 'list_runs', targetId: undefined }));
    s.clearQueryFailure('fetch_report', 'r1');
    const after = useAssessment.getState().queryErrors;
    expect(after.has('fetch_report:r1')).toBe(false);
    expect(after.has('list_runs')).toBe(true);
  });

  it('clearAllQueryErrors empties the map', () => {
    const s = useAssessment.getState();
    s.recordQueryFailure(failure());
    s.recordQueryFailure(failure({ action: 'list_runs', targetId: undefined }));
    s.clearAllQueryErrors();
    expect(useAssessment.getState().queryErrors.size).toBe(0);
  });

  it('upsertDiff auto-clears the matching diff failure key', () => {
    const s = useAssessment.getState();
    s.recordQueryFailure(
      failure({ action: 'diff', targetId: 'a\x00b', reason: 'event_log_truncated' }),
    );
    expect(useAssessment.getState().queryErrors.has('diff:a\x00b')).toBe(true);
    const empty: DiffResult = {
      counts: { resolved: 0, persistent: 0, regressed: 0, new: 0 },
      entries: [],
    };
    s.upsertDiff('a', 'b', empty);
    expect(useAssessment.getState().queryErrors.has('diff:a\x00b')).toBe(false);
  });

  it('clear() resets queryErrors', () => {
    const s = useAssessment.getState();
    s.recordQueryFailure(failure());
    s.clear();
    expect(useAssessment.getState().queryErrors.size).toBe(0);
  });
});
