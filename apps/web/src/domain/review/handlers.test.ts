import { beforeEach, describe, expect, it } from 'vitest';
import { registerReviewHandlers } from './handlers';
import { useReview } from '../../stores/review';
import type { EventFrame, TransportHandle } from '../../transport';

type Handler = (ev: EventFrame) => void;

function mockTransport() {
  const handlers = new Map<string, Handler[]>();
  const t: TransportHandle = {
    async send() {
      return { ackOf: 'x', ok: true };
    },
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        const remaining = handlers.get(type)?.filter((h) => h !== handler) ?? [];
        handlers.set(type, remaining);
      };
    },
    close() {},
  };
  const emit = (type: string, payload: unknown) => {
    const frame: EventFrame = {
      seq: 1,
      session_id: 's',
      type,
      payload,
      v: 1,
      ts: '2026-01-01T00:00:00Z',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('review handlers', () => {
  beforeEach(() =>
    useReview.setState({
      files: [],
      diffs: new Map(),
      pendingFetch: new Set(),
      actionStatus: {},
    }),
  );

  it('maps review.changeset_updated into review files with audit metadata', () => {
    const { t, emit } = mockTransport();
    const off = registerReviewHandlers(t);

    emit('review.changeset_updated', {
      tool_call_id: 'tc1',
      approved_by_approval_id: 'appr_01',
      diffs: [
        {
          path: '/repo/hello.md',
          old_text: null,
          new_text: 'hello from acp\n',
        },
      ],
    });

    const files = useReview.getState().files;
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('/repo/hello.md');
    expect(files[0]?.toolCallId).toBe('tc1');
    expect(files[0]?.approvedByApprovalId).toBe('appr_01');
    expect(files[0]?.sourceEventType).toBe('review.changeset_updated');
    expect(files[0]?.status).toBe('added');

    off();
  });

  it('maps review.file.action.updated into actionStatus keyed by path', () => {
    const { t, emit } = mockTransport();
    const off = registerReviewHandlers(t);

    emit('review.file.action.updated', {
      path: 'src/auth/token.ts',
      action: 'revert',
      status: 'failed',
      message: 'Bridge refused: dirty working tree.',
    });

    const status = useReview.getState().actionStatus['file:src/auth/token.ts'];
    expect(status?.status).toBe('failed');
    expect(status?.message).toBe('Bridge refused: dirty working tree.');

    off();
  });

  it('falls back to a default message when payload omits one', () => {
    const { t, emit } = mockTransport();
    const off = registerReviewHandlers(t);

    emit('review.file.action.updated', {
      path: 'src/a.ts',
      status: 'completed',
    });

    const fb = useReview.getState().actionStatus['file:src/a.ts'];
    expect(fb?.status).toBe('completed');
    expect((fb?.message ?? '').length).toBeGreaterThan(0);

    off();
  });

  it('maps review.hunk.action.updated into actionStatus keyed by path+hunk+action', () => {
    const { t, emit } = mockTransport();
    const off = registerReviewHandlers(t);

    emit('review.hunk.action.updated', {
      path: 'src/a.ts',
      hunk_id: 'h1',
      action: 'request_rework',
      status: 'requested',
      message: 'Agent picked it up.',
    });

    const status = useReview.getState().actionStatus['hunk:src/a.ts:h1:request_rework'];
    expect(status?.status).toBe('requested');
    expect(status?.message).toBe('Agent picked it up.');

    off();
  });

  it('ignores hunk action update payloads missing required fields', () => {
    const { t, emit } = mockTransport();
    const off = registerReviewHandlers(t);

    emit('review.hunk.action.updated', { path: 'src/a.ts' });
    emit('review.hunk.action.updated', { hunk_id: 'h1', action: 'revert_hunk' });

    expect(Object.keys(useReview.getState().actionStatus)).toHaveLength(0);

    off();
  });
});
