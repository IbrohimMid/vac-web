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
    });

    emit('assessment.candidate_received', {
      run_id: 'run_01',
      candidate_count: 2,
      candidate_hash: 'sha256:feed',
      source_event_type: 'assessment.candidate_received',
      agent_id: 'agent_1',
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

    const run = useAssessment.getState().runs.get('run_01');
    expect(run?.validation?.received).toBe(2);
    expect(run?.validation?.rejected).toBe(1);
    expect(run?.validation?.rejection_reasons.missing_evidence).toBe(1);
    expect(useAssessment.getState().findings.get('fnd_01')?.title).toBe('Validated finding');
    expect(useAssessment.getState().evidence.get('ev_01')?.label).toBe(
      'apps/web/src/stores/assessment.ts:1',
    );

    off();
  });
});
