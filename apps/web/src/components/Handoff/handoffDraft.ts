import type { EvidenceRef, Finding, Run } from '../../stores/assessment';
import type {
  HandoffApproval,
  HandoffPin,
  HandoffTarget,
  PacketTask,
  PinPolicy,
} from '../../stores/handoff';

export interface HandoffDraftInput {
  findings: Finding[];
  runs: Map<string, Run>;
  evidence: Map<string, EvidenceRef>;
  title: string;
  authorName: string;
  targetProfile: string;
  policy: PinPolicy;
  activeRunId: string | null;
  now?: Date;
}

export interface HandoffDraft {
  title: string;
  summary: string;
  source_run_ids: string[];
  accepted_finding_ids: string[];
  created_by: string;
  created_at: string;
  pin: HandoffPin;
  tasks: PacketTask[];
  order_hint: string[];
  target: HandoffTarget;
  approval: HandoffApproval;
  state: 'draft';
  state_history: Array<{ state: string; at: string; by?: string }>;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function primaryRun(input: HandoffDraftInput): Run | null {
  const selectedRunIds = unique(input.findings.map((finding) => finding.run_id));
  if (input.activeRunId && selectedRunIds.includes(input.activeRunId)) {
    return input.runs.get(input.activeRunId) ?? null;
  }
  for (const runId of selectedRunIds) {
    const run = input.runs.get(runId);
    if (run?.scope) return run;
  }
  if (input.activeRunId) {
    return input.runs.get(input.activeRunId) ?? null;
  }
  for (const runId of selectedRunIds) {
    const run = input.runs.get(runId);
    if (run) return run;
  }
  return null;
}

function touchesPathsFromEvidenceRefs(refs: EvidenceRef[]): string[] {
  const paths: string[] = [];
  for (const ref of refs) {
    const raw = typeof ref.uri === 'string' && ref.uri.trim().length > 0 ? ref.uri : ref.kind === 'file' ? ref.label : '';
    if (!raw) continue;
    const path = raw
      .replace(/^file:\/\//, '')
      .replace(/:(\d+)(-\d+)?$/, '');
    if (!path) continue;
    paths.push(path);
  }
  return unique(paths);
}

function buildTask(finding: Finding, evidence: EvidenceRef[]): PacketTask {
  const severity = finding.severity;
  const touches_paths = touchesPathsFromEvidenceRefs(evidence);
  const effort = severity === 'critical' || severity === 'high' ? 'days' : 'hours';
  const title = `Resolve ${finding.title}`;
  return {
    id: `task_${finding.id}`,
    title,
    rationale: finding.summary || finding.check || finding.title,
    source_finding_ids: [finding.id],
    evidence_refs: evidence,
    steps: [
      `Review the evidence for ${finding.title}.`,
      `Implement the smallest scoped fix for ${finding.title}.`,
      'Verify the affected paths and regression surface.',
    ],
    constraints: [
      'Keep the change scoped to the affected paths.',
      'Preserve behavior outside the touched surface.',
      'Do not weaken the trust boundary.',
    ],
    risk_notes: [
      severity === 'critical'
        ? 'Critical finding: expect high review scrutiny.'
        : severity === 'high'
          ? 'High-priority fix: validate surrounding paths carefully.'
          : 'Moderate-risk fix: keep the edit localized.',
    ],
    est_effort: effort,
    depends_on: [],
    touches_paths,
    requires_approval_per_step: severity === 'critical',
    rollback_steps: [
      'Revert the scoped change if validation regresses.',
      'Restore the touched files to the previous state if needed.',
    ],
  };
}

function buildPin(run: Run | null, policy: PinPolicy, now: Date): HandoffPin {
  return {
    repo_ref: run?.scope?.repo_ref ?? '',
    base_commit_sha: run?.scope?.base_commit_sha ?? '',
    worktree_digest: '',
    assessment_snapshot_at: run?.started_at ?? now.toISOString(),
    connector_snapshots:
      run?.connector_snapshots?.map((snapshot) => ({
        connector_id: snapshot.connector_id,
        kind: snapshot.kind,
        snapshot_id: snapshot.snapshot_id,
        captured_at: snapshot.captured_at,
        ...(snapshot.etag !== undefined ? { etag: snapshot.etag } : {}),
      })) ?? [],
    expires_at: addDays(now, 7),
    invalidate_on_repo_change: policy === 'strict',
    invalidation_policy: policy,
  };
}

function buildApproval(findings: Finding[], targetProfile: string): HandoffApproval {
  const twoParty =
    findings.some((finding) => finding.severity === 'critical') || targetProfile.startsWith('executor.release@');
  return {
    required: true,
    approvers: [],
    two_party: twoParty,
    required_roles: twoParty
      ? targetProfile.startsWith('executor.release@')
        ? ['release_manager', 'eng_lead']
        : ['approver']
      : [],
  };
}

function buildTarget(targetProfile: string, title: string): HandoffTarget {
  return {
    kind: 'dispatch_to_local_vac',
    executor_profile_id: targetProfile,
    session_title: title,
  };
}

export function buildHandoffDraft(input: HandoffDraftInput): HandoffDraft {
  const now = input.now ?? new Date();
  const title = input.title.trim() || `Handoff ${now.toISOString()}`;
  const author = input.authorName.trim() || 'unknown';
  const selectedRunIds = unique(input.findings.map((finding) => finding.run_id));
  const sourceRun = primaryRun(input);
  const tasks = input.findings.map((finding) =>
    buildTask(
      finding,
      finding.evidence_ids
        .map((id) => input.evidence.get(id))
        .filter((e): e is EvidenceRef => e !== undefined),
    ),
  );
  const approval = buildApproval(input.findings, input.targetProfile);
  return {
    title,
    summary:
      input.findings.length === 0
        ? 'Empty handoff draft'
        : `Handoff packet for ${input.findings.length} finding${input.findings.length === 1 ? '' : 's'}.`,
    source_run_ids: selectedRunIds,
    accepted_finding_ids: input.findings.map((finding) => finding.id),
    created_by: author,
    created_at: now.toISOString(),
    pin: buildPin(sourceRun, input.policy, now),
    tasks,
    order_hint: tasks.map((task) => task.id),
    target: buildTarget(input.targetProfile, title),
    approval,
    state: 'draft',
    state_history: [
      { state: 'draft', at: now.toISOString(), by: author },
      { state: 'pending_approval', at: now.toISOString() },
    ],
  };
}

export function isHandoffPinReady(pin: HandoffPin): boolean {
  return (
    pin.repo_ref.trim().length > 0 &&
    pin.base_commit_sha.trim().length > 0 &&
    pin.worktree_digest.trim().length > 0 &&
    pin.assessment_snapshot_at.trim().length > 0 &&
    pin.expires_at.trim().length > 0
  );
}
