import { useMemo, useState } from 'react';
import { authMethodSummary } from '../../domain/sessions/auth';
import { activateSessionFromReady } from '../../domain/sessions/activation';
import { useSession } from '../../stores/session';
import { ReauthAction } from '../cockpit/ReauthAction';
import type { AvailableAgent, TransportHandle } from '../../transport';
import { RegistryBrowser } from './RegistryBrowser';

/// Session-less commands (like session.create) are routed with a placeholder
/// session_id that bridge ignores; the real session_id arrives via
/// `session.ready` event. Constant makes the convention explicit.
const SESSION_CREATE_PLACEHOLDER = 'sess_pending_create';

const BUILD_WORKFLOWS = [
  { id: 'build.observe-tools', label: 'Tool Observation (default)' },
  { id: 'build.full-cockpit', label: 'Full Cockpit Build' },
  { id: 'build.approval-gated-edit', label: 'Approval-Gated Edit' },
  { id: 'build.basic', label: 'Basic Build' },
] as const;

const DEFAULT_WORKFLOW_ID = 'build.observe-tools';
// Sprint 4 (MCP pass-through): hoisted out so the JSX `style={mcpAdvertStyle}`
// reference uses single-brace form. The sandbox edit tooling strips literal
// double-brace JSX object expressions (`style="... { object } ..."`), so we
// keep the object outside JSX.
const MCP_ADVERT_STYLE: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  color: '#555',
};
const DEFAULT_PROJECT_ROOT =
  import.meta.env.VITE_VAC_WEB_DEFAULT_PROJECT_ROOT ?? '/tmp/demo-project';

