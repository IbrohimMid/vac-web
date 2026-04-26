// Wire handoff.* transport events → handoff store + notify lane.

import {
  useHandoff,
  type HandoffApproval,
  type HandoffConnectorSnapshot,
  type HandoffPin,
  type HandoffTarget,
  type Packet,
  type PacketStatus,
  type PacketStateHistoryEntry,
  type PacketTask,
  type Signer,
  type TaskExecutionProgress,
} from '../../stores/handoff';
import { useNotify } from '../../stores/notify';
import type { TransportHandle } from '../../transport';
import type { EvidenceRef as AssessmentEvidenceRef } from '../../stores/assessment';

function asStatus(raw: string | undefined): PacketStatus {
  const known: PacketStatus[] = [
    'draft',
    'pending_approval',
    'approved',
    'rejected',
    'dispatched',
    'executing',
    'completed',
    'failed',
    'invalidated',
    'expired',
  ];
  return known.includes(raw as PacketStatus) ? (raw as PacketStatus) : 'draft';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function stringOr(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback;
}

function boolOr(raw: unknown, fallback = false): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeEvidenceRef(raw: unknown): AssessmentEvidenceRef | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const ttl = typeof raw.ttl_seconds === 'number' ? raw.ttl_seconds : typeof raw.ttlSeconds === 'number' ? raw.ttlSeconds : 0;
  const observed_at =
    stringOr(raw.observed_at) ||
    stringOr(raw.observedAt) ||
    stringOr(raw.captured_at) ||
    stringOr(raw.capturedAt) ||
    new Date().toISOString();
  return {
    id: raw.id,
    connector: stringOr(raw.connector ?? raw.connector_id, 'unknown'),
    kind: stringOr(raw.kind, 'file'),
    label: stringOr(raw.label ?? raw.uri, ''),
    captured_at: stringOr(raw.captured_at ?? raw.capturedAt, observed_at),
    ttl_seconds: Number.isFinite(ttl) ? Math.max(0, Math.floor(ttl)) : 0,
    ...(typeof raw.preview === 'string' ? { preview: raw.preview } : {}),
    ...(typeof raw.uri === 'string' ? { uri: raw.uri } : {}),
    ...(isRecord(raw.locator) ? { locator: raw.locator } : {}),
    ...(typeof raw.connector_id === 'string' ? { connector_id: raw.connector_id } : {}),
    ...(typeof raw.snapshot_id === 'string' ? { snapshot_id: raw.snapshot_id } : {}),
    ...(typeof raw.digest === 'string' ? { digest: raw.digest } : {}),
    ...(typeof raw.source_etag === 'string' ? { source_etag: raw.source_etag } : {}),
    ...(typeof raw.observed_at === 'string' ? { observed_at: raw.observed_at } : {}),
    ...(typeof raw.observedAt === 'string' ? { observed_at: raw.observedAt } : {}),
    ...(typeof raw.fresh_until === 'string' ? { fresh_until: raw.fresh_until } : {}),
    ...(typeof raw.freshUntil === 'string' ? { fresh_until: raw.freshUntil } : {}),
    ...(typeof raw.staleness_policy === 'string'
      ? {
          staleness_policy:
            raw.staleness_policy === 'hard_expire' ||
            raw.staleness_policy === 'warn_only' ||
            raw.staleness_policy === 'immutable'
              ? raw.staleness_policy
              : 'warn_only',
        }
      : {}),
    ...(typeof raw.stalenessPolicy === 'string'
      ? {
          staleness_policy:
            raw.stalenessPolicy === 'hard_expire' ||
            raw.stalenessPolicy === 'warn_only' ||
            raw.stalenessPolicy === 'immutable'
              ? raw.stalenessPolicy
              : 'warn_only',
        }
      : {}),
    ...(typeof raw.captured_by === 'string' ? { captured_by: raw.captured_by } : {}),
    ...(typeof raw.capturedBy === 'string' ? { captured_by: raw.capturedBy } : {}),
    ...(typeof raw.captured_snapshot_id === 'string' ? { captured_snapshot_id: raw.captured_snapshot_id } : {}),
    ...(typeof raw.capturedSnapshotId === 'string' ? { captured_snapshot_id: raw.capturedSnapshotId } : {}),
    ...(typeof raw.size === 'number' ? { size: raw.size } : {}),
    ...(typeof raw.mime_type === 'string' ? { mime_type: raw.mime_type } : {}),
    ...(typeof raw.mimeType === 'string' ? { mime_type: raw.mimeType } : {}),
  };
}

