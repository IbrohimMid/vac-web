import { useEffect, useState } from 'react';
import { renderMarkdownAsync } from '../../markdown/async';
import { renderStreaming } from '../../markdown/streaming';
import { useTranscript } from '../../stores/transcript';
import { ColdMessage } from './ColdMessage';
import { ToolCallBlock } from './ToolCallBlock';
import { Icon, Avatar } from '../cockpit/primitives';

export function MessageRow({ id }: { id: string }) {
  const msg = useTranscript((s) => s.messages.get(id));
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!msg) return;
    if (msg.state !== 'completed') {
      setHtml(null);
      return;
    }
    let cancelled = false;
    void renderMarkdownAsync(id, msg.content).then((h) => {
      if (!cancelled) setHtml(h);
    });
    return () => {
      cancelled = true;
    };
  }, [id, msg?.state, msg?.content]);

  if (!msg) return null;

  if (msg.isCold) {
    return <ColdMessage id={id} />;
  }

  const timeString = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const authorName = msg.role === 'user' ? 'You' : 'VAC - Planner';

  return (
    <div
      className={`message-wrapper role-${msg.role}`}
      data-msg-id={id}
    >
      <div className="message-avatar-col">
        {msg.role === 'user' ? (
          <Avatar name="You" />
        ) : (
          <div className="avatar-bot-bg">
            <Icon name="bot" size={16} />
          </div>
        )}
      </div>
      <div className="message-content-col">
        <header className="message-header">
          <strong className="message-author">{authorName}</strong>
          <span className="message-time">{timeString}</span>
          {msg.state === 'error' && (
            <em className="message-status status-error">error: {msg.error}</em>
          )}
        </header>
        {msg.state === 'completed' && html !== null ? (
          <div className="message-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        ) : msg.state === 'completed' && html === null ? (
          <div className="message-body placeholder">rendering…</div>
        ) : (
          <div className="message-body raw-content">
            {renderStreaming(msg.content)}
            {msg.state === 'streaming' && <span className="streaming-cursor">▍</span>}
          </div>
        )}
        {msg.toolCall && <ToolCallBlock tc={msg.toolCall} />}
      </div>
    </div>
  );
}
