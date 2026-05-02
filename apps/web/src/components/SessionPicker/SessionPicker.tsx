import { lazy, Suspense, useMemo, useState } from 'react';
import { authMethodSummary } from '../../domain/sessions/auth';
import { activateSessionFromReady } from '../../domain/sessions/activation';
import { useSession } from '../../stores/session';
import { useAgentSession } from '../../stores/agentSession';
import { useTranscript } from '../../stores/transcript';
import { ReauthAction } from '../cockpit/ReauthAction';
import type { AvailableAgent, TransportHandle } from '../../transport';
// Audit P2 fix: RegistryBrowser is opened on demand from a button
// click, so we shouldn't pay its bundle cost in the eager main
// chunk. `React.lazy` splits it into its own async chunk that
// loads the first time the operator clicks "Browse registry".
const RegistryBrowser = lazy(() =>
  import('./RegistryBrowser').then((m) => ({ default: m.RegistryBrowser })),
);

/// Session-less commands (like session.create) are routed with a placeholder
/// session_id that bridge ignores; the real session_id arrives via
/// `session.ready` event. Constant makes the convention explicit.
const SESSION_CREATE_PLACEHOLDER = 'sess_pending_create';

const DEFAULT_PROJECT_ROOT = '/home/emp/Documents/VAC/vac-web';

const BUILD_WORKFLOWS = [
  { id: 'build.observe-tools', label: 'Tool Observation (default)' },
  { id: 'build.full-cockpit', label: 'Full Cockpit Build' },
  { id: 'build.approval-gated-edit', label: 'Approval-Gated Edit' },
  { id: 'build.basic', label: 'Basic Build' },
] as const;

const DEFAULT_WORKFLOW_ID = 'build.observe-tools';


