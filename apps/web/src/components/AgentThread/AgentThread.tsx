import { useMemo, useState } from 'react';
import {
  agentDiffKey,
  agentTerminalKey,
  selectAgentTurns,
  useAgentSession,
  type AgentDebugMessage,
  type AgentDiff,
  type AgentPlanEntry,
  type AgentTelemetry,
  type AgentThreadItem,
  type AgentToolCall,
  type AgentToolStatus,
  type AgentTurn,
} from '../../stores/agentSession';
import { useSession } from '../../stores/session';
import '../../styles/transcript.css';

const TERMINAL_PREVIEW_LIMIT = 500;
const EMPTY_DEBUG_MESSAGES: AgentDebugMessage[] = [];
const EMPTY_DISCRIMINATORS: Record<string, number> = {};

type ProviderMeta = { label: string; shortLabel: string };

function providerMeta(provider: string | null | undefined): ProviderMeta {
  if (provider === 'gemini-acp') return { label: 'Gemini CLI ACP', shortLabel: 'Gemini' };
  if (provider === 'claude-acp') return { label: 'Claude Agent ACP', shortLabel: 'Claude' };
  if (provider) return { label: provider, shortLabel: provider };
  return { label: 'ACP provider', shortLabel: 'Agent' };
}

function statusLabel(status: AgentToolStatus): string {
  if (status === 'in_progress') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function statusClass(status: AgentToolStatus): string {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'in_progress') return 'running';
  return 'pending';
}

function turnStatusClass(status: AgentTurn['status']): string {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'streaming' || status === 'working') return 'running';
  return 'pending';
}

function elapsedLabel(turn: AgentTurn): string | null {
  const end = turn.completedAt ?? (turn.status === 'working' || turn.status === 'streaming' ? new Date().toISOString() : null);
  if (!end) return null;
  const elapsedMs = Date.parse(end) - Date.parse(turn.startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return `${seconds}s`;
}

function safeTerminalPreview(raw: string | null): { text: string | null; truncated: boolean; redacted: boolean } {
  if (!raw) return { text: null, truncated: false, redacted: false };
  let text = raw
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '<REDACTED-SECRET>')
    .replace(/(Authorization:\s*Bearer\s+)[^\s'"`]+/gi, '$1<REDACTED-SECRET>')
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|KEY)[A-Z0-9_]*=)[^\s]+/gi, '$1<REDACTED-SECRET>');
  const redacted = text.includes('<REDACTED-SECRET>');
  const truncated = text.length > TERMINAL_PREVIEW_LIMIT;
  if (truncated) text = `${text.slice(0, TERMINAL_PREVIEW_LIMIT)}…`;
  return { text, truncated, redacted };
}

function richSeen(telemetry: AgentTelemetry | undefined, kind: 'message' | 'thought' | 'tool' | 'plan'): string {
  return telemetry && telemetry.eventCounts[kind] > 0 ? '✓' : '–';
}

function DiffPreview({ diff }: { diff: AgentDiff }) {
  const oldLine = diff.old_text?.split('\n').find((line) => line.length > 0) ?? '';
  const newLine = diff.new_text?.split('\n').find((line) => line.length > 0) ?? '';
  return (
    <div className="agent-diff-preview">
      <div className="agent-path">{diff.path}</div>
      {oldLine && <div className="agent-diff-line removed">- {oldLine}</div>}
      {newLine && <div className="agent-diff-line added">+ {newLine}</div>}
    </div>
  );
}

export function ThinkingBlock({ content, active = false }: { content: string; active?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <details className="agent-card thinking" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {active ? 'Thinking…' : `Thinking ${open ? 'expanded' : 'collapsed'}`}
      </summary>
      <div className="agent-card-body">{content}</div>
    </details>
  );
}

export function DiffCard({ toolCallId, sessionId }: { toolCallId: string; sessionId: string }) {
  const diff = useAgentSession((s) => s.diffs.get(agentDiffKey(sessionId, toolCallId)));
  if (!diff || diff.diffs.length === 0) return null;
  return (
    <div className="agent-card nested" aria-label="Diff update">
      <div className="agent-card-title">Diff update</div>
      {diff.diffs.map((d) => <DiffPreview key={d.path} diff={d} />)}
    </div>
  );
}

export function TerminalCard({ toolCallId, sessionId }: { toolCallId: string; sessionId: string }) {
  const terminal = useAgentSession((s) => s.terminals.get(agentTerminalKey(sessionId, toolCallId)));
  const preview = useMemo(() => safeTerminalPreview(terminal?.rawOutputRedacted ?? null), [terminal?.rawOutputRedacted]);
  if (!terminal || !preview.text) return null;
  return (
    <div className="agent-card nested" aria-label="Terminal output">
      <div className="agent-card-title">Terminal output</div>
      <pre className="agent-terminal-output">{preview.text}</pre>
      <div className="agent-card-meta">
        {preview.redacted && <span>redacted</span>}
        {preview.truncated && <span>truncated</span>}
      </div>
    </div>
  );
}