function normalizeConnectorSnapshot(raw: unknown): HandoffConnectorSnapshot | null {
  if (!isRecord(raw) || typeof raw.snapshot_id !== 'string') return null;
  return {
    connector_id: stringOr(raw.connector_id ?? raw.connector, 'unknown'),
    kind: stringOr(raw.kind, 'file'),
    snapshot_id: raw.snapshot_id,
    captured_at: stringOr(raw.captured_at ?? raw.capturedAt, new Date().toISOString()),
    ...(typeof raw.etag === 'string' ? { etag: raw.etag } : {}),
  };
}

function normalizePin(raw: unknown, prev?: HandoffPin): HandoffPin {
  const src = isRecord(raw) ? raw : {};
  const connectorSnapshots = Array.isArray(src.connector_snapshots)
    ? src.connector_snapshots
        .map(normalizeConnectorSnapshot)
        .filter((snapshot): snapshot is HandoffConnectorSnapshot => snapshot !== null)
    : prev?.connector_snapshots ?? [];
  const repoRef = stringOr(src.repo_ref ?? src.repoRef, prev?.repo_ref ?? '');
  const baseCommitSha = stringOr(
    src.base_commit_sha ?? src.baseCommitSha ?? src.base_sha,
    prev?.base_commit_sha ?? prev?.base_sha ?? '',
  );
  const worktreeDigest = stringOr(
    src.worktree_digest ?? src.worktreeDigest,
    prev?.worktree_digest ?? '',
  );
  const assessmentSnapshotAt = stringOr(
    src.assessment_snapshot_at ?? src.assessmentSnapshotAt ?? src.captured_at,
    prev?.assessment_snapshot_at ?? prev?.captured_at ?? new Date().toISOString(),
  );
  const expiresAt = stringOr(src.expires_at ?? src.expiresAt, prev?.expires_at ?? new Date().toISOString());
  const invalidationPolicyRaw = stringOr(
    src.invalidation_policy ?? src.invalidationPolicy ?? src.policy,
    prev?.invalidation_policy ?? prev?.policy ?? 'strict',
  );
  const invalidationPolicy =
    invalidationPolicyRaw === 'strict' || invalidationPolicyRaw === 'lenient'
      ? invalidationPolicyRaw
      : 'strict';
  const invalidateOnRepoChange = boolOr(
    src.invalidate_on_repo_change ?? src.invalidateOnRepoChange,
    prev?.invalidate_on_repo_change ?? invalidationPolicy === 'strict',
  );
  return {
    repo_ref: repoRef,
    base_commit_sha: baseCommitSha,
    worktree_digest: worktreeDigest,
    assessment_snapshot_at: assessmentSnapshotAt,
    connector_snapshots: connectorSnapshots,
    expires_at: expiresAt,
    invalidate_on_repo_change: invalidateOnRepoChange,
    invalidation_policy: invalidationPolicy,
    ...(baseCommitSha ? { base_sha: baseCommitSha } : prev?.base_sha ? { base_sha: prev.base_sha } : {}),
    ...(src.captured_at !== undefined
      ? { captured_at: stringOr(src.captured_at) }
      : prev?.captured_at
        ? { captured_at: prev.captured_at }
        : {}),
    ...(src.policy !== undefined
      ? { policy: invalidationPolicy }
      : prev?.policy !== undefined
        ? { policy: prev.policy }
        : {}),
  };
}

