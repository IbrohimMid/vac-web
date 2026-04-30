import { beforeEach, describe, expect, it } from 'vitest';
import { registerAssessmentHandlers } from './handlers';
import { useAssessment } from '../../stores/assessment';
import type { EventFrame, TransportHandle } from '../../transport';

type Handler = (ev: EventFrame) => void;

function mockTransport() {
  const handlers = new Map<string, Handler[]>();
  const t: TransportHandle = {
    async send() {
      return { ackOf: 'x', ok: true };
    },
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        const remaining = handlers.get(type)?.filter((h) => h !== handler) ?? [];
        handlers.set(type, remaining);
      };
    },
    close() {},
  };
  const emit = (type: string, payload: unknown) => {
    const frame: EventFrame = {
      seq: 1,
      session_id: 's',
      type,
      payload,
      v: 1,
      ts: '2026-01-01T00:00:00Z',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('assessment handlers', () => {
  beforeEach(() => useAssessment.getState().clear());

  it('tracks candidate validation stats and validated findings', () => {
    const { t, emit } = mockTransport();
    const off = registerAssessmentHandlers(t);

    emit('assessment.started', {
      run_id: 'run_01',
      swarm: 'rtd',
      total_checks: 2,
      started_at: '2026-01-01T00:00:00Z',
      agent_id: 'agent_1',
      agent_kind: 'acp',
      agent_role: 'assessment-worker',
      worker_session_id: 'worker_1',
      scope: {
        project_root: '/workspace/project',
        repo_ref: 'branch:main',
        base_commit_sha: 'abc123def456',
        diff_range: 'HEAD~1..HEAD',
        path_globs: ['apps/web/src/**'],
        depth: 'standard',
      },
      connector_snapshots: [
        {
          connector_id: 'github_default',
          kind: 'github',
          snapshot_id: '01J0000000000000000000SN01',
          captured_at: '2026-01-01T00:00:00Z',
        },
      ],
    });

    emit('assessment.candidate_received', {
      run_id: 'run_01',
      candidate_count: 2,
      candidate_hash: 'sha256:feed',
      source_event_type: 'assessment.candidate_received',
      agent_id: 'agent_1',
    });

    emit('assessment.progress', {
      run_id: 'run_01',
      completed: 1,
      total: 2,
      current: 'candidate validation',
      phase: 'validation',
      pass: 2,
      max_passes: 3,
      reason: 'pass_started',
      elapsed_ms: 4200,
      agent_id: 'agent_1',
      agent_kind: 'acp',
      agent_role: 'assessment-worker',
      worker_session_id: 'worker_1',
    });

    emit('assessment.candidate_rejected', {
      run_id: 'run_01',
      candidate_hash: 'sha256:dead',
      reason: 'missing_evidence',
      summary: 'missing evidence',
      source_event_type: 'assessment.candidate_received',
      agent_id: 'agent_1',
    });

    emit('assessment.evidence_attached', {
      id: 'ev_01',
      connector: 'filesystem',
      kind: 'file',
      label: 'apps/web/src/stores/assessment.ts:1',
      captured_at: '2026-01-01T00:00:00Z',
      ttl_seconds: 3600,
      uri: 'file:///workspace/apps/web/src/stores/assessment.ts',
    });

    emit('assessment.finding_added', {
      finding_id: 'fnd_01',
      identity_hash: 'sha256:abcd',
      run_id: 'run_01',
      category: 'technical',
      subject: 'apps/web/src/stores/assessment.ts:1',
      check: 'Validate evidence',
      severity: 'high',
      confidence: 0.9,
      title: 'Validated finding',
      summary: 'Validated finding summary',
      evidence_ids: ['ev_01'],
      emitted_at: '2026-01-01T00:00:01Z',
      source_event_type: 'assessment.candidate_received',
      agent_id: 'agent_1',
    });

    emit('assessment.completed', {
      run_id: 'run_01',
      verdict: 'warn',
      score: {
        technical: 0.8,
        product: 0.5,
        ux: 0.3,
        release: 0.2,
        ops: 0.1,
      },
      counts: {
        received: 2,
        accepted: 1,
        rejected: 1,
        findings: 1,
      },
      agent_id: 'agent_1',
      agent_kind: 'acp',
      agent_role: 'assessment-worker',
      worker_session_id: 'worker_1',
      verdict_detail: {
        status: 'WARN',
        delivery_state: 'CONDITIONAL',
        reason: 'non-blocking findings present',
        counts: {
          received: 2,
          accepted: 1,
          rejected: 1,
          findings: 1,
        },
      },
    });

    const run = useAssessment.getState().runs.get('run_01');
    expect(run?.validation?.received).toBe(2);
    expect(run?.validation?.rejected).toBe(1);
    expect(run?.validation?.rejection_reasons.missing_evidence).toBe(1);
    expect(run?.scope?.repo_ref).toBe('branch:main');
    expect(run?.connector_snapshots?.[0]?.connector_id).toBe('github_default');
    expect(run?.agent_id).toBe('agent_1');
    expect(run?.agent_kind).toBe('acp');
    expect(run?.progress.phase).toBe('validation');
    expect(run?.progress.pass).toBe(2);
    expect(run?.progress.max_passes).toBe(3);
    expect(run?.progress.reason).toBe('pass_started');
    expect(run?.progress.elapsed_ms).toBe(4200);
    expect(run?.status).toBe('completed');
    expect(run?.verdict).toBe('warn');
    expect(run?.verdict_detail?.delivery_state).toBe('CONDITIONAL');
    expect(useAssessment.getState().findings.get('fnd_01')?.title).toBe('Validated finding');
    expect(useAssessment.getState().evidence.get('ev_01')?.label).toBe(
      'apps/web/src/stores/assessment.ts:1',
    );
    expect(useAssessment.getState().evidence.get('ev_01')?.uri).toBe(
      'file:///workspace/apps/web/src/stores/assessment.ts',
    );

    off();
  });

  it('marks failed assessments as failed with worker metadata', () => {
    const { t, emit } = mockTransport();
    const off = registerAssessmentHandlers(t);

    emit('assessment.started', {
      run_id: 'run_fail',
      swarm: 'security',
      total_checks: 1,
      started_at: '2026-01-01T00:00:00Z',
      agent_id: 'agent_2',
      agent_kind: 'mock',
      agent_role: 'assessment-worker',
      worker_session_id: 'worker_2',
    });
    emit('assessment.failed', {
      run_id: 'run_fail',
      status: 'cancelled',
      reason: 'user requested cancel',
      detail: 'bridge received cancel signal',
      agent_id: 'agent_2',
      agent_kind: 'mock',
      agent_role: 'assessment-worker',
      worker_session_id: 'worker_2',
    });

    const run = useAssessment.getState().runs.get('run_fail');
    expect(run?.status).toBe('cancelled');
    expect(run?.failure?.reason).toBe('user requested cancel');
    expect(run?.failure?.detail).toBe('bridge received cancel signal');
    expect(run?.agent_id).toBe('agent_2');
    expect(run?.worker_session_id).toBe('worker_2');

    off();
  });

  it('hydrates sweep lifecycle and backend query payloads', () => {
    const { t, emit } = mockTransport();
    const off = registerAssessmentHandlers(t);

    emit('assessment.sweep.started', {
      sweep_id: 'sweep_01',
      families: ['rtd', 'security'],
      status: 'running',
      started_at: '2026-01-01T00:00:00Z',
      total_runs: 2,
      agent_id: 'agent_3',
      agent_kind: 'acp',
      agent_role: 'assessment-sweep',
    });

    emit('assessment.started', {
      run_id: 'run_sweep_01',
      swarm: 'rtd',
      total_checks: 2,
      started_at: '2026-01-01T00:00:00Z',
      sweep_id: 'sweep_01',
      agent_id: 'agent_3',
      agent_kind: 'acp',
      agent_role: 'assessment-worker',
      worker_session_id: 'worker_3',
    });

    emit('assessment.sweep.progress', {
      sweep_id: 'sweep_01',
      status: 'running',
      completed: 1,
      total: 2,
      current: 'rtd',
      phase: 'family_complete',
      reason: 'child_completed',
      elapsed_ms: 2500,
      verdict: 'warn',
      counts: {
        completed: 1,
        total: 2,
      },
    });

    emit('assessment.sweep.completed', {
      sweep_id: 'sweep_01',
      status: 'completed',
      completed: 2,
      total: 2,
      verdict: 'warn',
      verdict_detail: {
        status: 'WARN',
        delivery_state: 'CONDITIONAL',
        reason: 'non-blocking findings present',
        counts: {
          completed: 2,
          total: 2,
        },
      },
      counts: {
        completed: 2,
        total: 2,
      },
      agent_id: 'agent_3',
      agent_kind: 'acp',
      agent_role: 'assessment-sweep',
    });

    emit('assessment.runs_listed', {
      active_run_id: 'run_sweep_01',
      active_sweep_id: 'sweep_01',
      runs: [
        {
          id: 'run_sweep_01',
          swarm: 'rtd',
          status: 'completed',
          started_at: '2026-01-01T00:00:00Z',
          finished_at: '2026-01-01T00:00:02Z',
          sweep_id: 'sweep_01',
          progress: {
            completed: 2,
            total: 2,
          },
          validation: {
            received: 2,
            rejected: 0,
            rejection_reasons: {},
          },
        },
      ],
      sweeps: [
        {
          id: 'sweep_01',
          families: ['rtd', 'security'],
          status: 'completed',
          started_at: '2026-01-01T00:00:00Z',
          finished_at: '2026-01-01T00:00:02Z',
          progress: {
            completed: 2,
            total: 2,
          },
          run_ids: ['run_sweep_01'],
          verdict: 'warn',
          verdict_detail: {
            status: 'WARN',
            delivery_state: 'CONDITIONAL',
            reason: 'non-blocking findings present',
          },
        },
      ],
    });

    emit('assessment.report_fetched', {
      run: {
        id: 'run_sweep_01',
        swarm: 'rtd',
        status: 'completed',
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:00:02Z',
        sweep_id: 'sweep_01',
        progress: {
          completed: 2,
          total: 2,
        },
        validation: {
          received: 2,
          rejected: 0,
          rejection_reasons: {},
        },
        verdict: 'warn',
      },
      findings: [
        {
          finding_id: 'finding_1',
          identity_hash: 'hash_1',
          run_id: 'run_sweep_01',
          category: 'technical',
          subject: 'src/app.ts',
          check: 'check',
          severity: 'medium',
          confidence: 0.9,
          title: 'Finding 1',
          summary: 'Summary',
          evidence_ids: ['evidence_1'],
          emitted_at: '2026-01-01T00:00:01Z',
        },
      ],
      evidence: [
        {
          id: 'evidence_1',
          connector: 'filesystem',
          kind: 'file',
          label: 'src/app.ts:1',
          captured_at: '2026-01-01T00:00:00Z',
          ttl_seconds: 60,
          preview: 'line 1',
        },
      ],
      sweep: {
        id: 'sweep_01',
        families: ['rtd', 'security'],
        status: 'completed',
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:00:02Z',
        progress: {
          completed: 2,
          total: 2,
        },
        run_ids: ['run_sweep_01'],
        verdict: 'warn',
        verdict_detail: {
          status: 'WARN',
          delivery_state: 'CONDITIONAL',
          reason: 'non-blocking findings present',
        },
      },
    });

    emit('assessment.diffed', {
      base_run_id: 'run_base',
      next_run_id: 'run_sweep_01',
      base_run: {
        id: 'run_base',
        swarm: 'rtd',
        status: 'completed',
        started_at: '2026-01-01T00:00:00Z',
      },
      next_run: {
        id: 'run_sweep_01',
        swarm: 'rtd',
        status: 'completed',
        started_at: '2026-01-01T00:00:00Z',
      },
      counts: {
        resolved: 1,
        persistent: 0,
        regressed: 0,
        new: 1,
      },
      entries: [
        {
          bucket: 'resolved',
          identity_hash: 'hash_base',
          prev: {
            id: 'prev_finding',
            identity_hash: 'hash_base',
            run_id: 'run_base',
            category: 'technical',
            subject: 'src/prev.ts',
            check: 'check',
            severity: 'low',
            confidence: 0.8,
            title: 'Old',
            summary: 'Old summary',
            evidence_ids: [],
            emitted_at: '2026-01-01T00:00:00Z',
          },
        },
      ],
    });

    const store = useAssessment.getState();
    expect(store.sweeps.get('sweep_01')?.status).toBe('completed');
    expect(store.sweeps.get('sweep_01')?.run_ids).toContain('run_sweep_01');
    expect(store.runs.get('run_sweep_01')?.status).toBe('completed');
    expect(store.runs.get('run_sweep_01')?.verdict).toBe('warn');
    expect(store.evidence.get('evidence_1')?.preview).toBe('line 1');
    expect(store.diffs.get('run_base\x00run_sweep_01')?.counts.new).toBe(1);

    off();
  });
});
