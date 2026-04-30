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

  useEffect(() => {
    if (!transport) return;
    void requestHistoryList(transport, { limit: 50 });
    // Stage R3 — fetch the policy on mount so the preview block is
    // populated before the user opens the persistent sessions panel.
    // The bridge's reply is a `config.validated` ServerEvent that the
    // history domain handler already routes into the store.
    void requestResumePolicy(transport);
  }, [transport]);

  const policyChip = configDiagnostics.length > 0 ? (
    <div
      role="alert"
      aria-label="Resume policy config invalid"
      title={configDiagnostics.map((d) => `${d.path}: ${d.message}`).join('\n')}
      style={configChipStyle}
    >
      ⚠️ Config invalid
      <span style={chipDetailStyle}> ({configDiagnostics.length})</span>
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
    </dl>
  ) : null;

  const policyBlock = (resumePolicy || policyChip) ? (
    <section aria-label="Resume policy" style={policyBlockStyle}>
      <header style={policyHeaderStyle}>
        <span>Resume policy</span>
        {policyChip}
      </header>
      {policyPreview}
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
            const replayLabel = busy
              ? resume.kind === 'replaying'
                ? `Replaying${
                    'replayed' in resume && resume.replayed > 0 ? ` (${resume.replayed})` : '\u2026'
                  }`
                : 'Resuming\u2026'
              : 'Resume (replay)';
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
