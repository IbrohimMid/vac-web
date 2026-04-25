// Composer — Stage I.
// Default path: textarea (preserved from Phase 6, fully functional, IME-safe
// because the browser owns the textbox).
// Experimental path: contentEditable + slash palette + inline mention chips,
// gated behind `localStorage['vac.composer.experimental'] === '1'`.
//
// Both paths converge on the same submit contract:
//   message.submit { text, attachments, mentions }
//
// `mentions` is `[]` for textarea mode (mentions are emitted as `attachments`
// there). Server side accepts an empty array; tests lock this shape.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ContentEditable, buildMentionChip, type ContentEditableHandle } from './ContentEditable';
import { MentionPicker } from './MentionPicker';
import { SlashPalette } from './SlashPalette';
import { markUsed } from '../../actions/recency';
import type { ActionSpec } from '../../actions/registry';
import { useAttachments } from '../../stores/attachments';
import { useComposer } from '../../stores/composer';
import { useSession } from '../../stores/session';
import { useTranscript } from '../../stores/transcript';
import type { TransportHandle } from '../../transport';
import { serialize, type MentionRef } from '../../composer/serialize';
import { matchTrigger } from '../../composer/triggers';

const EXPERIMENTAL_KEY = 'vac.composer.experimental';

function readExperimentalFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(EXPERIMENTAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function Composer({ transport }: { transport: TransportHandle }) {
  // Read once on mount; flipping the flag requires a reload (acceptable for
  // an experimental toggle, and avoids resetting in-flight composer state).
  const [experimental] = useState(readExperimentalFlag);
  return experimental ? (
    <ExperimentalComposer transport={transport} />
  ) : (
    <TextareaComposer transport={transport} />
  );
}

// ---- Default textarea path (unchanged contract, still default) ----------

function TextareaComposer({ transport }: { transport: TransportHandle }) {
  const { text, submitting, setText, setSubmitting, reset } = useComposer();
  const sessionId = useSession((s) => s.sessionId);
  const attachments = useAttachments((s) => s.items);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    await dispatchSubmit({
      transport,
      sessionId,
      text,
      attachments: attachments.map((a) => ({ kind: a.kind, label: a.label, payload: a.payload })),
      mentions: [],
      onStart: () => setSubmitting(true),
      onDone: () => {
        reset();
        useAttachments.getState().clear();
        setSubmitting(false);
      },
    });
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
    <ComposerShell
      sessionId={sessionId}
      submitting={submitting}
      canSend={!!text.trim() && !!sessionId && !submitting}
      onSendClick={submit}
      attachments={attachments.map((a) => ({ id: a.id, label: a.label }))}
      onRemoveAttachment={(id) => useAttachments.getState().remove(id)}
    >
      <div style={{ position: 'relative' }}>
        {pickerOpen && mentionQuery && (
          <MentionPicker
            transport={transport}
            query={mentionQuery}
            onSelect={(r) => {
              useAttachments.getState().add({
                id: r.id,
                kind: r.kind === 'file' ? 'file' : 'url',
                label: r.label,
                payload: r.payload,
              });
            }}
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
    </ComposerShell>
  );
}

// ---- Experimental contentEditable path ----------------------------------

function ExperimentalComposer({ transport }: { transport: TransportHandle }) {
  const { submitting, setSubmitting, reset } = useComposer();
  const sessionId = useSession((s) => s.sessionId);
  const attachments = useAttachments((s) => s.items);
  const editorRef = useRef<ContentEditableHandle>(null);
  const [hasContent, setHasContent] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const submit = async () => {
    if (!sessionId || submitting) return;
    const root = editorRef.current?.root() ?? null;
    const { text, mentions } = serialize(root);
    if (!text.trim() && mentions.length === 0) return;
    await dispatchSubmit({
      transport,
      sessionId,
      text,
      attachments: attachments.map((a) => ({ kind: a.kind, label: a.label, payload: a.payload })),
      mentions,
      onStart: () => setSubmitting(true),
      onDone: () => {
        editorRef.current?.clear();
        setHasContent(false);
        reset();
        useAttachments.getState().clear();
        setSubmitting(false);
      },
    });
  };

  const onTextChange = (plain: string, textBefore: string) => {
    setHasContent(plain.trim().length > 0);
    // Pure trigger detection over text-before-caret. See composer/triggers.ts.
    setSlashQuery(matchTrigger(textBefore, '/'));
    setMentionQuery(matchTrigger(textBefore, '@'));
  };

  const insertMention = (r: {
    id: string;
    kind: 'file' | 'url' | 'page';
    label: string;
    payload: string;
  }) => {
    const handle = editorRef.current;
    if (!handle) return;
    const trigger = `@${mentionQuery ?? ''}`;
    const chip = buildMentionChip(r);
    handle.insertChip(trigger, chip);
    setMentionQuery(null);
  };

  const invokeSlashAction = (action: ActionSpec) => {
    markUsed(action.id);
    if (transport && sessionId) {
      transport
        .send(sessionId, 'palette.invoke_action', { actionId: action.id, args: {} })
        .catch(() => {
          /* notify lane handles */
        });
    }
    editorRef.current?.clear();
    setSlashQuery(null);
    setHasContent(false);
  };

  return (
    <ComposerShell
      sessionId={sessionId}
      submitting={submitting}
      canSend={hasContent && !!sessionId && !submitting}
      onSendClick={submit}
      attachments={attachments.map((a) => ({ id: a.id, label: a.label }))}
      onRemoveAttachment={(id) => useAttachments.getState().remove(id)}
      footnote="experimental · Enter to send · Shift+Enter newline · / commands · @ mentions"
    >
      <div style={{ position: 'relative' }}>
        {slashQuery !== null && (
          <SlashPalette
            query={slashQuery}
            onInvoke={invokeSlashAction}
            onClose={() => setSlashQuery(null)}
          />
        )}
        {mentionQuery !== null && (
          <MentionPicker
            transport={transport}
            query={mentionQuery}
            onSelect={insertMention}
            onClose={() => setMentionQuery(null)}
          />
        )}
        <ContentEditable
          ref={editorRef}
          disabled={submitting || !sessionId}
          // While a palette/picker is open it owns Enter — editor still
          // preventDefaults newline insertion but skips submit.
          submitDisabled={slashQuery !== null || mentionQuery !== null}
          placeholder={
            sessionId
              ? 'Ask, plan, or run a slash command…  type / for actions, @ to mention'
              : 'No active session'
          }
          onSubmit={submit}
          onTextChange={onTextChange}
        />
      </div>
    </ComposerShell>
  );
}

// ---- Shared chrome ------------------------------------------------------

interface ShellProps {
  sessionId: string | null;
  submitting: boolean;
  canSend: boolean;
  onSendClick(): void;
  attachments: Array<{ id: string; label: string }>;
  onRemoveAttachment(id: string): void;
  footnote?: string;
  children: React.ReactNode;
}

function ComposerShell({
  sessionId,
  submitting,
  canSend,
  onSendClick,
  attachments,
  onRemoveAttachment,
  footnote,
  children,
}: ShellProps) {
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
                  onClick={() => onRemoveAttachment(a.id)}
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
        {children}
        <div className="composer-foot">
          <div className="left">
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {footnote ?? 'Enter to send · Shift+Enter newline · @ to mention'}
            </span>
          </div>
          <div className="right">
            {sessionId && (
              <span className="badge" style={{ fontSize: 11, padding: '2px 6px' }}>
                {sessionId.slice(0, 12)}
              </span>
            )}
            <button
              onClick={onSendClick}
              disabled={!canSend}
              className="btn primary"
              style={{
                fontSize: 12,
                padding: '6px 12px',
                opacity: canSend ? 1 : 0.5,
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

// ---- Submit pipeline ----------------------------------------------------

interface DispatchArgs {
  transport: TransportHandle;
  sessionId: string;
  text: string;
  attachments: Array<{ kind: string; label: string; payload: string }>;
  mentions: MentionRef[];
  onStart(): void;
  onDone(): void;
}

/** Single source of truth for the message.submit envelope shape, locked
 *  by composer.payload.test.ts so the contract cannot drift. */
export function buildSubmitPayload(args: {
  text: string;
  attachments: Array<{ kind: string; label: string; payload: string }>;
  mentions: MentionRef[];
}): {
  text: string;
  attachments: Array<{ kind: string; label: string; payload: string }>;
  mentions: MentionRef[];
} {
  return {
    text: args.text,
    attachments: args.attachments,
    mentions: args.mentions,
  };
}

async function dispatchSubmit({
  transport,
  sessionId,
  text,
  attachments,
  mentions,
  onStart,
  onDone,
}: DispatchArgs): Promise<void> {
  onStart();
  try {
    const localId = 'usr_' + Math.random().toString(36).slice(2, 10);
    useTranscript.getState().upsert({
      id: localId,
      role: 'user',
      content: text,
      state: 'completed',
      createdAt: new Date().toISOString(),
    });
    const payload = buildSubmitPayload({ text, attachments, mentions });
    const ack = await transport.send(sessionId, 'message.submit', payload);
    if (!ack.ok) {
      console.error('submit failed', ack.error);
    }
  } finally {
    onDone();
  }
}
