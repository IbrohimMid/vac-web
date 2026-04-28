import { useMemo, useState } from 'react';
import {
  agentDiffKey,
  agentTerminalKey,
  useAgentSession,
  type AgentDiff,
  type AgentPlanEntry,
  type AgentThreadItem,
  type AgentToolCall,
  type AgentToolStatus,
} from '../../stores/agentSession';
import { useSession } from '../../stores/session';
import '../../styles/transcript.css';

const TERMINAL_PREVIEW_LIMIT = 500;

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

export function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="agent-card thinking" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Thinking {open ? 'expanded' : 'collapsed'}
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
    <div className="agent-card tool" aria-label={`Tool call ${tool.toolCallId}`}>
      <div className="agent-card-title">
        <span>Tool call</span>
        <span className={`agent-status ${statusClass(tool.status)}`}>{statusLabel(tool.status)}</span>
      </div>
      <div className="agent-tool-main">
        <strong>{tool.title ?? tool.kind}</strong>
        <span>{tool.kind}</span>
      </div>
      {primaryPath && <div className="agent-path">{primaryPath}</div>}
      <DiffCard sessionId={tool.sessionId} toolCallId={tool.toolCallId} />
      <TerminalCard sessionId={tool.sessionId} toolCallId={tool.toolCallId} />
    </div>
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
  const sid = sessionId ?? currentSession;
  const order = useAgentSession((s) => s.order);
  const itemsById = useAgentSession((s) => s.items);
  const items = useMemo(() => {
    if (!sid) return [];
    const prefix = `${sid}\x00`;
    return order
      .filter((id) => id.startsWith(prefix))
      .map((id) => itemsById.get(id))
      .filter((item): item is AgentThreadItem => item != null);
  }, [itemsById, order, sid]);

  if (!sid || items.length === 0) return null;

  return (
    <section className="agent-thread" aria-label="Rich agent thread">
      <div className="agent-thread-header">Rich agent session</div>
      {items.map((item) => <AgentThreadItemRow key={item.id} item={item} />)}
    </section>
  );
}
