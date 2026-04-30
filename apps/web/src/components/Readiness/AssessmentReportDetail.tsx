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
import { useAssessment, queryFailureKey, type Finding } from '../../stores/assessment';
import { useAssessmentReport } from '../../stores/assessmentReport';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { reasonLabel, requestAssessmentFetchReport } from '../../domain/assessment/queries';

interface Props {
  runId: string;
  onBack(): void;
  transport: TransportHandle | null;
}

export function AssessmentReportDetail({ runId, onBack, transport }: Props) {
  const run = useAssessment((s) => s.runs.get(runId));
  const findings = useAssessment((s) => s.findings);
  const fetchReportError = useAssessment((s) =>
    s.queryErrors.get(queryFailureKey('fetch_report', runId)),
  );
  const clearQueryFailure = useAssessment((s) => s.clearQueryFailure);
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

  const retryFetchReport = () => {
    if (!transport || !sessionId) return;
    clearQueryFailure('fetch_report', runId);
    requested.current = null;
    void requestAssessmentFetchReport(transport, sessionId, runId).catch(() => {});
  };

  const runFindings = useMemo<Finding[]>(() => {
    const list: Finding[] = [];
    for (const f of findings.values()) if (f.run_id === runId) list.push(f);
    return list;
  }, [findings, runId]);

  if (!run) {
    return (
      <div style={padStyle}>
        {fetchReportError ? (
          <div role="alert" className="card" style={errorCardStyle}>
            <strong style={errorTitleStyle}>
              {reasonLabel(fetchReportError.reason)}
            </strong>
            <p className="muted" style={errorMessageStyle}>
              {fetchReportError.message}
            </p>
            <div style={errorButtonRowStyle}>
              <button
                className="btn sm"
                onClick={retryFetchReport}
                disabled={!transport || !sessionId}
              >
                Retry
              </button>
              <button className="btn sm ghost" onClick={onBack}>
                ← Back
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="muted" style={loadingStyle}>
              Loading report...
            </p>
            <button className="btn ghost" onClick={onBack}>
              ← Back
            </button>
          </>
        )}
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
    <div style={shellStyle}>
      <header style={headerStyle}>
        <button className="btn ghost" onClick={onBack}>
          ← Readiness
        </button>
        <span className="muted" style={separatorStyle}>
          /
        </span>
        <span style={titleStyle}>
          {run.swarm.toUpperCase()} report
        </span>
        <span className="muted" style={statusStyle}>
          · {run.status}
        </span>
        <div style={spacerStyle} />
        <button
          className="btn primary"
          onClick={goToHandoff}
          disabled={selectedCount === 0}
          style={primaryButtonStyle}
        >
          Create handoff ({selectedCount})
        </button>
      </header>

      <div className="report-grid" style={reportGridStyle}>
        <div>
          <div className="findings-toolbar" style={toolbarStyle}>
            <span className="badge accent">{selectedCount} selected</span>
            <span className="muted">
              {validatedCount} validated finding{validatedCount === 1 ? '' : 's'} in this run
            </span>
            {rejectedCount > 0 && <span className="badge warn">{rejectedCount} rejected</span>}
            <div style={spacerStyle} />
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

        <aside style={asideStyle}>
          <VerdictCard verdict={run.verdict} findings={runFindings} />
          <RunDetailsCard run={run} validatedFindings={validatedCount} />
          <CompareCard run={run} transport={transport} />
        </aside>
      </div>
    </div>
  );
}

const padStyle: React.CSSProperties = { padding: 'var(--pad)' };
const errorCardStyle: React.CSSProperties = {
  borderColor: 'var(--sev-error)',
  padding: 12,
};
const errorTitleStyle: React.CSSProperties = { color: 'var(--sev-error)' };
const errorMessageStyle: React.CSSProperties = { margin: '6px 0 10px' };
const errorButtonRowStyle: React.CSSProperties = { display: 'flex', gap: 8 };
const loadingStyle: React.CSSProperties = { fontSize: 13 };
const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--gap)',
  padding: 'var(--pad)',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingBottom: 'var(--gap)',
  borderBottom: '1px solid var(--border-1)',
};
const separatorStyle: React.CSSProperties = { fontSize: 13 };
const titleStyle: React.CSSProperties = { fontWeight: 600, fontSize: 15 };
const statusStyle: React.CSSProperties = { fontSize: 12.5 };
const spacerStyle: React.CSSProperties = { flex: 1 };
const primaryButtonStyle: React.CSSProperties = { whiteSpace: 'nowrap' };
const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  marginBottom: 8,
  borderBottom: '1px dashed var(--border-1)',
};
const asideStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--gap)',
};
const reportGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: 'var(--gap)',
  alignItems: 'start',
};
