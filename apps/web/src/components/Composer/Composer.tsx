import { useEffect, useMemo, useState } from 'react';
import { MentionPicker } from './MentionPicker';
import { useAttachments } from '../../stores/attachments';
import { useComposer } from '../../stores/composer';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { useTranscript } from '../../stores/transcript';

export function Composer({ transport }: { transport: TransportHandle }) {
  const { text, submitting, setText, setSubmitting, reset } = useComposer();
  const sessionId = useSession((s) => s.sessionId);
  const attachments = useAttachments((s) => s.items);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Derive active @-query from the last token after `@`. Auto-close when the
  // `@` disappears (backspaced) or a whitespace breaks the mention.
  const mentionQuery = useMemo(() => {
    if (!pickerOpen) return '';
    const i = text.lastIndexOf('@');
    if (i < 0) return '';
    const tail = text.slice(i + 1);
    if (/\s/.test(tail)) return '';
    return tail;
  }, [text, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    if (!text.includes('@')) setPickerOpen(false);
  }, [text, pickerOpen]);

  const submit = async () => {
    if (!sessionId || submitting || !text.trim()) return;
    setSubmitting(true);
    try {
      const localId = 'usr_' + Math.random().toString(36).slice(2, 10);
      useTranscript.getState().upsert({
        id: localId,
        role: 'user',
        content: text,
        state: 'completed',
        createdAt: new Date().toISOString(),
      });
      const ack = await transport.send(sessionId, 'message.submit', {
        text,
        attachments: attachments.map((a) => ({ kind: a.kind, label: a.label, payload: a.payload })),
      });
      if (!ack.ok) {
        console.error('submit failed', ack.error);
      }
      reset();
      useAttachments.getState().clear();
    } finally {
      setSubmitting(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === '@') {
      setPickerOpen(true);
    } else if (e.key === 'Enter' && !e.shiftKey && !pickerOpen) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        {attachments.length > 0 && (
          <ul
            aria-label="Attachments"
            className="composer-chips"
            style={{ listStyle: 'none', margin: 0 }}
          >
            {attachments.map((a) => (
              <li key={a.id} className="context-chip">
                <span>{a.label}</span>
                <button
                  onClick={() => useAttachments.getState().remove(a.id)}
                  aria-label={`Remove ${a.label}`}
                  className="x"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: 4,
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ position: 'relative' }}>
          {pickerOpen && mentionQuery && (
            <MentionPicker
              transport={transport}
              query={mentionQuery}
              onClose={() => setPickerOpen(false)}
            />
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            disabled={submitting || !sessionId}
            placeholder={
              sessionId
                ? 'Ask, plan, or run a slash command…  type / for actions, @ to mention'
                : 'No active session'
            }
            rows={3}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--ink)',
              padding: '12px 14px 6px',
              resize: 'vertical',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-body)',
              minHeight: 56,
            }}
          />
        </div>
        <div className="composer-foot">
          <div className="left">
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              Enter to send · Shift+Enter newline · @ to mention
            </span>
          </div>
          <div className="right">
            {sessionId && (
              <span
                className="badge"
                style={{ fontSize: 11, padding: '2px 6px' }}
              >
                {sessionId.slice(0, 12)}
              </span>
            )}
            <button
              onClick={submit}
              disabled={submitting || !text.trim() || !sessionId}
              className="btn primary"
              style={{
                fontSize: 12,
                padding: '6px 12px',
                opacity: submitting || !text.trim() || !sessionId ? 0.5 : 1,
              }}
            >
              {submitting ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