function normalizeTask(raw: unknown, index: number): PacketTask {
  const src = isRecord(raw) ? raw : {};
  const effort = stringOr(src.est_effort ?? src.estEffort, 'hours');
  const sourceFindingIds = stringArray(src.source_finding_ids ?? src.sourceFindingIds ?? src.finding_ids ?? src.findingIds);
  const evidenceRefs = Array.isArray(src.evidence_refs)
    ? src.evidence_refs.map(normalizeEvidenceRef).filter((ref): ref is AssessmentEvidenceRef => ref !== null)
    : Array.isArray(src.evidenceRefs)
      ? src.evidenceRefs.map(normalizeEvidenceRef).filter((ref): ref is AssessmentEvidenceRef => ref !== null)
      : [];
  const findingIds = sourceFindingIds.length > 0 ? sourceFindingIds : stringArray(src.finding_ids ?? src.findingIds);
  const title = stringOr(src.title, `Task ${index + 1}`);
  const rationale = stringOr(src.rationale ?? src.constraint, '');
  const requiresApprovalPerStep = boolOr(
    src.requires_approval_per_step ?? src.requiresApprovalPerStep,
    false,
  );
  return {
    id: stringOr(src.id, `task_${index + 1}`),
    title,
    rationale,
    source_finding_ids: sourceFindingIds.length > 0 ? sourceFindingIds : findingIds,
    evidence_refs: evidenceRefs,
    steps: stringArray(src.steps),
    constraints: stringArray(src.constraints),
    risk_notes: stringArray(src.risk_notes ?? src.riskNotes),
    est_effort: effort === 'days' || effort === 'weeks' ? (effort as PacketTask['est_effort']) : 'hours',
    depends_on: stringArray(src.depends_on ?? src.dependsOn),
    touches_paths: stringArray(src.touches_paths ?? src.touchesPaths),
    requires_approval_per_step: requiresApprovalPerStep,
    rollback_steps: stringArray(src.rollback_steps ?? src.rollbackSteps),
    ...(findingIds.length > 0 ? { finding_ids: findingIds } : {}),
    ...(typeof src.constraint === 'string' ? { constraint: src.constraint } : {}),
  };
}

function normalizeTarget(raw: unknown, prev?: Packet['target'], legacyProfile?: string): HandoffTarget {
  const src = isRecord(raw) ? raw : {};
  const kind = stringOr(src.kind, prev?.kind ?? 'dispatch_to_local_vac') as HandoffTarget['kind'];
  const executorProfileId = stringOr(
    src.executor_profile_id ?? src.executorProfileId ?? legacyProfile,
    prev?.executor_profile_id ?? prev?.profile_id ?? 'executor.code@1.0.0',
  );
  const sessionTitle = stringOr(src.session_title ?? src.sessionTitle, prev?.session_title ?? '');
  return {
    kind:
      kind === 'dispatch_to_local_vac' ||
      kind === 'dispatch_to_vac_web_cli' ||
      kind === 'export_as_blueprint_only'
        ? kind
        : 'dispatch_to_local_vac',
    executor_profile_id: executorProfileId,
    ...(sessionTitle ? { session_title: sessionTitle } : {}),
    ...(legacyProfile ? { profile_id: legacyProfile } : prev?.profile_id ? { profile_id: prev.profile_id } : {}),
  };
}

function normalizeApproval(
  raw: unknown,
  prev: HandoffApproval | undefined,
  signers: Signer[],
  status: PacketStatus,
): HandoffApproval {
  const src = isRecord(raw) ? raw : {};
  const approvers = stringArray(src.approvers ?? src.approverIds);
  const requiredRoles = stringArray(src.required_roles ?? src.requiredRoles);
  return {
    required: boolOr(src.required, prev?.required ?? status === 'pending_approval'),
    approvers: approvers.length > 0 ? approvers : prev?.approvers ?? signers.filter((s) => s.role === 'approver').map((s) => s.name),
    ...(typeof src.approver_notes === 'string' ? { approver_notes: src.approver_notes } : {}),
    ...(typeof src.approverNotes === 'string' ? { approver_notes: src.approverNotes } : {}),
    ...(typeof src.approved_at === 'string' ? { approved_at: src.approved_at } : {}),
    ...(typeof src.approvedAt === 'string' ? { approved_at: src.approvedAt } : {}),
    two_party: boolOr(src.two_party ?? src.twoParty, prev?.two_party ?? false),
    required_roles: requiredRoles.length > 0 ? requiredRoles : prev?.required_roles ?? [],
  };
}

