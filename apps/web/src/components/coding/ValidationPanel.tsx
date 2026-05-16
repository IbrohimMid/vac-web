import { useMemo } from 'react';
import type { TransportHandle } from '../../transport';
import { useSession } from '../../stores/session';
import { useValidation, type ValidationRun } from '../../stores/validation';
import { useRuntime } from '../../stores/runtime';
import { useShell } from '../../stores/shell';
import {
  requestValidationFailureContext,
  requestValidationRun,
} from '../../domain/validation/handlers';

interface Props {
  transport: TransportHandle | null;
}

function formatDuration(run: ValidationRun): string {
  if (typeof run.durationMs === 'number') return `${Math.round(run.durationMs / 100) / 10}s`;
  if (!run.finishedAt) return '\u2014';
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '\u2014';
  return `${Math.round((end - start) / 100) / 10}s`;
}

export function ValidationPanel({ transport }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  const runsMap = useValidation((s) => s.runs);
  const runOrder = useValidation((s) => s.order);
  const selectedRunId = useValidation((s) => s.selectedRunId);
  const presets = useValidation((s) => s.presets);
  const runtimeJobs = useRuntime((s) => s.jobs);
  const runtimeOrder = useRuntime((s) => s.order);

  const runs = useMemo(
    () =>
      runOrder
        .map((id) => runsMap.get(id))
        .filter(
          (run): run is ValidationRun => !!run && run.sessionId === sessionId,
        ),
    [runOrder, runsMap, sessionId],
  );
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const latestRuntimeJob =
    runtimeOrder.map((id) => runtimeJobs.get(id)).find((job) => job?.kind === 'execute') ?? null;
  const ready = !!transport && !!sessionId;

  const runPreset = (command: string) => {
    if (!ready || !transport || !sessionId) return;
    void requestValidationRun(transport, sessionId, { command });
  };
  const rerun = (run: ValidationRun) => {
    if (!ready || !transport || !sessionId) return;
    void requestValidationRun(transport, sessionId, {
      command: run.command,
      taskId: run.taskId ?? null,
      runId: run.id,
      relatedFiles: run.relatedFiles,
    });
  };
  const sendFailure = (run: ValidationRun) => {
    if (!ready || !transport || !sessionId) return;
    void requestValidationFailureContext(transport, sessionId, run.id);
  };
  const cancelRun = (run: ValidationRun) => {
    useValidation.getState().cancelRun(run.id);
  };

  if (!sessionId) {
    return (
      <div
        className="codeworkspace-empty"
        role="status"
        data-testid="validation-panel-no-session"
      >
        <span className="cw-empty-title">Validation command center</span>
        <span className="cw-empty-hint">
          Connect a session to request validation runs.
        </span>
      </div>
    );
  }

  const canCancel =
    !!selectedRun &&
    (selectedRun.status === 'queued' || selectedRun.status === 'running');
  const canSendFailure = !!selectedRun && selectedRun.status === 'failed';

  return (
    <section
      className="codeworkspace-validation"
      aria-label="Validation command center"
      data-testid="validation-panel"
    >
      <header className="codeworkspace-validation-header">
        <div>
          <span className="cw-empty-title">Validation command center</span>
          <span className="cw-empty-hint">
            Run checks, inspect recent results, and send failures to local AI.
          </span>
        </div>
        <button
          type="button"
          className="codeworkspace-link-btn"
          onClick={() => useShell.getState().setOpen(true)}
        >
          Open runtime logs
        </button>
      </header>
      <div className="codeworkspace-validation-grid">
        <section
          className="codeworkspace-validation-card"
          aria-label="Validation presets"
        >
          <strong>Known commands</strong>
          <div
            className="codeworkspace-validation-presets"
            data-testid="validation-panel-presets"
          >
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="codeworkspace-validation-preset"
                onClick={() => runPreset(preset.command)}
                disabled={!ready}
                title={
                  !ready
                    ? 'Unavailable: validation bridge is not connected.'
                    : preset.command
                }
              >
                <span>{preset.label}</span>
                <code>{preset.command}</code>
                {preset.heavy ? <em>heavy</em> : null}
              </button>
            ))}
          </div>
          <p className="cw-empty-detail codeworkspace-validation-truth">
            Presets can be customized via{' '}
            <code>VITE_VAC_VALIDATION_PRESETS</code>. Heavy commands are
            explicit; bridge/runtime remains authoritative for execution and
            approvals.
          </p>
        </section>
        <section
          className="codeworkspace-validation-card"
          aria-label="Recent validation results"
        >
          <strong>Recent results</strong>
          {runs.length === 0 ? (
            <div
              className="codeworkspace-empty"
              role="status"
              data-testid="validation-panel-empty"
            >
              <span className="cw-empty-title">No validation runs yet</span>
              <span className="cw-empty-hint">
                Run a preset or wait for validation.run.updated events.
              </span>
            </div>
          ) : (
            <ol className="codeworkspace-validation-runs">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="codeworkspace-validation-run"
                  data-status={run.status}
                  data-testid="validation-run"
                >
                  <button
                    type="button"
                    onClick={() =>
                      useValidation.getState().setSelectedRun(run.id)
                    }
                  >
                    <strong>{run.label}</strong>
                    <span>
                      {run.status} {'\u00B7'} {formatDuration(run)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section
          className="codeworkspace-validation-card codeworkspace-validation-detail"
          aria-label="Selected validation detail"
        >
          <strong>Selected run</strong>
          {selectedRun ? (
            <div
              className="codeworkspace-validation-selected"
              data-status={selectedRun.status}
              data-testid="validation-panel-selected"
            >
              <span className="codeworkspace-validation-status">
                {selectedRun.status}
              </span>
              <code>{selectedRun.command}</code>
              <span className="cw-empty-detail">
                Duration: {formatDuration(selectedRun)} {'\u00B7'} Source:{' '}
                {selectedRun.sourceEventType ?? 'local'}
              </span>
              {selectedRun.message ? <p>{selectedRun.message}</p> : null}
              {selectedRun.relatedFiles.length > 0 ? (
                <span className="cw-empty-detail">
                  Files: {selectedRun.relatedFiles.join(', ')}
                </span>
              ) : null}
              <div className="codeworkspace-validation-actions">
                <button
                  type="button"
                  className="codeworkspace-link-btn"
                  data-testid="validation-rerun"
                  onClick={() => rerun(selectedRun)}
                  disabled={!ready}
                >
                  Rerun
                </button>
                <button
                  type="button"
                  className="codeworkspace-link-btn"
                  data-testid="validation-cancel"
                  onClick={() => cancelRun(selectedRun)}
                  disabled={!canCancel}
                  title={
                    canCancel
                      ? 'Marks this run as cancelled locally. Bridge remains authoritative for the underlying process.'
                      : 'Only queued or running validation runs can be cancelled.'
                  }
                >
                  Cancel run
                </button>
                <button
                  type="button"
                  className="codeworkspace-link-btn"
                  data-testid="validation-send-failure"
                  onClick={() => sendFailure(selectedRun)}
                  disabled={!ready || !canSendFailure}
                  title={
                    canSendFailure
                      ? 'Forward this failure context to local AI for triage.'
                      : 'Only failed runs can be sent to local AI.'
                  }
                >
                  Send to local AI
                </button>
              </div>
            </div>
          ) : (
            <span className="cw-empty-hint">
              Select a validation run to inspect details.
            </span>
          )}
        </section>
      </div>
      {latestRuntimeJob ? (
        <p className="cw-empty-detail codeworkspace-validation-truth">
          Latest runtime execute job: {latestRuntimeJob.label} {'\u00B7'}{' '}
          {latestRuntimeJob.status}
        </p>
      ) : (
        <p className="cw-empty-detail codeworkspace-validation-truth">
          Runtime logs will remain the source of truth for command output.
        </p>
      )}
    </section>
  );
}
