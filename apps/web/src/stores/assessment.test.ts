import { beforeEach, describe, expect, it } from 'vitest';
import { freshnessTier, useAssessment, type EvidenceRef } from './assessment';

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

  it('emitFinding dedups by identity_hash (replaces old id)', () => {
    useAssessment.getState().emitFinding(baseFinding);
    useAssessment.getState().emitFinding({ ...baseFinding, id: 'f2', title: 'newer' });
    const s = useAssessment.getState();
    expect(s.findings.size).toBe(1);
    expect(s.findings.get('f2')?.title).toBe('newer');
    expect(s.findingsByHash.get('h1')).toBe('f2');
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
