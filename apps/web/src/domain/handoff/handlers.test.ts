// Merge semantics for handoff.upserted — a partial update (e.g. the approve
// emission that carries only `{status, signers}`) must not wipe the packet
// draft fields or the normalized pin/task model.

import { beforeEach, describe, expect, it } from 'vitest';
import { registerHandoffHandlers } from './handlers';
import { useHandoff } from '../../stores/handoff';
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
        const l = handlers.get(type)?.filter((h) => h !== handler) ?? [];
        handlers.set(type, l);
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
      ts: 't',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('handoff.upserted merge', () => {
  beforeEach(() => useHandoff.getState().clear());

  it('partial update preserves prior fields', () => {
    const { t, emit } = mockTransport();
    const off = registerHandoffHandlers(t);

    emit('handoff.upserted', {
      packet_id: 'p1',
      title: 'Real title',
      summary: 'Real summary',
      source_run_ids: ['run-1'],
      accepted_finding_ids: ['f1'],
      created_by: 'alice',
      created_at: 't',
      target: {
        kind: 'dispatch_to_local_vac',
        executor_profile_id: 'executor.code@1.0.0',
        session_title: 'packet title',
      },
      status: 'pending_approval',
      tasks: [
        {
          id: 'task_f1',
          title: 'Task 1',
          rationale: 'why',
          source_finding_ids: ['f1'],
          evidence_refs: [
            {
              id: 'ev1',
              connector: 'github',
              kind: 'file',
              label: 'src/a.ts',
              captured_at: 't',
              ttl_seconds: 60,
              uri: 'file:///workspace/src/a.ts',
            },
          ],
          steps: ['step 1'],
          constraints: ['scope'],
          risk_notes: ['risk'],
          est_effort: 'hours',
          depends_on: [],
          touches_paths: ['src/a.ts'],
          requires_approval_per_step: false,
          rollback_steps: ['revert'],
        },
      ],
      pin: {
        repo_ref: 'branch:main',
        base_commit_sha: 'deadbeef',
        worktree_digest: 'abc',
        assessment_snapshot_at: 't',
        expires_at: 't2',
        invalidate_on_repo_change: true,
        invalidation_policy: 'strict',
        connector_snapshots: [],
      },
      approval: {
        required: true,
        approvers: [],
        two_party: false,
        required_roles: [],
      },
      signers: [{ name: 'alice', role: 'author', signed_at: 't' }],
      required_signers: 2,
      state_history: [{ state: 'draft', at: 't', by: 'alice' }],
    });

    // Now emit partial update like the mock-engine approve does.
    emit('handoff.upserted', {
      packet_id: 'p1',
      status: 'approved',
      approval: {
        required: true,
        approvers: ['bob'],
        approver_notes: 'ok',
        approved_at: 't2',
        two_party: false,
        required_roles: [],
      },
      signers: [{ name: 'bob', role: 'approver', signed_at: 't2', reason: 'ok' }],
    });

    const packet = useHandoff.getState().packets.get('p1');
    expect(packet?.title).toBe('Real title');
    expect(packet?.summary).toBe('Real summary');
    expect(packet?.tasks).toHaveLength(1);
    expect(packet?.pin.worktree_digest).toBe('abc');
    expect(packet?.pin.base_commit_sha).toBe('deadbeef');
    expect(packet?.target.executor_profile_id).toBe('executor.code@1.0.0');
    expect(packet?.approval.approvers).toEqual(['bob']);
    expect(packet?.required_signers).toBe(2);
    expect(packet?.status).toBe('approved');
    expect(packet?.signers.map((s) => s.name)).toEqual(['alice', 'bob']);

    off();
  });

  it('re-emitting same signer name does not duplicate', () => {
    const { t, emit } = mockTransport();
    const off = registerHandoffHandlers(t);
    emit('handoff.upserted', {
      packet_id: 'p1',
      signers: [{ name: 'alice', role: 'author', signed_at: 't' }],
    });
    emit('handoff.upserted', {
      packet_id: 'p1',
      signers: [{ name: 'alice', role: 'author', signed_at: 't-newer' }],
    });
    expect(useHandoff.getState().packets.get('p1')?.signers).toHaveLength(1);
    off();
  });
});

