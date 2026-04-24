// Regression watcher: whenever an assessment.completed event arrives, compare
// the just-finished run against the most recent prior completed run of the
// same family and emit a sticky notify banner per detected signal.
//
// Source of truth is the bridge (it'll ship the equivalent check server-side
// in §8.3 upstream); this web-side mirror keeps the user surface responsive
// without waiting for a round-trip and makes the behavior testable.

import { detectRegression, type RegressionSignal } from './detect';
import type { Finding, Run } from '../../stores/assessment';
import { useAssessment } from '../../stores/assessment';
import { useNotify } from '../../stores/notify';
import type { TransportHandle } from '../../transport';

export function registerRegressionHandlers(transport: TransportHandle): () => void {
  return transport.on('assessment.completed', (ev) => {
    const p = ev.payload as { run_id?: string } | null;
    if (!p?.run_id) return;
    const state = useAssessment.getState();
    const next = state.runs.get(p.run_id);
    if (!next || next.status !== 'completed') return;

    const { prev, prevFindings, lastGreenFindings, nextFindings } = materializeBaselines(
      state.runs,
      state.runOrder,
      state.findings,
      next,
    );

    const signals = detectRegression(prev, prevFindings, next, nextFindings, lastGreenFindings);
    for (const sig of signals) pushSticky(sig, next.id);
  });
}

function materializeBaselines(
  runs: Map<string, Run>,
  order: string[],
  findings: Map<string, Finding>,
  next: Run,
): {
  prev: Run | null;
  prevFindings: Finding[];
  lastGreenFindings: Finding[] | null;
  nextFindings: Finding[];
} {
  const sameFamily = order
    .map((id) => runs.get(id))
    .filter((r): r is Run => !!r && r.swarm === next.swarm && r.status === 'completed');
  // `order` is insertion order; the run before `next` of the same family is
  // the comparison baseline.
  const nextIdx = sameFamily.findIndex((r) => r.id === next.id);
  const prev = nextIdx > 0 ? (sameFamily[nextIdx - 1] ?? null) : null;

  // Last-green baseline: walk *back* from prev, take the most recent pass.
  let lastGreen: Run | null = null;
  for (let i = nextIdx - 1; i >= 0; i--) {
    const r = sameFamily[i];
    if (r && r.verdict === 'pass') {
      lastGreen = r;
      break;
    }
  }

  const findingsByRun = (runId: string): Finding[] => {
    const out: Finding[] = [];
    for (const f of findings.values()) if (f.run_id === runId) out.push(f);
    return out;
  };

  return {
    prev,
    prevFindings: prev ? findingsByRun(prev.id) : [],
    lastGreenFindings: lastGreen ? findingsByRun(lastGreen.id) : null,
    nextFindings: findingsByRun(next.id),
  };
}

function pushSticky(sig: RegressionSignal, runId: string) {
  useNotify.getState().receive({
    id: `regression_${sig.family}_${sig.kind}_${runId}`,
    lane: 'sticky',
    severity: 'warn',
    subsystem: 'regression',
    title: `${sig.family} ${sig.kind}`,
    message: sig.detail,
    correlationId: `regression_${sig.family}`,
    ts: new Date().toISOString(),
  });
}

// Exposed for unit tests.
export { materializeBaselines };
