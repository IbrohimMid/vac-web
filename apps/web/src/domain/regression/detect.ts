// Regression detector. Runs when a continuous cadence completes a family's
// run; compares to the last-cached completed run of the same family.
//
// Conditions (any one fires a regression):
//   1. Verdict drop: pass→warn, pass→fail, warn→fail.
//   2. Any score category dropped by ≥ 0.15 absolute.
//   3. A previously-resolved finding reappeared (identity_hash match against
//      last green run).
//
// Distinct from the Phase 5 convergence guard: convergence is handoff-cycle
// driven (are we making progress across handoff→reassess loops), regression
// is continuous-cadence driven (has steady-state quality dropped?).

import type { Category, Finding, Run, Verdict } from '../../stores/assessment';

const VERDICT_RANK: Record<Verdict, number> = {
  pass: 3,
  warn: 2,
  fail: 1,
  unknown: 0,
};

const SCORE_DROP_THRESHOLD = 0.15;

export type RegressionKind = 'verdict_drop' | 'score_drop' | 'finding_returned';

export interface RegressionSignal {
  family: string;
  kind: RegressionKind;
  detail: string;
}

export function detectRegression(
  prev: Run | null,
  prevFindings: Finding[],
  next: Run,
  nextFindings: Finding[],
  lastGreenFindings: Finding[] | null,
): RegressionSignal[] {
  const signals: RegressionSignal[] = [];

  if (prev?.verdict && next.verdict) {
    if (VERDICT_RANK[next.verdict] < VERDICT_RANK[prev.verdict]) {
      signals.push({
        family: next.swarm,
        kind: 'verdict_drop',
        detail: `${prev.verdict} → ${next.verdict}`,
      });
    }
  }

  if (prev?.score && next.score) {
    for (const k of Object.keys(next.score) as Category[]) {
      const pv = prev.score[k] ?? 0;
      const nv = next.score[k] ?? 0;
      if (pv - nv >= SCORE_DROP_THRESHOLD) {
        signals.push({
          family: next.swarm,
          kind: 'score_drop',
          detail: `${k}: ${pv.toFixed(2)} → ${nv.toFixed(2)}`,
        });
      }
    }
  }

  if (lastGreenFindings && lastGreenFindings.length > 0) {
    const greenHashes = new Set(lastGreenFindings.map((f) => f.identity_hash));
    const prevHashes = new Set(prevFindings.map((f) => f.identity_hash));
    for (const f of nextFindings) {
      // Returned = present in last-green AND not present in prev (so it
      // disappeared at some point and now came back).
      if (greenHashes.has(f.identity_hash) && !prevHashes.has(f.identity_hash)) {
        signals.push({
          family: next.swarm,
          kind: 'finding_returned',
          detail: `${f.title} (${f.identity_hash.slice(0, 8)})`,
        });
      }
    }
  }

  return signals;
}
