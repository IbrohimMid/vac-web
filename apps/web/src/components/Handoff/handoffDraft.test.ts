import { describe, expect, it } from 'vitest';
import type { EvidenceRef, Finding, Run } from '../../stores/assessment';
import { buildHandoffDraft, isHandoffPinReady } from './handoffDraft';

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    identity_hash: 'sha256:abc',
    run_id: 'run_1',
    category: 'technical',
    subject: 'src/a.ts',
    check: 'check',
    severity: 'critical',
    confidence: 0.95,
    title: 'Fix thing',
    summary: 'Fix thing summary',
    evidence_ids: ['ev_1'],
    emitted_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function mkEvidence(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    id: 'ev_1',
    connector: 'github',
    kind: 'file',
    label: 'src/a.ts',
    captured_at: '2026-01-01T00:00:00Z',
    ttl_seconds: 3600,
    uri: 'file:///workspace/src/a.ts',
    ...overrides,
  };
}

const run: Run = {
  id: 'run_1',
  swarm: 'rtd',
  status: 'running',
  started_at: '2026-01-01T00:00:00Z',
  progress: { completed: 0, total: 1 },
  scope: {
    project_root: '/workspace',
    repo_ref: 'branch:main',
    base_commit_sha: 'abc123def456',
    depth: 'standard',
  },
  connector_snapshots: [
    {
      connector_id: 'github_default',
      kind: 'github',
      snapshot_id: '01J0000000000000000000SN01',
      captured_at: '2026-01-01T00:00:00Z',
    },
  ],
};

describe('buildHandoffDraft', () => {
  it('builds contract-shaped draft payload', () => {
    const draft = buildHandoffDraft({
      findings: [mkFinding()],
      runs: new Map([[run.id, run]]),
      evidence: new Map([['ev_1', mkEvidence()]]),
      title: 'Packet title',
      authorName: 'alice',
      targetProfile: 'executor.code@1.0.0',
      policy: 'strict',
      activeRunId: 'run_1',
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(draft.title).toBe('Packet title');
    expect(draft.created_by).toBe('alice');
    expect(draft.source_run_ids).toEqual(['run_1']);
    expect(draft.accepted_finding_ids).toEqual(['f1']);
    expect(draft.pin.repo_ref).toBe('branch:main');
    expect(draft.pin.base_commit_sha).toBe('abc123def456');
    expect(draft.pin.worktree_digest).toBe('');
    expect(draft.pin.connector_snapshots).toHaveLength(1);
    expect(draft.pin.invalidation_policy).toBe('strict');
    expect(draft.pin.invalidate_on_repo_change).toBe(true);
    expect(draft.tasks).toHaveLength(1);
    expect(draft.tasks[0]!.source_finding_ids).toEqual(['f1']);
    expect(draft.tasks[0]!.evidence_refs[0]?.uri).toBe('file:///workspace/src/a.ts');
    expect(draft.tasks[0]!.touches_paths).toEqual(['/workspace/src/a.ts']);
    expect(draft.tasks[0]!.constraints).toContain('Keep the change scoped to the affected paths.');
    expect(draft.approval.two_party).toBe(true);
    expect(draft.order_hint).toEqual(['task_f1']);
  });

  it('treats empty worktree digest as not ready for dispatch', () => {
    const draft = buildHandoffDraft({
      findings: [mkFinding({ severity: 'high' })],
      runs: new Map([[run.id, run]]),
      evidence: new Map([['ev_1', mkEvidence()]]),
      title: '',
      authorName: 'alice',
      targetProfile: 'executor.code@1.0.0',
      policy: 'lenient',
      activeRunId: 'run_1',
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(isHandoffPinReady(draft.pin)).toBe(false);
    expect(draft.approval.two_party).toBe(false);
  });
});
