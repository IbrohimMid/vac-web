import { useMemo } from 'react';
import type { TransportHandle } from '../../transport';
import { useReview, type ReviewActionFeedback, type ReviewFile } from '../../stores/review';
import { useSession } from '../../stores/session';
import { useCockpit } from '../../stores/cockpit';
import {
  classifyReviewFile,
  parseUnifiedHunks,
  requestReviewFileRevert,
  requestReviewHunkRevert,
  requestReviewHunkRevision,
  reviewFileActionKey,
  reviewHunkActionKey,
  type ReviewHunkSummary,
} from '../../domain/review/actions';

interface Props {
  transport: TransportHandle | null;
}

function statusLabel(file: ReviewFile): string {
  if (file.approvedByApprovalId) return 'approved';
  if (file.status === 'deleted') return 'needs review';
  return 'needs review';
}

export function ReviewQueue({ transport }: Props) {
  const files = useReview((s) => s.files);
  const diffs = useReview((s) => s.diffs);
  const actionStatus = useReview((s) => s.actionStatus);
  const sessionId = useSession((s) => s.sessionId);
  const setRoute = useCockpit((s) => s.setRoute);
  const ready = !!transport && !!sessionId;
  const sorted = useMemo(() => [...files].sort((a, b) => a.path.localeCompare(b.path)), [files]);

  if (sorted.length === 0) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="review-queue-empty">
        <span className="cw-empty-title">No review queue</span>
        <span className="cw-empty-hint">Changed files will appear here after review.changeset_updated arrives.</span>
      </div>
    );
  }

  return (
    <section className="codeworkspace-reviewqueue" aria-label="Review queue" data-testid="review-queue">
      <header className="codeworkspace-reviewqueue-header">
        <div>
          <span className="cw-empty-title">Review queue</span>
          <span className="cw-empty-hint">{sorted.length} changed files grouped by file with risk labels and hunk actions.</span>
        </div>
        <button type="button" className="codeworkspace-link-btn" onClick={() => setRoute('build')}>Open full Review</button>
      </header>
      <div className="codeworkspace-reviewqueue-list">
        {sorted.map((file) => (
          <ReviewQueueFile
            key={file.path}
            file={file}
            unified={diffs.get(file.path)?.unified ?? null}
            transport={transport}
            sessionId={sessionId}
            ready={ready}
            actionStatus={actionStatus}
          />
        ))}
      </div>
      <p className="cw-empty-detail codeworkspace-reviewqueue-truth">
Review actions are agent-mediated: VAC sends an audited, path-scoped request to the bridge/agent instead of silently mutating files in the browser.
      </p>
    </section>
  );
}

function ReviewQueueFile({ file, unified, transport, sessionId, ready, actionStatus }: { file: ReviewFile; unified: string | null; transport: TransportHandle | null; sessionId: string | null; ready: boolean; actionStatus: Record<string, ReviewActionFeedback> }) {
  const labels = classifyReviewFile(file);
  const hunks = parseUnifiedHunks(unified);
  const fileActionKey = reviewFileActionKey(file.path);
  const fileFeedback = actionStatus[fileActionKey];
  const revertFile = () => {
    if (!ready || !transport || !sessionId) return;
    // The helper writes 'sending' → 'requested' (or 'failed') into the store;
    // swallow the rejection so the unhandled promise does not surface to React.
    void requestReviewFileRevert(transport, sessionId, file.path).catch(() => {});
  };

  return (
    <article className="codeworkspace-reviewqueue-file" data-testid="review-queue-file">
      <header className="codeworkspace-reviewqueue-file-header">
        <div className="codeworkspace-reviewqueue-path">
          <strong>{file.path}</strong>
          <span>{file.status} · {statusLabel(file)} · +{file.additions} / -{file.deletions}</span>
        </div>
        <button type="button" className="codeworkspace-link-btn codeworkspace-reviewqueue-danger" onClick={revertFile} disabled={!ready || fileFeedback?.status === 'sending'}>Request file revert</button>
      </header>
      <div className="codeworkspace-reviewqueue-labels" aria-label={`Risk labels for ${file.path}`}>
        {labels.map((label) => <span key={label} className="codeworkspace-reviewqueue-label">{label}</span>)}
      </div>
      {file.toolCallId || file.approvedByApprovalId || file.sourceEventType ? (
        <div className="cw-empty-detail">
          {file.toolCallId ? `tool: ${file.toolCallId}` : null}
          {file.approvedByApprovalId ? ` · approval: ${file.approvedByApprovalId}` : null}
          {file.sourceEventType ? ` · src: ${file.sourceEventType}` : null}
        </div>
      ) : null}
      {fileFeedback ? <ActionFeedback feedback={fileFeedback} /> : null}
      {hunks.length > 0 ? (
        <ol className="codeworkspace-reviewqueue-hunks" data-testid="review-queue-hunks">
          {hunks.map((hunk) => (
            <ReviewHunkRow key={hunk.id} hunk={hunk} path={file.path} transport={transport} sessionId={sessionId} ready={ready} actionStatus={actionStatus} />
          ))}
        </ol>
      ) : (
        <div className="codeworkspace-empty" role="status" data-testid="review-queue-hunks-empty">
          <span className="cw-empty-title">Hunks not loaded</span>
          <span className="cw-empty-hint">Open the diff viewer to lazy-load review.file_diff_chunk for this file.</span>
        </div>
      )}
    </article>
  );
}

function ReviewHunkRow({ hunk, path, transport, sessionId, ready, actionStatus }: { hunk: ReviewHunkSummary; path: string; transport: TransportHandle | null; sessionId: string | null; ready: boolean; actionStatus: Record<string, ReviewActionFeedback> }) {
  const reworkKey = reviewHunkActionKey(path, hunk.id, 'request_rework');
  const revertKey = reviewHunkActionKey(path, hunk.id, 'revert_hunk');
  const reworkFeedback = actionStatus[reworkKey];
  const revertFeedback = actionStatus[revertKey];
  const askRevision = () => {
    if (!ready || !transport || !sessionId) return;
    void requestReviewHunkRevision(transport, sessionId, path, hunk).catch(() => {});
  };
  const revertHunk = () => {
    if (!ready || !transport || !sessionId) return;
    void requestReviewHunkRevert(transport, sessionId, path, hunk).catch(() => {});
  };
  return (
    <li className="codeworkspace-reviewqueue-hunk">
      <div>
        <strong>{hunk.id}</strong>
        <span className="cw-empty-detail">{hunk.header} · +{hunk.additions} / -{hunk.deletions}</span>
      </div>
      <div className="codeworkspace-reviewqueue-hunk-actions">
        <button type="button" className="codeworkspace-link-btn" onClick={askRevision} disabled={!ready || reworkFeedback?.status === 'sending'}>Ask agent to revise</button>
        <button type="button" className="codeworkspace-link-btn codeworkspace-reviewqueue-danger" onClick={revertHunk} disabled={!ready || revertFeedback?.status === 'sending'}>Request hunk revert</button>
      </div>
      {reworkFeedback ? <ActionFeedback feedback={reworkFeedback} /> : null}
      {revertFeedback ? <ActionFeedback feedback={revertFeedback} /> : null}
    </li>
  );
}

function ActionFeedback({ feedback }: { feedback: ReviewActionFeedback }) {
  return (
    <div className={`codeworkspace-reviewqueue-feedback codeworkspace-reviewqueue-feedback-${feedback.status}`} role="status">
      {feedback.message}
    </div>
  );
}
