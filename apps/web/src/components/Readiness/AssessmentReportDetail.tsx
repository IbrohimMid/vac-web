// AssessmentReportDetail — Stage J.
//
// Two-column report view: virtualized findings list (left) + verdict /
// run-details / compare cards (right aside). Lives inline within the
// Readiness route via a report-mode toggle in ReadinessHub — no router
// changes.
//
// Selection lives in stores/assessmentReport.ts; HandoffBuilder reads it on
// mount. We deliberately do NOT touch useAttachments here — that store is
// composer chat context, not finding selection.

import { useEffect, useMemo, useRef } from 'react';
import { CompareCard } from './CompareCard';
import { FindingsList } from './FindingsList';
import { RunDetailsCard } from './RunDetailsCard';
import { VerdictCard } from './VerdictCard';
import { useAssessment, type Finding } from '../../stores/assessment';
import { useAssessmentReport } from '../../stores/assessmentReport';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { requestAssessmentFetchReport } from '../../domain/assessment/queries';

interface Props {
  runId: string;
  onBack(): void;
  transport: TransportHandle | null;
}

export function AssessmentReportDetail({ runId, onBack, transport }: Props) {
  const run = useAssessment((s) => s.runs.get(runId));
  const findings = useAssessment((s) => s.findings);
  const selected = useAssessmentReport((s) => s.selectedFindingIds);
  const toggleFinding = useAssessmentReport((s) => s.toggleFinding);
  const setRoute = useCockpit((s) => s.setRoute);
  const sessionId = useSession((s) => s.sessionId);
  const requested = useRef<string | null>(null);

  useEffect(() => {
    if (run || requested.current === runId || !transport || !sessionId) return;
    requested.current = runId;
    void requestAssessmentFetchReport(transport, sessionId, runId).catch(() => {});
  }, [run, transport, sessionId, runId]);

  const runFindings = useMemo<Finding[]>(() => {
    const list: Finding[] = [];
    for (const f of findings.values()) if (f.run_id === runId) list.push(f);
    return list;
  }, [findings, runId]);

  if (!run) {
    return (
      <div style={{ padding: 'var(--pad)' }}>
        <p className="muted" style={{ fontSize: 13 }}>
          Loading report...
        </p>
        <button className="btn ghost" onClick={onBack}>
          ← Back
        </button>
      </div>
    );
  }

  const goToHandoff = () => {
    // Navigate via cockpit route store. HandoffBuilder reads
    // useAssessmentReport.selectedFindingIds on mount and pre-fills its picker.
    setRoute('handoff');
  };

  const selectedCount = selected.size;
  const validatedCount = runFindings.length;
  const rejectedCount = run.validation?.rejected ?? 0;

  return (
    <div style={{ padding: 'var(--pad)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 'var(--gap)',
        }}
      >
        <button className="btn ghost" onClick={onBack}>
          ← Readiness
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          /
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {run.swarm.toUpperCase()} report
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          · {run.status}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="btn primary"
          onClick={goToHandoff}
          disabled={selectedCount === 0}
          style={{ opacity: selectedCount === 0 ? 0.5 : 1 }}
        >
          Create handoff ({selectedCount})
        </button>
      </header>

      <div className="report-grid" style={reportGridStyle}>
        <div>
          <div
            className="findings-toolbar"
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 0',
              borderBottom: '1px solid var(--line-soft)',
              marginBottom: 8,
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <span className="badge accent">{selectedCount} selected</span>
            <span className="muted">
              {validatedCount} validated finding{validatedCount === 1 ? '' : 's'} in this run
            </span>
            {rejectedCount > 0 && <span className="badge warn">{rejectedCount} rejected</span>}
            <div style={{ flex: 1 }} />
            <button
              className="btn sm ghost"
              onClick={() => useAssessmentReport.getState().clearSelection()}
              disabled={selectedCount === 0}
            >
              Clear selection
            </button>
          </div>
          <FindingsList
            findings={runFindings}
            transport={transport}
            selection={selected}
            onToggle={toggleFinding}
            maxHeight={640}
          />
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
          <VerdictCard verdict={run.verdict} findings={runFindings} />
          <RunDetailsCard run={run} validatedFindings={validatedCount} />
          <CompareCard run={run} transport={transport} />
        </aside>
      </div>
    </div>
  );
}

const reportGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: 'var(--gap)',
  alignItems: 'start',
};