export function ToolCallCard({ tool }: { tool: AgentToolCall }) {
  const primaryPath = tool.locations[0]?.path ?? null;
  return (
    <details className="agent-card tool" aria-label={`Tool call ${tool.toolCallId}`} open={tool.status === 'in_progress'}>
      <summary className="agent-card-title">
        <span>Tool call</span>
        <span className="agent-tool-lifecycle">
          <span className={tool.status === 'pending' ? 'active' : ''}>queued</span>
          <span>→</span>
          <span className={tool.status === 'in_progress' ? 'active' : ''}>running</span>
          <span>→</span>
          <span className={tool.status === 'completed' ? 'active ok' : tool.status === 'failed' ? 'active error' : ''}>
            {tool.status === 'failed' ? 'failed' : 'succeeded'}
          </span>
        </span>
        <span className={`agent-status ${statusClass(tool.status)}`}>{statusLabel(tool.status)}</span>
      </summary>
      <div className="agent-tool-main">
        <strong>{tool.title ?? tool.kind}</strong>
        <span>{tool.kind}</span>
      </div>
      {primaryPath && <div className="agent-path">{primaryPath}</div>}
      <DiffCard sessionId={tool.sessionId} toolCallId={tool.toolCallId} />
      <TerminalCard sessionId={tool.sessionId} toolCallId={tool.toolCallId} />
    </details>
  );
}