function normalizeStateHistory(raw: unknown, prev?: PacketStateHistoryEntry[]): PacketStateHistoryEntry[] {
  const entries = Array.isArray(raw) ? raw : prev ?? [];
  return entries
    .map((item): PacketStateHistoryEntry | null => {
      if (!isRecord(item) || typeof item.state !== 'string' || typeof item.at !== 'string') return null;
      return {
        state: item.state,
        at: item.at,
        ...(typeof item.by === 'string' ? { by: item.by } : {}),
        ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
      };
    })
    .filter((entry): entry is PacketStateHistoryEntry => entry !== null);
}

function normalizeExecutionProgress(
  raw: unknown,
  prev?: Packet['execution_progress'],
): Packet['execution_progress'] | undefined {
  if (!isRecord(raw)) return prev;
  const next: Record<string, TaskExecutionProgress> = {};
  for (const [taskId, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const rawStatus = stringOr(value.status, 'started');
    const status =
      rawStatus === 'pending' || rawStatus === 'started' || rawStatus === 'completed' || rawStatus === 'failed'
        ? rawStatus
        : 'started';
    const completed = typeof value.completed === 'number' && Number.isFinite(value.completed) ? Math.max(0, Math.floor(value.completed)) : 0;
    const total = typeof value.total === 'number' && Number.isFinite(value.total) ? Math.max(0, Math.floor(value.total)) : completed;
    next[taskId] = {
      task_id: stringOr(value.task_id ?? value.taskId, taskId),
      status,
      updated_at: stringOr(value.updated_at ?? value.updatedAt, new Date().toISOString()),
      completed,
      total,
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
    };
  }
  return Object.keys(next).length > 0 ? next : prev;
}

function normalizePacket(p: UpsertPayload, prev?: Packet): Packet {
  const mergedSigners = (() => {
    if (!p.signers) return prev?.signers ?? [];
    if (!prev) return p.signers;
    const seen = new Set(prev.signers.map((s) => s.name));
    return [...prev.signers, ...p.signers.filter((s) => !seen.has(s.name))];
  })();
  const status = p.status ? asStatus(p.status) : p.state ? asStatus(p.state) : prev?.status ?? 'draft';
  const target = normalizeTarget(p.target, prev?.target, p.target_profile ?? prev?.target_profile);
  const pin = normalizePin(p.pin, prev?.pin);
  const tasks = Array.isArray(p.tasks)
    ? p.tasks.map((task, index) => normalizeTask(task, index))
    : prev?.tasks ?? [];
  const approval = normalizeApproval(p.approval, prev?.approval, mergedSigners, status);
  const stateHistory = normalizeStateHistory(p.state_history, prev?.state_history);
  const orderHint =
    Array.isArray(p.order_hint) && p.order_hint.length > 0
      ? p.order_hint.filter((item): item is string => typeof item === 'string')
      : prev?.order_hint ?? tasks.map((task) => task.id);
  const executionProgress = normalizeExecutionProgress(p.execution_progress, prev?.execution_progress);
  const executionSessionId =
    p.execution_session_id !== undefined && p.execution_session_id !== null
      ? p.execution_session_id
      : p.executor_session_id !== undefined && p.executor_session_id !== null
        ? p.executor_session_id
        : prev?.execution_session_id ?? prev?.executor_session_id;
  const executionOutcome =
    isRecord(p.execution_outcome) ? p.execution_outcome : prev?.execution_outcome;
  const requiredSigners =
    p.required_signers ?? prev?.required_signers ?? (approval.two_party ? 2 : 1);
  return {
    id: p.packet_id,
    title: p.title ?? prev?.title ?? 'Untitled',
    ...(p.summary !== undefined ? { summary: p.summary } : prev?.summary !== undefined ? { summary: prev.summary } : {}),
    source_run_ids:
      Array.isArray(p.source_run_ids) && p.source_run_ids.length > 0
        ? p.source_run_ids.filter((id): id is string => typeof id === 'string')
        : prev?.source_run_ids ?? [],
    accepted_finding_ids:
      Array.isArray(p.accepted_finding_ids) && p.accepted_finding_ids.length > 0
        ? p.accepted_finding_ids.filter((id): id is string => typeof id === 'string')
        : prev?.accepted_finding_ids ?? [],
    created_by: p.created_by ?? prev?.created_by ?? 'unknown',
    created_at: p.created_at ?? prev?.created_at ?? new Date().toISOString(),
    pin,
    tasks,
    ...(orderHint.length > 0
      ? { order_hint: orderHint }
      : prev?.order_hint !== undefined
        ? { order_hint: prev.order_hint }
        : {}),
    target,
    approval,
    status,
    state: status,
    state_history: stateHistory.length > 0 ? stateHistory : prev?.state_history ?? [],
    signers: mergedSigners,
    required_signers: requiredSigners,
    ...(executionSessionId !== undefined ? { execution_session_id: executionSessionId } : {}),
    ...(executionProgress !== undefined ? { execution_progress: executionProgress } : {}),
    ...(executionOutcome !== undefined ? { execution_outcome: executionOutcome } : {}),
    ...(target.executor_profile_id ? { target_profile: target.executor_profile_id } : prev?.target_profile ? { target_profile: prev.target_profile } : {}),
    ...(executionSessionId !== undefined ? { executor_session_id: executionSessionId } : prev?.executor_session_id !== undefined ? { executor_session_id: prev.executor_session_id } : {}),
    convergence_count: p.convergence_count ?? prev?.convergence_count ?? 0,
    updated_at: p.updated_at ?? new Date().toISOString(),
  };
}

interface UpsertPayload {
  packet_id: string;
  title?: string;
  summary?: string;
  source_run_ids?: string[];
  accepted_finding_ids?: string[];
  created_by?: string;
  created_at?: string;
  target_profile?: string;
  target?: Packet['target'] | Record<string, unknown>;
  status?: string;
  state?: string;
  tasks?: Array<Record<string, unknown>>;
  pin?: HandoffPin | Record<string, unknown>;
  approval?: HandoffApproval | Record<string, unknown>;
  signers?: Signer[];
  required_signers?: number;
  execution_session_id?: string | null;
  executor_session_id?: string | null;
  execution_outcome?: Record<string, unknown> | null;
  execution_progress?: Record<string, unknown> | null;
  order_hint?: string[];
  state_history?: PacketStateHistoryEntry[] | Array<Record<string, unknown>>;
  convergence_count?: number;
  updated_at?: string;
}

interface StatusPayload {
  packet_id: string;
  status: string;
  reason?: string;
}

interface InvalidatedPayload {
  packet_id: string;
  reason: string;
  drift?: { expected: string; actual: string };
}

interface DispatchProgressPayload {
  packet_id: string;
  executor_session_id?: string;
  current_task?: string;
  task_id?: string;
  currentTask?: string;
  status?: string;
  completed: number;
  total: number;
  message?: string;
  reason?: string;
}

interface ExecutionTerminalPayload {
  packet_id: string;
  executor_session_id?: string;
  status?: string;
  outcome?: Record<string, unknown>;
  error?: string;
  reason?: string;
  message?: string;
  updated_at?: string;
}

interface ConvergencePayload {
  packet_id: string;
  cycles: number;
  last_persistent_regressed: number[];
}

export function registerHandoffHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('handoff.upserted', (ev) => {
      const p = ev.payload as UpsertPayload | null;
      if (!p?.packet_id) return;
      const prev = useHandoff.getState().packets.get(p.packet_id);
      useHandoff.getState().upsert(normalizePacket(p, prev));
    }),
  );

  offs.push(
    transport.on('handoff.status', (ev) => {
      const p = ev.payload as StatusPayload | null;
      if (!p?.packet_id) return;
      useHandoff.getState().setStatus(p.packet_id, asStatus(p.status));
    }),
  );

  offs.push(
    transport.on('handoff.invalidated', (ev) => {
      const p = ev.payload as InvalidatedPayload | null;
      if (!p?.packet_id) return;
      useHandoff.getState().setStatus(p.packet_id, 'invalidated');
      useNotify.getState().receive({
        id: `handoff_invalid_${p.packet_id}`,
        lane: 'sticky',
        severity: 'error',
        subsystem: 'handoff',
        title: 'Handoff invalidated',
        message: p.reason ?? 'pin drift detected — build a fresh packet',
        correlationId: p.packet_id,
        ts: new Date().toISOString(),
      });
    }),
  );

  offs.push(
    transport.on('handoff.dispatch_progress', (ev) => {
      const p = ev.payload as DispatchProgressPayload | null;
      if (!p?.packet_id) return;
      if (p.executor_session_id) {
        useHandoff.getState().setExecutorSession(p.packet_id, p.executor_session_id);
      }
      const task_id = p.task_id ?? p.current_task ?? p.currentTask;
      if (task_id) {
        useHandoff.getState().setExecutionProgress(p.packet_id, {
          task_id,
          status:
            p.status === 'pending' ||
            p.status === 'started' ||
            p.status === 'completed' ||
            p.status === 'failed'
              ? p.status
              : 'started',
          updated_at: new Date().toISOString(),
          completed: Number.isFinite(p.completed) ? Math.max(0, Math.floor(p.completed)) : 0,
          total: Number.isFinite(p.total) ? Math.max(0, Math.floor(p.total)) : 0,
          ...(typeof p.message === 'string' ? { message: p.message } : {}),
        });
      }
    }),
  );

  offs.push(
    transport.on('handoff.execution_progress', (ev) => {
      const p = ev.payload as DispatchProgressPayload | null;
      if (!p?.packet_id) return;
      if (p.executor_session_id) {
        useHandoff.getState().setExecutorSession(p.packet_id, p.executor_session_id);
      }
      const task_id = p.task_id ?? p.current_task ?? p.currentTask;
      if (task_id) {
        useHandoff.getState().setExecutionProgress(p.packet_id, {
          task_id,
          status:
            p.status === 'pending' ||
            p.status === 'started' ||
            p.status === 'completed' ||
            p.status === 'failed'
              ? p.status
              : 'started',
          updated_at: new Date().toISOString(),
          completed: Number.isFinite(p.completed) ? Math.max(0, Math.floor(p.completed)) : 0,
          total: Number.isFinite(p.total) ? Math.max(0, Math.floor(p.total)) : 0,
          ...(typeof p.message === 'string' ? { message: p.message } : {}),
        });
      }
    }),
  );

  offs.push(
    transport.on('handoff.completed', (ev) => {
      const p = ev.payload as ExecutionTerminalPayload | null;
      if (!p?.packet_id) return;
      if (p.executor_session_id) {
        useHandoff.getState().setExecutorSession(p.packet_id, p.executor_session_id);
      }
      useHandoff.getState().setExecutionOutcome(
        p.packet_id,
        'completed',
        isRecord(p.outcome) ? p.outcome : { status: 'success' },
      );
    }),
  );

  offs.push(
    transport.on('handoff.failed', (ev) => {
      const p = ev.payload as ExecutionTerminalPayload | null;
      if (!p?.packet_id) return;
      if (p.executor_session_id) {
        useHandoff.getState().setExecutorSession(p.packet_id, p.executor_session_id);
      }
      useHandoff.getState().setExecutionOutcome(
        p.packet_id,
        'failed',
        isRecord(p.outcome)
          ? p.outcome
          : {
              status: 'failed',
              tasks_completed: [],
              tasks_failed: [],
              changeset_summary: p.message ?? p.reason ?? p.error ?? 'execution failed',
            },
      );
    }),
  );

  offs.push(
    transport.on('handoff.convergence_stuck', (ev) => {
      const p = ev.payload as ConvergencePayload | null;
      if (!p?.packet_id) return;
      useHandoff.getState().incrementConvergence(p.packet_id);
      useNotify.getState().receive({
        id: `convergence_${p.packet_id}`,
        lane: 'sticky',
        severity: 'warn',
        subsystem: 'handoff',
        title: 'Convergence stuck',
        message: `Packet ${p.packet_id} has not improved across ${p.cycles} cycles.`,
        correlationId: p.packet_id,
        ts: new Date().toISOString(),
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