function truncateForContinuation(text: string, max = 1800): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 24)}… [truncated]`;
}

function buildContinuationPrompt(args: {
  sourceSessionId: string;
  sourceAgentId: string | null;
  targetAgentId: string;
}): string {
  const agent = useAgentSession.getState();
  const turnIds = agent.turnOrder
    .filter((id) => agent.turns.get(id)?.sessionId === args.sourceSessionId)
    .slice(-4);

  const chunks = turnIds.map((id, index) => {
    const turn = agent.turns.get(id);
    if (!turn) return null;
    const assistants = turn.assistantBlockIds
      .map((blockId) => agent.assistants.get(blockId)?.content.trim())
      .filter((text): text is string => Boolean(text));
    const thoughts = turn.thinkingBlockIds
      .map((blockId) => agent.thoughts.get(blockId)?.content.trim())
      .filter((text): text is string => Boolean(text));
    const tools = turn.toolCallIds
      .map((toolId) => agent.tools.get(toolId))
      .filter(Boolean)
      .slice(0, 8)
      .map((tool) => `- ${tool?.title ?? tool?.kind ?? 'tool'} · ${tool?.status ?? 'unknown'}`);

    return [
      `Turn ${index + 1}:`,
      turn.userText ? `User: ${truncateForContinuation(turn.userText, 900)}` : 'User: (no prompt captured)',
      assistants.length > 0
        ? `Assistant: ${truncateForContinuation(assistants.join('\n'), 1400)}`
        : 'Assistant: (no assistant text captured)',
      thoughts.length > 0 ? `Visible thought summary: ${truncateForContinuation(thoughts.join('\n'), 600)}` : null,
      tools.length > 0 ? `Observed tool activity:\n${tools.join('\n')}` : null,
    ].filter(Boolean).join('\n');
  }).filter(Boolean);

  const transcript = useTranscript.getState();
  const transcriptFallback = transcript.order
    .slice(-8)
    .map((id) => transcript.messages.get(id))
    .filter(Boolean)
    .map((item) => `${item?.role}: ${truncateForContinuation(item?.content ?? '', 700)}`)
    .join('\n');

  const context = chunks.length > 0
    ? chunks.join('\n\n')
    : (transcriptFallback || 'No structured transcript was available in the frontend store. Ask clarifying questions only if essential.');

  return [
    'Continue this VAC Web work in a new CLI agent session.',
    '',
    `Source VAC session: ${args.sourceSessionId}`,
    `Source agent: ${args.sourceAgentId ?? 'unknown'}`,
    `Target agent: ${args.targetAgentId}`,
    '',
    'Important semantics:',
    '- This is a cross-agent continuation, not native same-provider ACP session import.',
    '- Preserve the project context and continue from the summarized state below.',
    '- Re-audit files before editing when facts may have changed.',
    '- Keep actions visible in VAC with tool, diff, terminal, and plan events whenever your adapter supports them.',
    '',
    'Recent context:',
    context,
    '',
    'Continue from here and state any capability limits you observe in this new agent session.',
  ].join('\n');
}
// Sprint 4 (MCP pass-through): hoisted out so the JSX `style={mcpAdvertStyle}`
// reference uses single-brace form. The sandbox edit tooling strips literal
// double-brace JSX object expressions (`style="... { object } ..."`), so we
// keep the object outside JSX.
export function SessionPicker({ transport }: { transport: TransportHandle }) {
  const active = useSession((s) => s.sessionId);
  const workflowName = useSession((s) => s.workflowName);
  const activeWorkflowId = useSession((s) => s.workflowId);
  const profileId = useSession((s) => s.profileId);
  const activeProjectRoot = useSession((s) => s.projectRoot);
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
  const [continuationAgentId, setContinuationAgentId] = useState<string>(defaultAgentId);
  const agentRegistryAvailable = advertisedAgents.length > 0;
  // Stage X.5e: surface the selected agent's PATH-install probe so
  // we can warn the operator before they hit Create. Older bridges
  // that pre-date the field send `installed === undefined` — treat
  // that as "unknown, don't warn" so we don't false-positive on
  // legacy deployments.
  const selectedAgent = advertisedAgents.find((a) => a.id === selectedAgentId);
  const selectedNotInstalled = selectedAgent?.installed === false;
  const [creating, setCreating] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
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


  const continueWithAgent = async () => {
    if (!active) return;
    const targetAgentId = continuationAgentId || defaultAgentId || selectedAgentId;
    if (!targetAgentId) {
      setContinueError('Choose a target agent first.');
      return;
    }
    if (targetAgentId === agentId) {
      setContinueError('Choose a different agent to continue this work in another CLI tool.');
      return;
    }

    const sourceSessionId = active;
    const continuationPrompt = buildContinuationPrompt({
      sourceSessionId,
      sourceAgentId: agentId,
      targetAgentId,
    });

    setContinuing(true);
    setContinueError(null);

    let off: () => void = () => undefined;
    let timer: number | null = null;
    try {
      const readyPromise = new Promise<string>((resolve, reject) => {
        timer = window.setTimeout(() => {
          off();
          reject(new Error('Timed out waiting for session.ready from target agent.'));
        }, 15_000);
        off = transport.on('session.ready', (ev) => {
          const sid = activateSessionFromReady(ev.payload, {
            profileId: profileId ?? profile,
            projectRoot: activeProjectRoot ?? projectRoot,
          });
          if (!sid) return;
          if (timer !== null) window.clearTimeout(timer);
          off();
          resolve(sid);
        });
      });

      const ack = await transport.send(SESSION_CREATE_PLACEHOLDER, 'session.create', {
        profile_id: profileId ?? profile,
        project_root: activeProjectRoot ?? projectRoot,
        workflow_id: activeWorkflowId ?? workflowId,
        agent_id: targetAgentId,
        continuation_of: sourceSessionId,
      });
      if (!ack.ok) {
        if (timer !== null) window.clearTimeout(timer);
        off();
        throw new Error(ack.error?.message ?? 'session.create failed');
      }

      const newSessionId = await readyPromise;
      const localId = `usr_cont_${Math.random().toString(36).slice(2, 10)}`;
      useTranscript.getState().upsert({
        id: localId,
        role: 'user',
        content: continuationPrompt,
        state: 'completed',
        createdAt: new Date().toISOString(),
      });
      useAgentSession.getState().beginTurn({
        sessionId: newSessionId,
        userText: continuationPrompt,
        provider: targetAgentId,
      });
      const submitAck = await transport.send(newSessionId, 'message.submit', {
        text: continuationPrompt,
        attachments: [],
        mentions: [],
      });
      if (!submitAck.ok) {
        useAgentSession.getState().failActiveTurn(newSessionId);
        throw new Error(submitAck.error?.message ?? 'message.submit failed');
      }
    } catch (err) {
      off();
      if (timer !== null) window.clearTimeout(timer);
      setContinueError(err instanceof Error ? err.message : String(err));
    } finally {
      setContinuing(false);
    }
  };

  if (active) {
    const displayName = workflowName ?? workflowId;
    return (
      <div className="session-active-wrap">
        <div className="session-active-card">
          <strong>session:</strong> {active} · <em>{profileId ?? profile}</em> · workflow:{' '}
          {displayName}
          {agentId && (
            <span className="badge accent rail-badge-tight">
              agent: {agentId}
            </span>
          )}
          {agentKind === 'acp' && (
            <span
              className="badge warn rail-badge-tight"
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
        {agentRegistryAvailable && advertisedAgents.length > 1 && (
          <div className="session-continue-card" data-testid="cross-agent-continuation">
            <div className="session-continue-copy">
              <strong>Continue with another CLI agent</strong>
              <span>
                Starts a new VAC session with carried context. Native same-session import across Gemini/Codex/Claude is provider-dependent.
              </span>
            </div>
            <select
              aria-label="Continuation target agent"
              value={continuationAgentId || defaultAgentId}
              onChange={(e) => setContinuationAgentId(e.target.value)}
            >
              {advertisedAgents.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === agentId || a.installed === false}>
                  {a.label}{a.id === agentId ? ' (current)' : ''}{a.installed === false ? ' • not installed' : ''}
                </option>
              ))}
            </select>
            <button
              className="btn primary"
              type="button"
              onClick={() => void continueWithAgent()}
              disabled={continuing || !continuationAgentId || continuationAgentId === agentId}
            >
              {continuing ? 'Continuing…' : 'Continue in selected agent'}
            </button>
            {continueError && <div className="session-picker-error">{continueError}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Session picker" className="screen-shell">
      <header className="screen-hero">
        <div className="screen-hero-row">
          <div>
            <h3 className="screen-title">Start session</h3>
            <div className="screen-subtitle">Choose the execution profile, workflow, agent, and project root before opening a local session.</div>
          </div>
          <span className="badge">{agentRegistryAvailable ? `${advertisedAgents.length} agents` : 'registry unavailable'}</span>
        </div>
      </header>
      <div className="panel-card panel-card-pad session-picker-form">
      <label>
        Profile:
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        >
          <option value="executor.code@1.0.0">executor.code (build)</option>
          <option value="assessor.rtd@1.0.0">assessor.rtd (read-only)</option>
          <option value="assessor.pm@1.0.0">assessor.pm (read-only)</option>
        </select>
      </label>
      <label>
        Workflow:
        <select
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
        >
          {BUILD_WORKFLOWS.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
        </select>
      </label>
      {agentRegistryAvailable ? (
        <label>
          Agent:
          <select
            aria-label="Agent"
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
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
        <div role="alert" className="session-picker-error">
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
          className="session-picker-mcp"
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
          className="session-picker-alert"
        >
          <strong>{selectedAgent?.label ?? selectedAgentId}</strong> is not
          installed on this host.
          {selectedAgent?.install_hint ? ` ${selectedAgent.install_hint}` : ''}
          {' '}Starting a session will fail with a spawn error until
          the adapter binary is on PATH.
        </div>
      )}
      <div className="session-picker-meta">
        Agent registry: {agentRegistryAvailable ? `${advertisedAgents.length} available` : 'unavailable'}
        {' '}
        <button
          type="button"
          onClick={() => setRegistryOpen(true)}
          data-testid="registry-open"
        >
          Browse registry
        </button>
      </div>
      {registryOpen && (
        <Suspense fallback={null}>
          <RegistryBrowser
            transport={transport}
            onClose={() => setRegistryOpen(false)}
          />
        </Suspense>
      )}
      <label>
        Project root:
        <input
          type="text"
          value={projectRoot}
          onChange={(e) => setProjectRoot(e.target.value)}
        />
      </label>
      <div className="screen-actions">
        <button className="btn primary" onClick={create} disabled={creating || !agentRegistryAvailable}>
        {creating ? 'creating…' : 'Create session'}
        </button>
      </div>
      {error && <div className="session-picker-error">{error}</div>}
      </div>
    </section>
  );
}