describe('handoff execution lifecycle handlers', () => {
  beforeEach(() => useHandoff.getState().clear());

  it('handoff.execution_progress updates per-task progress and executor session', () => {
    const { t, emit } = mockTransport();
    const off = registerHandoffHandlers(t);

    emit('handoff.upserted', {
      packet_id: 'p1',
      status: 'executing',
      execution_session_id: 'sess_exec',
      tasks: [
        {
          id: 'task_1',
          title: 'Task 1',
          rationale: 'why',
          source_finding_ids: [],
          evidence_refs: [],
          steps: [],
          constraints: [],
          risk_notes: [],
          est_effort: 'hours',
          depends_on: [],
          touches_paths: [],
          requires_approval_per_step: false,
          rollback_steps: [],
        },
      ],
      pin: {
        repo_ref: 'branch:main',
        base_commit_sha: 'deadbeef',
        worktree_digest: 'abc',
        assessment_snapshot_at: 't',
        expires_at: 't2',
        invalidate_on_repo_change: true,
        invalidation_policy: 'strict',
        connector_snapshots: [],
      },
      target: {
        kind: 'dispatch_to_local_vac',
        executor_profile_id: 'executor.code@1.0.0',
      },
      approval: {
        required: true,
        approvers: [],
        two_party: false,
        required_roles: [],
      },
      signers: [],
      required_signers: 1,
    });

    emit('handoff.execution_progress', {
      packet_id: 'p1',
      executor_session_id: 'sess_exec',
      task_id: 'task_1',
      status: 'started',
      completed: 0,
      total: 1,
      message: 'bootstrapping',
    });

    const packet = useHandoff.getState().packets.get('p1');
    expect(packet).toBeDefined();
    const progress = packet!.execution_progress!.task_1!;
    expect(packet?.execution_session_id).toBe('sess_exec');
    expect(progress.status).toBe('started');
    expect(progress.completed).toBe(0);
    expect(progress.total).toBe(1);
    off();
  });

  it('handoff.completed stores outcome and completed status', () => {
    const { t, emit } = mockTransport();
    const off = registerHandoffHandlers(t);
    emit('handoff.upserted', {
      packet_id: 'p1',
      status: 'executing',
      execution_session_id: 'sess_exec',
    });
    emit('handoff.completed', {
      packet_id: 'p1',
      executor_session_id: 'sess_exec',
      status: 'completed',
      outcome: {
        status: 'success',
        tasks_completed: ['task_1'],
        tasks_failed: [],
        changeset_summary: 'done',
        reassessment_run_id: 'run_1',
      },
    });

    const packet = useHandoff.getState().packets.get('p1');
    expect(packet?.status).toBe('completed');
    expect(packet?.execution_outcome?.status).toBe('success');
    expect(packet?.execution_outcome?.changeset_summary).toBe('done');
    off();
  });

  it('handoff.failed stores outcome and failed status', () => {
    const { t, emit } = mockTransport();
    const off = registerHandoffHandlers(t);
    emit('handoff.upserted', {
      packet_id: 'p1',
      status: 'executing',
      execution_session_id: 'sess_exec',
    });
    emit('handoff.failed', {
      packet_id: 'p1',
      executor_session_id: 'sess_exec',
      status: 'failed',
      outcome: {
        status: 'failed',
        tasks_completed: [],
        tasks_failed: ['task_1'],
        changeset_summary: 'boom',
      },
    });

    const packet = useHandoff.getState().packets.get('p1');
    expect(packet?.status).toBe('failed');
    expect(packet?.execution_outcome?.status).toBe('failed');
    expect(packet?.execution_outcome?.changeset_summary).toBe('boom');
    off();
  });
});
