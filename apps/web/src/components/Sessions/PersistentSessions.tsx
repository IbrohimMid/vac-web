// Persistent Sessions panel: lists durable session-history rows
// (meta.json on disk) and offers replay + native resume + forget.
//
// Phase 3 of durable-session-history shipped replay-only; Stage X6
// batch 4-5 wires up the native (`session/load`) resume path for
// agents whose persisted meta has `native_resume.load_session_supported
// == true`. Both buttons are always visible — native is disabled when
// the agent does not advertise the capability — so the operator can
// see the trade-off rather than guessing why a button is missing.

import { useEffect } from 'react';
import {
  requestConfigReload,
  requestConfigValidate,
  requestHistoryForget,
  requestHistoryList,
  requestHistoryResume,
  requestResumePolicy,
} from '../../domain/sessions/history';
import { useSessionHistory } from '../../stores/sessionHistory';
import type { TransportHandle } from '../../transport';

interface Props {
  transport: TransportHandle | null;
}

export function PersistentSessions({ transport }: Props) {
  const rows = useSessionHistory((s) => s.rows);
  const persistence = useSessionHistory((s) => s.persistence);
  const resume = useSessionHistory((s) => s.resume);
  const resumeWarnings = useSessionHistory((s) => s.resumeWarnings);
  const health = useSessionHistory((s) => s.health);
  const recentFailures = useSessionHistory((s) => s.recentFailures);
  // Stage R3 — read the runtime-enforced resume policy snapshot for
  // the read-only preview block. We render a fallback row when the
  // bridge hasn't replied yet so the panel structure stays stable.
  const resumePolicy = useSessionHistory((s) => s.resumePolicy);
  const configDiagnostics = useSessionHistory((s) => s.configDiagnostics);
  // Stage R4 — R4 surfaces the rest of the live config snapshot so
  // the operator can confirm what agents and MCP servers the runtime
  // currently knows about, separate from the resume policy preview.
  const configStatus = useSessionHistory((s) => s.configStatus);
  const configReloading = useSessionHistory((s) => s.configReloading);
  const configLoadedAt = useSessionHistory((s) => s.configLoadedAt);
  const configActiveSnapshotRetained = useSessionHistory((s) => s.configActiveSnapshotRetained);
  const configLastReloadFailedAt = useSessionHistory((s) => s.configLastReloadFailedAt);
  const vacVersion = useSessionHistory((s) => s.vacVersion);
  const agentsSummary = useSessionHistory((s) => s.agentsSummary);
  const mcpSummary = useSessionHistory((s) => s.mcpSummary);

  useEffect(() => {
    if (!transport) return;
    void requestHistoryList(transport, { limit: 50 });
    // Stage R3 — fetch the policy on mount so the preview block is
    // populated before the user opens the persistent sessions panel.
    // The bridge's reply is a `config.validated` ServerEvent that the
    // history domain handler already routes into the store.
    void requestResumePolicy(transport);
  }, [transport]);

  // Stage R4 — chip reflects the live `configStatus` rather than
  // the diagnostic-count proxy used in R3. Topbar surfaces the same
  // state via `<ConfigStatusChip />` for quick scanning; this chip
  // sits inline with the preview block so the operator who has the
  // panel open can read severity + diagnostics in one place.
  const policyChip =
    configStatus === 'invalid' || configDiagnostics.length > 0 ? (
      <div
        role="alert"
        aria-label="Resume policy config invalid"
        title={
          configDiagnostics.map((d) => `${d.path}: ${d.message}`).join('\n') ||
          (configActiveSnapshotRetained
            ? 'Reload failed; runtime is still using the previous active snapshot.'
            : 'Bridge reports the live snapshot is invalid.')
        }
        style={configChipStyle}
      >
        ⚠️ {configActiveSnapshotRetained ? 'Reload failed' : 'Config invalid'}
        {configDiagnostics.length > 0 ? (
          <span style={chipDetailStyle}> ({configDiagnostics.length})</span>
        ) : null}
      </div>
    ) : configStatus === 'valid' ? (
      <div
        aria-label="Resume policy config valid"
        title={configLoadedAt ? `Loaded at ${configLoadedAt}` : 'Snapshot loaded.'}
        style={configOkChipStyle}
      >
        ✓ Config valid
      </div>
    ) : null;

  const policyPreview = resumePolicy ? (
    <dl aria-label="Resume policy" style={policyDlStyle}>
      <div style={policyRowStyle}>
        <dt style={policyDtStyle}>Default mode</dt>
        <dd style={policyDdStyle}>{resumePolicy.default_mode}</dd>
      </div>
      <div style={policyRowStyle}>
        <dt style={policyDtStyle}>Native fallback</dt>
        <dd style={policyDdStyle}>{resumePolicy.native_fallback}</dd>
      </div>
      <div style={policyRowStyle}>
        <dt style={policyDtStyle}>MCP drift</dt>
        <dd style={policyDdStyle}>{resumePolicy.mcp_server_drift}</dd>
      </div>
      <div style={policyRowStyle}>
        <dt style={policyDtStyle}>Profile class</dt>
        <dd style={policyDdStyle}>{resumePolicy.profile_class_mismatch}</dd>
      </div>
      <div style={policyRowStyle}>
        <dt style={policyDtStyle}>Retention</dt>
        <dd style={policyDdStyle}>{resumePolicy.retention_days} days</dd>
      </div>
      <div style={policyRowStyle}>
        <dt style={policyDtStyle}>Max events</dt>
        <dd style={policyDdStyle}>{resumePolicy.max_events.toLocaleString()}</dd>
      </div>
      {agentsSummary ? (
        <div style={policyRowStyle}>
          <dt style={policyDtStyle}>Agents</dt>
          <dd style={policyDdStyle} title={agentsSummary.items.map((a) => `${a.id} (${a.kind})`).join(', ')}>
            {agentsSummary.count}
            {agentsSummary.default_id ? ` (default: ${agentsSummary.default_id})` : ''}
          </dd>
        </div>
      ) : null}
      {mcpSummary ? (
        <div style={policyRowStyle}>
          <dt style={policyDtStyle}>MCP servers</dt>
          <dd style={policyDdStyle} title={mcpSummary.servers.map((m) => `${m.id} (${m.transport})`).join(', ')}>
            {mcpSummary.count}
          </dd>
        </div>
      ) : null}
      {vacVersion > 0 ? (
        <div style={policyRowStyle}>
          <dt style={policyDtStyle}>vac.yaml version</dt>
          <dd style={policyDdStyle}>{vacVersion}</dd>
        </div>
      ) : null}
    </dl>
  ) : null;

  // Stage R4 — diagnostic detail list (when the live snapshot is
  // invalid) so the operator can see exactly which YAML path tripped
  // the gate without leaving the panel.
  const diagnosticList =
    configDiagnostics.length > 0 ? (
      <ul aria-label="Config diagnostics" style={diagListStyle}>
        {configDiagnostics.map((d, i) => (
          <li key={`${d.scope}:${d.path}:${i}`} style={diagItemStyle}>
            <span style={diagSeverityStyle(d.severity)}>{(d.severity ?? 'error').toUpperCase()}</span>{' '}
            <code style={diagPathStyle}>{d.scope}/{d.path}</code>{': '}
            <span>{d.message}</span>
            {d.code ? <span style={diagCodeStyle}> [{d.code}]</span> : null}
          </li>
        ))}
      </ul>
    ) : null;

  const reloadDisabled = !transport || configReloading;
  const reloadLabel = configReloading ? 'Reloading\u2026' : 'Reload config';

  const policyBlock = (resumePolicy || policyChip || configReloading) ? (
    <section aria-label="Resume policy" style={policyBlockStyle}>
      <header style={policyHeaderStyle}>
        <span>Active config</span>
        <span style={headerActionsStyle}>
          {policyChip}
          <button
            type="button"
            onClick={() => transport && void requestConfigValidate(transport)}
            disabled={!transport}
            style={inlineBtnStyle}
            title="Re-emit the live config snapshot without re-reading YAML."
            aria-label="Validate config"
          >
            Validate
          </button>
          <button
            type="button"
            onClick={() => transport && void requestConfigReload(transport)}
            disabled={reloadDisabled}
            style={inlineBtnStyle}
            title="Re-read every config/*.yaml file and swap the live snapshot if validation passes."
            aria-label="Reload config"
          >
            {reloadLabel}
          </button>
        </span>
      </header>
      {policyPreview}
      {configActiveSnapshotRetained ? (
        <div role="status" style={retainedSnapshotStyle}>
          Active config unchanged. Runtime is still using the last successful snapshot
          {configLoadedAt ? ` from ${formatDate(configLoadedAt)}` : ''}
          {configLastReloadFailedAt ? `; reload failed at ${formatDate(configLastReloadFailedAt)}` : ''}.
        </div>
      ) : null}
      {diagnosticList}
    </section>
  ) : null;

  // Stage X6 P2-B — health chip. Rendered inline above whatever
  // body content this panel shows (table, empty state, or disabled
  // notice) so the user always sees a degradation, not just when
  // there are rows.
  const healthChip =
    health === 'degraded' ? (
      <div
        role="alert"
        aria-label="Persistence degraded"
        title={
          recentFailures[0]
            ? `${recentFailures[0].reason}: ${recentFailures[0].detail}`
            : 'Bridge persistence has reported a recent failure.'
        }
        style={chipStyle}
      >
        ⚠️ Persistence degraded
        {recentFailures[0] ? (
          <span style={chipDetailStyle}> ({recentFailures[0].reason})</span>
        ) : null}
      </div>
    ) : null;

  if (persistence === 'disabled') {
    return (
      <div>
        {healthChip}
        {policyBlock}
        <div role="status" style={emptyStyle}>
          Persistent session history is disabled on this bridge.
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div>
        {healthChip}
        {policyBlock}
        <div role="status" style={emptyStyle}>
          No persistent sessions yet — they will appear here after the first
          message in a new session.
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Persistent sessions" style={sectionStyle}>
      {healthChip}
      {policyBlock}
      <h3 style={headingStyle}>Persistent sessions</h3>
      <table aria-label="Persistent sessions" style={tableStyle}>
        <thead>
          <tr style={headRow}>
            <th style={th}>ID</th>
            <th style={th}>Agent</th>
            <th style={th}>Profile</th>
            <th style={th}>Project</th>
            <th style={th}>Status</th>
            <th style={th}>Updated</th>
            <th style={th}>Native?</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const warning = resumeWarnings[r.vac_session_id];
            // Stage X6 4-5 — "busy" now includes the new in-flight
            // states (`initializing`, `loading_native`) so neither
            // button can be re-clicked while a resume is mid-flight.
            const busy =
              (resume.kind === 'starting' ||
                resume.kind === 'initializing' ||
                resume.kind === 'loading_native' ||
                resume.kind === 'replaying') &&
              'vac_session_id' in resume &&
              resume.vac_session_id === r.vac_session_id;
            const defaultMode = resumePolicy?.default_mode ?? 'replay_only';
            const defaultLabel = busy ? 'Resuming\u2026' : 'Resume default';
            const defaultTitle = resumePolicy
              ? defaultResumeTitle(resumePolicy)
              : 'Resume using the bridge default policy. Policy not loaded yet; replay-only is used as the safe fallback.';
            const replayLabel = busy
              ? resume.kind === 'replaying'
                ? `Replaying${
                    'replayed' in resume && resume.replayed > 0 ? ` (${resume.replayed})` : '\u2026'
                  }`
                : 'Resuming\u2026'
              : 'Replay only';
            const nativeLabel = busy
              ? resume.kind === 'loading_native'
                ? 'Loading\u2026'
                : resume.kind === 'starting' && 'mode' in resume && resume.mode === 'acp_load'
                ? 'Resuming\u2026'
                : 'Resume (native)'
              : 'Resume (native)';
            const nativeDisabled =
              !transport || busy || !r.native_resume_supported;
            const nativeTitle = r.native_resume_supported
              ? 'Ask the agent to natively reload this session via session/load. Falls back to error if the agent rejects it.'
              : 'This agent has not advertised loadSession capability for this session, so native resume is not available.';
            return (
              <tr key={r.vac_session_id} style={bodyRow}>
                <td style={td} title={r.vac_session_id}>
                  {r.vac_session_id.slice(0, 12)}…
                </td>
                <td style={td}>
                  {r.agent_id}
                  <span style={agentKindStyle}> ({r.agent_kind})</span>
                </td>
                <td style={td}>{r.profile_id}</td>
                <td style={td} title={r.project_root}>
                  {shortPath(r.project_root)}
                </td>
                <td style={td}>
                  {r.status}
                  {warning ? (
                    <div
                      role="status"
                      title={
                        warning.detail
                          ? `${warning.reason}: ${warning.detail}`
                          : warning.reason
                      }
                      style={rowWarningStyle}
                    >
                      Resume warning: {warningLabel(warning.reason)}
                    </div>
                  ) : null}
                </td>
                <td style={td}>{formatDate(r.updated_at)}</td>
                <td style={td}>{r.native_resume_supported ? 'yes' : 'replay'}</td>
                <td style={td}>
                  <button
                    onClick={() =>
                      transport &&
                      requestHistoryResume(transport, r.vac_session_id, defaultMode)
                    }
                    disabled={!transport || busy}
                    aria-label={`Resume ${r.vac_session_id} using default policy`}
                    title={defaultTitle}
                  >
                    {defaultLabel}
                  </button>{' '}
                  <button
                    onClick={() =>
                      transport &&
                      requestHistoryResume(transport, r.vac_session_id, 'replay_only')
                    }
                    disabled={!transport || busy}
                    aria-label={`Resume ${r.vac_session_id} (replay only)`}
                    title="Replay the persisted event log into a fresh session. Always available when persistence is on."
                  >
                    {replayLabel}
                  </button>{' '}
                  <button
                    onClick={() =>
                      transport &&
                      requestHistoryResume(transport, r.vac_session_id, 'acp_load')
                    }
                    disabled={nativeDisabled}
                    aria-label={`Resume ${r.vac_session_id} natively via session/load`}
                    title={nativeTitle}
                  >
                    {nativeLabel}
                  </button>{' '}
                  <button
                    onClick={() =>
                      transport &&
                      window.confirm('Forget this session? This is permanent.') &&
                      requestHistoryForget(transport, r.vac_session_id)
                    }
                    disabled={!transport}
                    aria-label={`Forget ${r.vac_session_id}`}
                  >
                    Forget
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function shortPath(p: string): string {
  if (!p) return '—';
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join('/')}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

const sectionStyle: React.CSSProperties = { marginTop: 12 };
const headingStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 13,
  opacity: 0.8,
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const headRow: React.CSSProperties = { textAlign: 'left', opacity: 0.7 };
const bodyRow: React.CSSProperties = { borderTop: '1px solid #2226' };
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px' };
const emptyStyle: React.CSSProperties = {
  padding: 12,
  fontSize: 13,
  opacity: 0.7,
};
const agentKindStyle: React.CSSProperties = { opacity: 0.6 };
const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  marginBottom: 8,
  borderRadius: 4,
  background: 'rgba(220, 153, 0, 0.15)',
  color: '#cc9900',
  border: '1px solid rgba(220, 153, 0, 0.4)',
  fontSize: 12,
  fontWeight: 600,
};
const chipDetailStyle: React.CSSProperties = { opacity: 0.75, fontWeight: 400 };
const rowWarningStyle: React.CSSProperties = {
  marginTop: 4,
  color: '#cc9900',
  fontSize: 12,
  fontWeight: 600,
};
const retainedSnapshotStyle: React.CSSProperties = {
  marginTop: 8,
  padding: '6px 8px',
  borderRadius: 4,
  background: 'rgba(220, 153, 0, 0.12)',
  color: '#cc9900',
  border: '1px solid rgba(220, 153, 0, 0.35)',
  fontSize: 12,
  lineHeight: 1.4,
};
// Stage R3 — resume-policy preview surface. Visually quieter than the
// health chip (which signals an active failure) so the operator reads
// it as ambient state rather than a problem.
const policyBlockStyle: React.CSSProperties = {
  margin: '4px 0 12px',
  padding: '8px 10px',
  borderRadius: 4,
  background: 'rgba(120, 130, 160, 0.08)',
  border: '1px solid rgba(120, 130, 160, 0.2)',
  fontSize: 12,
};
const policyHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontWeight: 600,
  marginBottom: 6,
  opacity: 0.85,
};
const policyDlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '4px 12px',
  margin: 0,
};
const policyRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'baseline',
};
const policyDtStyle: React.CSSProperties = {
  fontWeight: 500,
  opacity: 0.7,
  margin: 0,
};
const policyDdStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
const configChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(220, 80, 80, 0.18)',
  color: '#cc4444',
  border: '1px solid rgba(220, 80, 80, 0.4)',
  fontSize: 11,
  fontWeight: 600,
};
const configOkChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(80, 180, 110, 0.16)',
  color: '#3a9a5b',
  border: '1px solid rgba(80, 180, 110, 0.4)',
  fontSize: 11,
  fontWeight: 600,
};
const headerActionsStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
const inlineBtnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid rgba(120, 130, 160, 0.4)',
  background: 'transparent',
  cursor: 'pointer',
};
const diagListStyle: React.CSSProperties = {
  margin: '8px 0 0',
  padding: 0,
  listStyle: 'none',
  fontSize: 11,
  display: 'grid',
  gap: 3,
};
const diagItemStyle: React.CSSProperties = {
  padding: '2px 0',
  lineHeight: 1.4,
  borderTop: '1px dotted rgba(120, 130, 160, 0.25)',
};
const diagPathStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  opacity: 0.85,
};
const diagCodeStyle: React.CSSProperties = {
  opacity: 0.6,
  marginLeft: 4,
};
function diagSeverityStyle(
  severity: 'error' | 'warning' | undefined,
): React.CSSProperties {
  return {
    display: 'inline-block',
    minWidth: 52,
    fontSize: 10,
    fontWeight: 700,
    color: severity === 'warning' ? '#cc9900' : '#cc4444',
  };
}

function defaultResumeTitle(policy: NonNullable<ReturnType<typeof useSessionHistory.getState>['resumePolicy']>): string {
  const fallback =
    policy.default_mode === 'native_or_replay'
      ? ` Native fallback: ${policy.native_fallback}.`
      : '';
  return `Resume using policy default: ${policy.default_mode}.${fallback} MCP drift: ${policy.mcp_server_drift}.`;
}

function warningLabel(reason: string): string {
  if (reason === 'mcp_server_drift') return 'MCP servers changed';
  // Stage R2 — legacy persisted meta predates the `profile_class`
  // snapshot, so the bridge couldn't compare it against the live
  // profile. We surface a non-blocking notice. A class *mismatch*
  // (different from missing) is a hard failure and never reaches
  // this label path.
  if (reason === 'profile_class_missing') return 'Profile class was not recorded';
  return reason;
}
