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
    <div style={{ borderTop: '1px solid #eee', padding: 8 }}>
      {attachments.length > 0 && (
        <ul
          aria-label="Attachments"
          style={{ listStyle: 'none', padding: 0, margin: '0 0 6px 0', display: 'flex', gap: 4, flexWrap: 'wrap' }}
        >
          {attachments.map((a) => (
            <li
              key={a.id}
              style={{
                fontSize: 12,
                background: 'var(--bg-2, #222)',
                padding: '2px 6px',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{a.label}</span>
              <button
                onClick={() => useAttachments.getState().remove(a.id)}
                aria-label={`Remove ${a.label}`}
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
        {pickerOpen && mentionQuery && (
          <MentionPicker transport={transport} query={mentionQuery} onClose={() => setPickerOpen(false)} />
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={submitting || !sessionId}
          placeholder={sessionId ? 'Type a prompt… (Enter to send, @ to mention)' : 'No active session'}
          rows={2}
          style={{ flex: 1, resize: 'vertical', padding: 8, fontFamily: 'inherit' }}
        />
        <button onClick={submit} disabled={submitting || !text.trim() || !sessionId}>
          {submitting ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
