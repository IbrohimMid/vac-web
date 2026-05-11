import { useMemo } from 'react';
import type { AgentTextBlock } from '../../stores/agentSession';
import { renderMarkdown } from '../../markdown/full';

export function FinalAnswerBlock({
  assistants,
  active = false,
  onCopy,
}: {
  assistants: AgentTextBlock[];
  active?: boolean;
  onCopy?: (text: string) => void | Promise<void>;
}) {
  const content = assistants.map((assistant) => assistant.content).filter(Boolean).join('\n\n');
  const html = useMemo(() => renderMarkdown(content), [content]);
  if (!content && !active) return null;
  return (
    <div
      className={`agent-message final-answer markdown-body ${active ? 'streaming' : ''}`}
      data-testid="agent-final-answer"
      aria-label="Final assistant answer"
    >
      {content ? <div dangerouslySetInnerHTML={{__html: html}} /> : <span className="agent-card-meta">Waiting for final answer…</span>}
      {active && <span className="streaming-cursor">▍</span>}
      {!active && content && (
        <div className="agent-card-actions" role="group" aria-label="Assistant actions">
          <button
            type="button"
            className="agent-action"
            onClick={() => { if (onCopy) void onCopy(content); }}
            title="Copy assistant response to clipboard"
          >
            Copy response
          </button>
        </div>
      )}
    </div>
  );
}