export function SessionPicker({ transport }: { transport: TransportHandle }) {
  const active = useSession((s) => s.sessionId);
  const workflowName = useSession((s) => s.workflowName);
  const profileId = useSession((s) => s.profileId);
  const agentId = useSession((s) => s.agentId);
  const agentKind = useSession((s) => s.agentKind);
  const authMethods = useSession((s) => s.authMethods);
  const [profile, setProfile] = useState('executor.code@1.0.0');
  const [projectRoot, setProjectRoot] = useState(DEFAULT_PROJECT_ROOT);
  const [workflowId, setWorkflowId] = useState(DEFAULT_WORKFLOW_ID);
  // Snapshot of agents the bridge advertised in its welcome frame. We
  // resolve once per render via useMemo so a bridge restart that flips
  // the default propagates the next time SessionPicker mounts (the
  // transport itself refreshes the snapshot on every reconnect).
  const advertisedAgents: AvailableAgent[] = useMemo(
    () => transport.availableAgents?.() ?? [],
    [transport],
  );
  const defaultAgentId =
    advertisedAgents.find((a) => a.default)?.id ?? advertisedAgents[0]?.id ?? '';
  const [selectedAgentId, setSelectedAgentId] = useState<string>(defaultAgentId);
  const agentRegistryAvailable = advertisedAgents.length > 0;
  // Stage X.5e: surface the selected agent's PATH-install probe so
  // we can warn the operator before they hit Create. Older bridges
  // that pre-date the field send `installed === undefined` — treat
  // that as "unknown, don't warn" so we don't false-positive on
  // legacy deployments.
  const selectedAgent = advertisedAgents.find((a) => a.id === selectedAgentId);
  const selectedNotInstalled = selectedAgent?.installed === false;
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sprint 5: registry browser overlay. Closed by default — opening it
  // triggers `registry.sync` against the bridge so we don't pay the
  // network round-trip on every SessionPicker render.
  const [registryOpen, setRegistryOpen] = useState(false);

  const create = async () => {
    if (!agentRegistryAvailable) {
      setError('No agents advertised by bridge. Restart bridge with fixtures/agents.multi.toml.');
      return;
    }

    setCreating(true);
    setError(null);

    // Register listener BEFORE sending so we don't miss a fast session.ready.
    const off = transport.on('session.ready', (ev) => {
      if (!activateSessionFromReady(ev.payload, { profileId: profile, projectRoot })) {
        return;
      }
      off();
    });

    try {
      const payload: Record<string, unknown> = {
        profile_id: profile,
        project_root: projectRoot,
        workflow_id: workflowId,
        agent_id: selectedAgentId,
      };
      const ack = await transport.send(
        SESSION_CREATE_PLACEHOLDER,
        'session.create',
        payload,
      );
      if (!ack.ok) {
        off();
        setError(ack.error?.message ?? 'session.create failed');
      }
    } catch (e) {
      off();
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  if (active) {
    const displayName = workflowName ?? workflowId;
    return (
      <div
        style={{
          padding: 8,
          fontSize: 14,
          background: '#f7f7f7',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <strong>session:</strong> {active} · <em>{profileId ?? profile}</em> · workflow:{' '}
        {displayName}
        {agentId && (
          <span className="badge accent" style={{ padding: '1px 6px', fontSize: 10.5 }}>
            agent: {agentId}
          </span>
        )}
        {agentKind === 'acp' && (
          <span
            className="badge warn"
            style={{ padding: '1px 6px', fontSize: 10.5 }}
            title={
              authMethods.map((m) => `${m.name} (${m.type})`).join(' · ') || 'ACP auth'
            }
          >
            ACP auth: {authMethodSummary(authMethods)}
          </span>
        )}
        {agentKind === 'acp' && authMethods.length > 0 && (
          <ReauthAction transport={transport} sessionId={active} />
        )}
      </div>
    );
  }

  return (
    <section
      aria-label="Session picker"
      style={{ padding: 12, border: '1px solid #ddd' }}
    >
      <h3>Start session</h3>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Profile:
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          style={{ marginLeft: 8 }}
        >
          <option value="executor.code@1.0.0">executor.code (build)</option>
          <option value="assessor.rtd@1.0.0">assessor.rtd (read-only)</option>
          <option value="assessor.pm@1.0.0">assessor.pm (read-only)</option>
        </select>
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Workflow:
        <select
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
          style={{ marginLeft: 8 }}
        >
          {BUILD_WORKFLOWS.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
        </select>
      </label>
      {agentRegistryAvailable ? (
        <label style={{display: 'block', marginBottom: 8}}>
          Agent:
          <select
            aria-label="Agent"
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            style={{marginLeft: 8}}
          >
            {advertisedAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.default ? ' (default)' : ''}
                {a.installed === false ? ' • not installed' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div role="alert" style={{color: 'crimson', marginBottom: 8}}>
          No agents advertised by bridge. Restart bridge with fixtures/agents.multi.toml.
        </div>
      )}
      {selectedAgent && (selectedAgent.mcp_servers?.length ?? 0) > 0 && (
        // Sprint 4 (MCP pass-through): show the operator which MCP
        // servers will be wired into the ACP session for the selected
        // agent. Informational only — the bridge passes mcp_servers
        // through to `session/new` regardless of whether the cockpit
        // renders them. We deliberately keep this minimal (names only)
        // so an agent with many MCPs doesn't blow up the picker chrome.
        <div
          aria-label="MCP servers attached to agent"
          data-testid="agent-mcp-servers"
          style={MCP_ADVERT_STYLE}
        >
          <strong>MCP servers ({selectedAgent.mcp_servers?.length ?? 0}):</strong>{' '}
          {selectedAgent.mcp_servers?.map((m) => m.name).join(', ')}
        </div>
      )}
      {selectedNotInstalled && (
        // Stage X.5e: bridge says the selected agent's `command`
        // isn't on PATH. We render the operator's install_hint
        // verbatim plus a generic caveat so they know `Create
        // session` will fail with a spawn error until they
        // install/authenticate. We do NOT disable the button —
        // the spawn failure is the authoritative source of truth,
        // and the operator may have a wrapper (e.g. shim, alias)
        // we can't probe.
        <div
          role="status"
          aria-live="polite"
          data-testid="agent-install-hint"
          style={{
            marginTop: -4,
            marginBottom: 8,
            padding: 8,
            border: '1px solid #d97706',
            background: '#fff7ed',
            color: '#7c2d12',
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          <strong>{selectedAgent?.label ?? selectedAgentId}</strong> is not
          installed on this host.
          {selectedAgent?.install_hint ? ` ${selectedAgent.install_hint}` : ''}
          {' '}Starting a session will fail with a spawn error until
          the adapter binary is on PATH.
        </div>
      )}
      <p style={{fontSize: 12, color: '#666', margin: '-2px 0 8px'}}>
        Agent registry: {agentRegistryAvailable ? `${advertisedAgents.length} available` : 'unavailable'}
        {' '}
        <button
          type="button"
          onClick={() => setRegistryOpen(true)}
          data-testid="registry-open"
        >
          Browse registry
        </button>
      </p>
      {registryOpen && (
        <RegistryBrowser
          transport={transport}
          onClose={() => setRegistryOpen(false)}
        />
      )}
      <label style={{ display: 'block', marginBottom: 8 }}>
        Project root:
        <input
          type="text"
          value={projectRoot}
          onChange={(e) => setProjectRoot(e.target.value)}
          style={{ marginLeft: 8, width: '60%' }}
        />
      </label>
      <button onClick={create} disabled={creating || !agentRegistryAvailable}>
        {creating ? 'creating…' : 'Create session'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </section>
  );
}
