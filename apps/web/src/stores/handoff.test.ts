import { beforeEach, describe, expect, it } from 'vitest';
import { useHandoff, type Packet } from './handoff';

function reset() {
  useHandoff.getState().clear();
}

const basePacket: Packet = {
  id: 'p1',
  title: 't',
  summary: 'summary',
  source_run_ids: ['run-1'],
  accepted_finding_ids: ['f1'],
  created_by: 'alice',
  created_at: 't',
  pin: {
    repo_ref: 'branch:main',
    base_commit_sha: 's',
    worktree_digest: 'd',
    assessment_snapshot_at: 't',
    connector_snapshots: [],
    expires_at: 't2',
    invalidate_on_repo_change: true,
    invalidation_policy: 'strict',
    base_sha: 's',
    captured_at: 't',
    policy: 'strict',
  },
  tasks: [
    {
      id: 'task_p1',
      title: 'Fix t',
      rationale: 'why',
      source_finding_ids: ['f1'],
      evidence_refs: [],
      steps: ['step 1'],
      constraints: ['scope'],
      risk_notes: ['risk'],
      est_effort: 'hours',
      depends_on: [],
      touches_paths: ['src/a.ts'],
      requires_approval_per_step: false,
      rollback_steps: ['revert'],
      finding_ids: ['f1'],
      constraint: 'scope',
    },
  ],
  order_hint: ['task_p1'],
  target: {
    kind: 'dispatch_to_local_vac',
    executor_profile_id: 'executor.code@1.0.0',
    session_title: 't',
    profile_id: 'executor.code@1.0.0',
  },
  approval: {
    required: true,
    approvers: [],
    two_party: false,
    required_roles: [],
  },
  status: 'pending_approval',
  state_history: [
    { state: 'draft', at: 't', by: 'alice' },
    { state: 'pending_approval', at: 't2', by: 'alice', reason: 'created' },
  ],
  signers: [{ name: 'alice', role: 'author', signed_at: 't' }],
  required_signers: 2,
  convergence_count: 0,
  updated_at: 't',
  target_profile: 'executor.code@1.0.0',
};

describe('handoff store', () => {
  beforeEach(reset);

  it('upsert first packet becomes active', () => {
    useHandoff.getState().upsert(basePacket);
    expect(useHandoff.getState().activePacketId).toBe('p1');
  });

  it('addSigner rejects self-sign (idempotent by name)', () => {
    useHandoff.getState().upsert(basePacket);
    const ok = useHandoff
      .getState()
      .addSigner('p1', { name: 'alice', role: 'approver', signed_at: 't2' });
    expect(ok).toBe(false);
    expect(useHandoff.getState().packets.get('p1')?.signers).toHaveLength(1);
  });

  it('addSigner accepts distinct second signer', () => {
    useHandoff.getState().upsert(basePacket);
    const ok = useHandoff
      .getState()
      .addSigner('p1', { name: 'bob', role: 'approver', signed_at: 't2' });
    expect(ok).toBe(true);
    expect(useHandoff.getState().packets.get('p1')?.signers).toHaveLength(2);
  });

  it('setStatus updates status + timestamp', () => {
    useHandoff.getState().upsert(basePacket);
    useHandoff.getState().setStatus('p1', 'invalidated');
    expect(useHandoff.getState().packets.get('p1')?.status).toBe('invalidated');
  });

  it('setStatus is idempotent for identical status', () => {
    useHandoff.getState().upsert(basePacket);
    const before = useHandoff.getState().packets.get('p1')?.state_history.length ?? 0;
    useHandoff.getState().setStatus('p1', 'pending_approval');
    const after = useHandoff.getState().packets.get('p1')?.state_history.length ?? 0;
    expect(after).toBe(before);
  });

  it('setExecutorSession writes both execution and legacy aliases', () => {
    useHandoff.getState().upsert(basePacket);
    useHandoff.getState().setExecutorSession('p1', 'sess_1');
    const packet = useHandoff.getState().packets.get('p1');
    expect(packet?.execution_session_id).toBe('sess_1');
    expect(packet?.executor_session_id).toBe('sess_1');
  });

  it('setExecutionProgress merges task progress map', () => {
    useHandoff.getState().upsert(basePacket);
    useHandoff.getState().setExecutionProgress('p1', {
      task_id: 'task_1',
      status: 'started',
      updated_at: '2026-01-01T00:02:00Z',
      completed: 0,
      total: 1,
      message: 'bootstrapping',
    });
    const packet = useHandoff.getState().packets.get('p1');
    expect(packet).toBeDefined();
    const progress = packet!.execution_progress!.task_1!;
    expect(progress.status).toBe('started');
    expect(progress.message).toBe('bootstrapping');
  });

  it('setExecutionOutcome stores terminal outcome without dropping status', () => {
    useHandoff.getState().upsert(basePacket);
    useHandoff.getState().setExecutionOutcome('p1', 'completed', {
      status: 'success',
      tasks_completed: ['task_1'],
      tasks_failed: [],
      changeset_summary: 'done',
      reassessment_run_id: 'run_1',
    });
    const packet = useHandoff.getState().packets.get('p1');
    expect(packet?.status).toBe('completed');
    expect(packet?.execution_outcome?.status).toBe('success');
  });

  it('incrementConvergence bumps counter', () => {
    useHandoff.getState().upsert(basePacket);
    useHandoff.getState().incrementConvergence('p1');
    useHandoff.getState().incrementConvergence('p1');
    expect(useHandoff.getState().packets.get('p1')?.convergence_count).toBe(2);
  });
});
