import { useCallback, useMemo, useRef } from 'react';
import type { TransportHandle } from '../../transport';
import {
  useMutations,
  type MutationIntent,
  type MutationKind,
} from '../../stores/mutations';
import { useSession } from '../../stores/session';
import {
  approveMutation,
  rejectMutation,
  refineMutation,
  retryMutation,
} from '../../domain/bridge/actions';

function formatSince(ts: number | undefined): string | null {
  if (!ts) return null;
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}

// Phase B2 (Sprint B): Approval action surface for the bridge mutation
// pipeline. The inbox renders pending intents from `useMutations` and dispatches
// approve / reject / refine commands. Apply / failed lifecycle lands in B3.
//
// Copywriting discipline: every label here treats the browser as the
// REQUESTER. Forbidden words: `save`, `apply patch`, `edit directly`,
// `write file`. Approved vocab: `Approve & apply`, `Reject`, `Ask local AI
// to refine`, `Send to local AI`, `Request hunk revert`.

interface Props {
  transport: TransportHandle | null;
  /** Override for the refine prompt; defaults to window.prompt. */
  promptForRefine?: (intent: MutationIntent) => string | null;
}

const KIND_LABEL: Record<MutationKind, string> = {
  write: 'Write file',
  edit: 'Edit file',
  delete: 'Delete file',
  rename: 'Rename file',
  bash: 'Shell command',
  unknown: 'Unknown kind',
};

export function useMutationInboxPendingCount(): number {
  return useMutations((s) =>
    s.order.reduce(
      (acc, id) => (s.intents[id]?.status === 'pending' ? acc + 1 : acc),
      0,
    ),
  );
}

export function MutationInbox({ transport, promptForRefine }: Props) {
  const intents = useMutations((s) => s.intents);
  const order = useMutations((s) => s.order);
  const sessionId = useSession((s) => s.sessionId);
  const ready = !!transport && !!sessionId;
  const ordered = useMemo(
    () =>
      order
        .map((id) => intents[id])
        .filter((x): x is MutationIntent => Boolean(x))
        .sort((a, b) =>
          a.status === b.status ? a.receivedAt - b.receivedAt : a.status === 'pending' ? -1 : 1,
        ),
    [intents, order],
  );

  if (ordered.length === 0) {
    return (
      <div
        className="codeworkspace-empty"
        role="status"
        data-testid="mutation-inbox-empty"
      >
        <span className="cw-empty-title">Mutation inbox is clear</span>
        <span className="cw-empty-hint">
          Pending bridge mutations land here. Browser never writes directly:
          local AI requests, you approve, the bridge applies.
        </span>
      </div>
    );
  }

  return (
    <section
      className="codeworkspace-mutationinbox"
      aria-label="Bridge mutation inbox"
      data-testid="mutation-inbox"
    >
      <header className="codeworkspace-mutationinbox-header">
        <div>
          <span className="cw-empty-title">Mutation inbox</span>
          <span className="cw-empty-hint">
            {ordered.filter((i) => i.status === 'pending').length} pending
            · {ordered.length} total · keyboard: A approve, R reject, ? refine.
          </span>
        </div>
      </header>
      <ol className="codeworkspace-mutationinbox-list">
        {ordered.map((intent) => (
          <IntentCard
            key={intent.requestId}
            intent={intent}
            transport={transport}
            sessionId={sessionId}
            ready={ready}
            {...(promptForRefine ? { promptForRefine } : {})}
          />
        ))}
      </ol>
      <p className="cw-empty-detail codeworkspace-mutationinbox-truth">
        Approving sends `bridge.mutation.approve` to the local AI — the
        bridge applies on disk and emits the audited lifecycle event. Nothing
        is written by the browser.
      </p>
    </section>
  );
}

interface CardProps {
  intent: MutationIntent;
  transport: TransportHandle | null;
  sessionId: string | null;
  ready: boolean;
  promptForRefine?: (intent: MutationIntent) => string | null;
}