export function PlanCard({ entries }: { entries: AgentPlanEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="agent-card plan" aria-label="Agent plan">
      <div className="agent-card-title">Plan</div>
      <ul className="agent-plan-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className={`agent-plan-dot ${entry.status}`} aria-hidden="true" />
            <span>{entry.title}</span>
            <span className="agent-card-meta">{entry.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentTelemetryBadge({ sessionId, provider }: { sessionId: string; provider: string | null }) {
  const telemetry = useAgentSession((s) => s.telemetry.get(sessionId));
  const meta = providerMeta(telemetry?.providerId ?? provider);
  const counts = telemetry?.eventCounts;
  return (
    <div className="agent-telemetry" aria-label="Provider rich event telemetry">
      <span className={`agent-status ${turnStatusClass(telemetry?.promptStatus ?? 'idle')}`}>
        {meta.shortLabel} · {telemetry?.promptStatus ?? 'idle'}
      </span>
      <span>{counts?.message ?? 0} deltas</span>
      <span>{counts?.tool ?? 0} tools</span>
      <span>{counts?.thought ?? 0} thoughts</span>
      <span>{counts?.plan ?? 0} plans</span>
      <span>
        Rich events: message {richSeen(telemetry, 'message')} thought {richSeen(telemetry, 'thought')} tool {richSeen(telemetry, 'tool')} plan {richSeen(telemetry, 'plan')}
      </span>
    </div>
  );
}

function AcpDebugPanel({ sessionId }: { sessionId: string }) {
  const debugMessages = useAgentSession((s) => s.telemetry.get(sessionId)?.debugMessages ?? EMPTY_DEBUG_MESSAGES);
  const discriminators = useAgentSession((s) => s.telemetry.get(sessionId)?.discriminators ?? EMPTY_DISCRIMINATORS);
  if (debugMessages.length === 0 && Object.keys(discriminators).length === 0) return null;
  return (
    <details className="agent-card debug" aria-label="ACP Debug">
      <summary>ACP Debug</summary>
      <div className="agent-debug-grid">
        <div>
          <strong>session/update discriminators</strong>
          {Object.keys(discriminators).length === 0 ? (
            <div className="agent-card-meta">none seen</div>
          ) : (
            <ul>
              {Object.entries(discriminators).map(([disc, count]) => (
                <li key={disc}>{disc}: {count}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <strong>wire messages</strong>
          <ul>
            {debugMessages.slice(-12).map((msg) => <AcpDebugRow key={msg.id} message={msg} />)}
          </ul>
        </div>
      </div>
    </details>
  );
}

function AcpDebugRow({ message }: { message: AgentDebugMessage }) {
  return (
    <li className="agent-debug-row">
      <span>{message.direction ?? 'unknown'}</span>
      <span>{message.method ?? message.messageType ?? 'message'}</span>
      {message.discriminator && <span>{message.discriminator}</span>}
      {message.paramsPreview && <span className="agent-debug-preview">{message.paramsPreview}</span>}
      {message.paramsHash && <span className="agent-card-meta">{message.paramsHash.slice(0, 10)}</span>}
    </li>
  );
}

function AgentTurnCard({ turn }: { turn: AgentTurn }) {
  const assistantsById = useAgentSession((s) => s.assistants);
  const thoughtsById = useAgentSession((s) => s.thoughts);
  const toolsById = useAgentSession((s) => s.tools);
  const plan = useAgentSession((s) => (turn.planId ? s.plans.get(turn.planId) : null));
  const assistants = useMemo(
    () => turn.assistantBlockIds.map((id) => assistantsById.get(id)).filter(Boolean),
    [assistantsById, turn.assistantBlockIds],
  );
  const thoughts = useMemo(
    () => turn.thinkingBlockIds.map((id) => thoughtsById.get(id)).filter(Boolean),
    [thoughtsById, turn.thinkingBlockIds],
  );
  const tools = useMemo(
    () => turn.toolCallIds.map((id) => toolsById.get(id)).filter(Boolean),
    [toolsById, turn.toolCallIds],
  );
  const meta = providerMeta(turn.provider);
  const isActive = turn.status === 'working' || turn.status === 'streaming';
  const emptyResponse = assistants.length === 0 && thoughts.length === 0 && tools.length === 0 && !plan;
  const elapsed = elapsedLabel(turn);

  return (
    <article className={`agent-turn ${isActive ? 'active' : ''}`} aria-label="Agent turn">
      <div className="agent-turn-rail" aria-hidden="true" />
      <div className="agent-turn-body">
        <div className="agent-turn-header">
          <span>{meta.label}</span>
          <span className={`agent-status ${turnStatusClass(turn.status)}`}>{turn.status}</span>
          {elapsed && <span className="agent-card-meta">{elapsed}</span>}
        </div>
        {turn.userText && <div className="agent-user-prompt">{turn.userText}</div>}
        {emptyResponse && isActive && (
          <div className="agent-message pending">{meta.shortLabel} is working…</div>
        )}
        {thoughts.map((thought) => (
          <ThinkingBlock key={thought!.id} content={thought!.content} active={isActive} />
        ))}
        {assistants.map((assistant) => (
          <div key={assistant!.id} className={`agent-message ${isActive ? 'streaming' : ''}`}>
            {assistant!.content}
            {isActive && <span className="streaming-cursor">▍</span>}
          </div>
        ))}
        {plan && <PlanCard entries={plan.entries} />}
        {tools.map((tool) => <ToolCallCard key={tool!.id} tool={tool!} />)}
      </div>
    </article>
  );
}

function AgentThreadItemRow({ item }: { item: AgentThreadItem }) {
  const assistant = useAgentSession((s) => s.assistants.get(item.refId));
  const thought = useAgentSession((s) => s.thoughts.get(item.refId));
  const tool = useAgentSession((s) => s.tools.get(item.refId));
  const plan = useAgentSession((s) => s.plans.get(item.refId));

  if (item.kind === 'assistant' && assistant?.content) {
    return <div className="agent-message">{assistant.content}</div>;
  }
  if (item.kind === 'thought' && thought?.content) {
    return <ThinkingBlock content={thought.content} />;
  }
  if (item.kind === 'tool' && tool) {
    return <ToolCallCard tool={tool} />;
  }
  if (item.kind === 'plan' && plan) {
    return <PlanCard entries={plan.entries} />;
  }
  return null;
}

export function AgentThread({ sessionId }: { sessionId?: string | null }) {
  const currentSession = useSession((s) => s.sessionId);
  const provider = useSession((s) => s.agentId);
  const sid = sessionId ?? currentSession;
  const order = useAgentSession((s) => s.order);
  const itemsById = useAgentSession((s) => s.items);
  const turnsState = useAgentSession((s) => s.turns);
  const turnOrder = useAgentSession((s) => s.turnOrder);
  const telemetry = useAgentSession((s) => (sid ? s.telemetry.get(sid) : undefined));
  const turns = useMemo(() => selectAgentTurns(sid), [sid, turnsState, turnOrder]);
  const items = useMemo(() => {
    if (!sid) return [];
    const prefix = `${sid}\x00`;
    return order
      .filter((id) => id.startsWith(prefix))
      .map((id) => itemsById.get(id))
      .filter((item): item is AgentThreadItem => item != null);
  }, [itemsById, order, sid]);

  if (!sid || (turns.length === 0 && items.length === 0 && !telemetry)) return null;

  return (
    <section className="agent-thread" aria-label="Rich agent thread">
      <div className="agent-thread-header">
        <span>Rich agent session</span>
        <AgentTelemetryBadge sessionId={sid} provider={provider} />
      </div>
      {turns.length > 0 ? turns.map((turn) => <AgentTurnCard key={turn.id} turn={turn} />) : items.map((item) => <AgentThreadItemRow key={item.id} item={item} />)}
      <AcpDebugPanel sessionId={sid} />
    </section>
  );
}
