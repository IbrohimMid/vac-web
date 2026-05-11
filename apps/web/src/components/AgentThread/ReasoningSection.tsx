import type { AgentTextBlock } from '../../stores/agentSession';

export function ReasoningSection({ thoughts, active = false }: { thoughts: AgentTextBlock[]; active?: boolean }) {
  const content = thoughts.map((thought) => thought.content).filter(Boolean).join('\n\n');
  if (!content) return null;
  return (
    <details className="agent-card reasoning" data-testid="agent-reasoning-section">
      <summary className="agent-card-title">
        <span>{active ? 'Reasoning…' : 'Reasoning'}</span>
        <span className="agent-card-meta">Collapsed · inspect trace</span>
      </summary>
      <div className="agent-card-body">{content}</div>
    </details>
  );
}
