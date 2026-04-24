import { describe, expect, it } from 'vitest';
import { detectRegression } from './detect';
import type { Finding, Run } from '../../stores/assessment';

type VerdictT = NonNullable<Run['verdict']>;
type ScoreT = NonNullable<Run['score']>;
const mkRun = (id: string, verdict: VerdictT, score?: Partial<ScoreT>): Run => {
  const base: Run = {
    id,
    swarm: 'rtd',
    status: 'completed',
    started_at: 't',
    progress: { completed: 5, total: 5 },
    verdict,
  };
  if (score) {
    base.score = {
      technical: 0.8,
      product: 0.8,
      ux: 0.8,
      release: 0.8,
      ops: 0.8,
      ...score,
    };
  }
  return base;
};

const mkFinding = (hash: string, run_id: string): Finding => ({
  id: `${run_id}_${hash}`,
  identity_hash: hash,
  run_id,
  category: 'technical',
  subject: '',
  check: '',
  severity: 'medium',
  confidence: 0.8,
  title: `t ${hash}`,
  summary: '',
  evidence_ids: [],
  emitted_at: 't',
});

describe('detectRegression', () => {
  it('verdict drop pass → warn fires a signal', () => {
    const prev = mkRun('r1', 'pass');
    const next = mkRun('r2', 'warn');
    const signals = detectRegression(prev, [], next, [], null);
    expect(signals.some((s) => s.kind === 'verdict_drop')).toBe(true);
  });

  it('verdict improvement never fires', () => {
    const prev = mkRun('r1', 'fail');
    const next = mkRun('r2', 'pass');
    expect(detectRegression(prev, [], next, [], null)).toHaveLength(0);
  });

  it('score drop ≥ 0.15 fires; smaller drop ignored', () => {
    const prev = mkRun('r1', 'pass', { technical: 0.9 });
    const nextBig = mkRun('r2', 'pass', { technical: 0.7 }); // drop 0.2
    const nextSmall = mkRun('r3', 'pass', { technical: 0.8 }); // drop 0.1
    expect(detectRegression(prev, [], nextBig, [], null).some((s) => s.kind === 'score_drop')).toBe(
      true,
    );
    expect(
      detectRegression(prev, [], nextSmall, [], null).some((s) => s.kind === 'score_drop'),
    ).toBe(false);
  });

  it('finding returns: in last-green, absent in prev, present in next', () => {
    const prev = mkRun('r1', 'pass');
    const next = mkRun('r2', 'warn');
    const returned = mkFinding('abc', 'r2');
    const signals = detectRegression(
      prev,
      [], // prev had NO findings (the issue was fixed)
      next,
      [returned],
      [mkFinding('abc', 'r0')], // but it was present in the last green run
    );
    expect(signals.some((s) => s.kind === 'finding_returned')).toBe(true);
  });

  it('no prev run still checks next vs last-green for returns', () => {
    const next = mkRun('r1', 'warn');
    // With null prev, verdict/score branches are no-ops; finding-returned path
    // requires prev-findings list which we pass as [].
    const signals = detectRegression(null, [], next, [mkFinding('abc', 'r1')], [
      mkFinding('abc', 'r-green'),
    ]);
    expect(signals.some((s) => s.kind === 'finding_returned')).toBe(true);
  });
});