function IntentCard({ intent, transport, sessionId, ready, promptForRefine }: CardProps) {
  const cardRef = useRef<HTMLLIElement | null>(null);
  const pending = intent.status === 'pending';

  const onApprove = useCallback(() => {
    if (!ready || !transport || !sessionId || !pending) return;
    void approveMutation(transport, sessionId, intent.requestId).catch(() => {});
  }, [ready, transport, sessionId, pending, intent.requestId]);

  const onReject = useCallback(() => {
    if (!ready || !transport || !sessionId || !pending) return;
    void rejectMutation(transport, sessionId, intent.requestId).catch(() => {});
  }, [ready, transport, sessionId, pending, intent.requestId]);

  const onRetry = useCallback(() => {
    if (!ready || !transport || !sessionId) return;
    void retryMutation(transport, sessionId, intent.requestId).catch(() => {});
  }, [ready, transport, sessionId, intent.requestId]);

  const onRefine = useCallback(() => {
    if (!ready || !transport || !sessionId || !pending) return;
    const note =
      (promptForRefine ?? defaultRefinePrompt)(intent);
    if (!note) return;
    void refineMutation(transport, sessionId, intent.requestId, note).catch(() => {});
  }, [ready, transport, sessionId, pending, intent, promptForRefine]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLLIElement>) => {
      if (e.target !== cardRef.current) return;
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); onApprove(); }
      else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (intent.status === 'failed') onRetry();
        else onReject();
      }
      else if (e.key === '?') { e.preventDefault(); onRefine(); }
    },
    [onApprove, onReject, onRefine],
  );

  return (
    <li
      ref={cardRef}
      className={`codeworkspace-mutationinbox-card codeworkspace-mutationinbox-card-${intent.status}`}
      data-testid="mutation-inbox-card"
      data-request-id={intent.requestId}
      data-status={intent.status}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <header className="codeworkspace-mutationinbox-card-header">
        <span className={`codeworkspace-mutationinbox-kind codeworkspace-mutationinbox-kind-${intent.kind}`}>
          {KIND_LABEL[intent.kind]}
        </span>
        <strong className="codeworkspace-mutationinbox-summary">{intent.summary}</strong>
        <span className="codeworkspace-mutationinbox-status" data-testid="mutation-inbox-status">
          {intent.status}
        </span>
      </header>
      {intent.targetPath ? (
        <code className="codeworkspace-mutationinbox-target">{intent.targetPath}</code>
      ) : null}
      {intent.rationale ? (
        <p className="codeworkspace-mutationinbox-rationale">{intent.rationale}</p>
      ) : null}
      {intent.diffPreview ? (
        <pre className="codeworkspace-mutationinbox-diff" data-testid="mutation-inbox-diff">
{intent.diffPreview}
        </pre>
      ) : null}
      <dl className="codeworkspace-mutationinbox-audit">
        <div><dt>request</dt><dd>{intent.requestId}</dd></div>
        {intent.originatingTaskId ? (<div><dt>task</dt><dd>{intent.originatingTaskId}</dd></div>) : null}
        {intent.originatingSessionId ? (<div><dt>session</dt><dd>{intent.originatingSessionId}</dd></div>) : null}
        <div><dt>source</dt><dd>{intent.sourceEventType}</dd></div>
      </dl>
      <div className="codeworkspace-mutationinbox-actions">
        <button
          type="button"
          className="codeworkspace-link-btn codeworkspace-mutationinbox-approve"
          onClick={onApprove}
          disabled={!ready || !pending}
        >Approve &amp; apply</button>
        <button
          type="button"
          className="codeworkspace-link-btn codeworkspace-mutationinbox-reject"
          onClick={onReject}
          disabled={!ready || !pending}
        >Reject</button>
        <button
          type="button"
          className="codeworkspace-link-btn"
          onClick={onRefine}
          disabled={!ready || !pending}
        >Ask local AI to refine</button>
        {intent.status === 'failed' ? (
          <button
            type="button"
            className="codeworkspace-link-btn codeworkspace-mutationinbox-retry"
            onClick={onRetry}
            disabled={!ready}
            data-testid="mutation-inbox-retry"
          >Retry approval</button>
        ) : null}
        {intent.status === 'applying' ? (
          <span
            className="codeworkspace-mutationinbox-applying"
            role="status"
            data-testid="mutation-inbox-applying"
            aria-live="polite"
          >Bridge applying...</span>
        ) : null}
        {formatSince(intent.statusUpdatedAt) ? (
          <time className="codeworkspace-mutationinbox-since" dateTime={new Date(intent.statusUpdatedAt!).toISOString()}>
            {formatSince(intent.statusUpdatedAt)}
          </time>
        ) : null}
      </div>
      {intent.statusMessage ? (
        <div
          className={`codeworkspace-mutationinbox-feedback codeworkspace-mutationinbox-feedback-${intent.status}`}
          role="status"
        >
          {intent.statusMessage}
        </div>
      ) : null}
    </li>
  );
}

function defaultRefinePrompt(intent: MutationIntent): string | null {
  if (typeof window === 'undefined' || typeof window.prompt !== 'function') return null;
  return window.prompt(
    `Tell local AI how to refine "${intent.summary}":`,
    intent.rationale ?? '',
  );
}
