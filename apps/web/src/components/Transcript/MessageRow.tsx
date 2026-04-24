import { useEffect, useState } from 'react';
import { renderMarkdownAsync } from '../../markdown/async';
import { renderStreaming } from '../../markdown/streaming';
import { useTranscript } from '../../stores/transcript';
import { ColdMessage } from './ColdMessage';

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

  return (
    <div
      className={`message message-${msg.role}`}
      data-msg-id={id}
      style={{
        padding: 8,
        borderBottom: '1px solid #eee',
      }}
    >
      <header style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
        <strong>{msg.role}</strong>
        {msg.state === 'streaming' && <em style={{ marginLeft: 8 }}>streaming…</em>}
        {msg.state === 'error' && (
          <em style={{ marginLeft: 8, color: 'crimson' }}>error: {msg.error}</em>
        )}
      </header>
      {msg.state === 'completed' && html !== null ? (
        <div className="message-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : msg.state === 'completed' && html === null ? (
        <div style={{ opacity: 0.5 }}>rendering…</div>
      ) : (
        <div className="message-body" style={{ whiteSpace: 'pre-wrap' }}>
          {renderStreaming(msg.content)}
          {msg.state === 'streaming' && <span style={{ opacity: 0.5 }}>▍</span>}
        </div>
      )}
    </div>
  );
}
