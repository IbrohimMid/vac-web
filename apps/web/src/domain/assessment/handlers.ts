// Transport events → assessment store. Upstream VAC (PRs #6/#7) emits
// finding.emit + evidence.capture; the bridge re-tags these as
// `assessment.*` / `evidence.*` ServerEvents.

import {
  ASSESSOR_FAMILIES,
  useAssessment,
  type AssessorFamily,
  type Category,
  type ConnectorSnapshot,
  type Finding,
  type QueryAction,
  type Run,
  type RunProgress,
  type RunFailure,
  type Severity,
  type Verdict,
  type Sweep,
} from '../../stores/assessment';
import type { DiffResult } from '../../stores/assessmentDiff';
import type { TransportHandle } from '../../transport';
import { reasonFromAckCode, reasonLabel } from './queries';

function asSeverity(raw: string | undefined): Severity {
  if (raw === 'info' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'critical')
    return raw;
  return 'medium';
}

function asCategory(raw: string | undefined): Category {
  if (
    raw === 'technical' ||
    raw === 'product' ||
    raw === 'ux' ||
    raw === 'release' ||
    raw === 'ops'
  )
    return raw;
  return 'technical';
}

function asVerdict(raw: string | undefined): Verdict {
  if (raw === 'pass' || raw === 'warn' || raw === 'fail') return raw;
  return 'unknown';
}

interface StartedPayload {
  run_id: string;
  swarm: string;
  total_checks: number;
  started_at: string;
  scope?: {
    project_root: string;
    repo_ref?: string;
    base_commit_sha?: string;
    diff_range?: string;
    path_globs?: string[];
    depth?: string;
  };
  connector_snapshots?: Array<{
    connector_id: string;
    kind: string;
    snapshot_id: string;
    captured_at: string;
    etag?: string;
  }>;
}

interface ProgressPayload {
  run_id: string;
  completed: number;
  total: number;
  current?: string;
}

interface CandidateReceivedPayload {
  run_id: string;
  candidate_count?: number;
  candidate_hash?: string;
  source_event_type?: string;
  agent_id?: string;
}

interface CandidateRejectedPayload {
  run_id: string;
  candidate_hash?: string;
  reason?: string;
  summary?: string;
  source_event_type?: string;
  agent_id?: string;
}

interface FindingPayload {
  finding_id: string;
  identity_hash: string;
  run_id: string;
  category: string | undefined;
  subject: string;
  check: string;
  severity: string | undefined;
  confidence: number | undefined;
  title: string;
  summary: string;
  evidence_ids?: string[];
  emitted_at: string;
}

interface EvidencePayload {
  id: string;
  connector: string;
  kind: string;
  label: string;
  captured_at: string;
  ttl_seconds: number;
  preview?: string;
  uri?: string;
  locator?: Record<string, unknown>;
  connector_id?: string;
  snapshot_id?: string;
  digest?: string;
  source_etag?: string;
  observed_at?: string;
  fresh_until?: string;
  staleness_policy?: string;
  captured_by?: string;
  captured_snapshot_id?: string;
  size?: number;
  mime_type?: string;
}

interface EvidencePreviewPayload {
  id: string;
  preview: string;
}

interface CompletedPayload {
  run_id: string;
  verdict?: string;
  score?: Partial<Record<Category, number>>;
}

function readFindingPayload(ev: unknown): FindingPayload | null {
  const p = ev as Record<string, unknown> | null;
  if (!p) return null;
  const raw = (p.finding as Record<string, unknown> | undefined) ?? p;
  if (!raw || typeof raw !== 'object') return null;
  const finding_id =
    typeof raw.finding_id === 'string'
      ? raw.finding_id
      : typeof raw.findingId === 'string'
        ? raw.findingId
        : '';
  const identity_hash =
    typeof raw.identity_hash === 'string'
      ? raw.identity_hash
      : typeof raw.identityHash === 'string'
        ? raw.identityHash
        : '';
  const run_id =
    typeof raw.run_id === 'string'
      ? raw.run_id
      : typeof raw.runId === 'string'
        ? raw.runId
        : '';
  if (!finding_id || !identity_hash || !run_id) return null;
  return {
    finding_id,
    identity_hash,
    run_id,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    check: typeof raw.check === 'string' ? raw.check : '',
    severity: typeof raw.severity === 'string' ? raw.severity : undefined,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
    title: typeof raw.title === 'string' ? raw.title : '',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    evidence_ids: Array.isArray(raw.evidence_ids)
      ? raw.evidence_ids.filter((id): id is string => typeof id === 'string')
      : Array.isArray(raw.evidenceIds)
        ? raw.evidenceIds.filter((id): id is string => typeof id === 'string')
        : [],
    emitted_at:
      typeof raw.emitted_at === 'string'
        ? raw.emitted_at
        : typeof raw.emittedAt === 'string'
          ? raw.emittedAt
          : new Date().toISOString(),
  };
}

function readEvidencePayload(ev: unknown): EvidencePayload | null {
  const p = ev as Record<string, unknown> | null;
  if (!p) return null;
  const raw = (p.evidence as Record<string, unknown> | undefined) ?? p;
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) return null;
  return {
    id,
    connector: typeof raw.connector === 'string' ? raw.connector : 'unknown',
    kind: typeof raw.kind === 'string' ? raw.kind : 'file',
    label: typeof raw.label === 'string' ? raw.label : '',
    captured_at:
      typeof raw.captured_at === 'string'
        ? raw.captured_at
        : typeof raw.capturedAt === 'string'
          ? raw.capturedAt
          : new Date().toISOString(),
    ttl_seconds:
      typeof raw.ttl_seconds === 'number'
        ? raw.ttl_seconds
        : typeof raw.ttlSeconds === 'number'
          ? raw.ttlSeconds
          : 0,
    ...(typeof raw.preview === 'string' ? { preview: raw.preview } : {}),
    ...(typeof raw.uri === 'string' ? { uri: raw.uri } : {}),
    ...(raw.locator && typeof raw.locator === 'object' ? { locator: raw.locator as Record<string, unknown> } : {}),
    ...(typeof raw.connector_id === 'string' ? { connector_id: raw.connector_id } : {}),
    ...(typeof raw.snapshot_id === 'string' ? { snapshot_id: raw.snapshot_id } : {}),
    ...(typeof raw.digest === 'string' ? { digest: raw.digest } : {}),
    ...(typeof raw.source_etag === 'string' ? { source_etag: raw.source_etag } : {}),
    ...(typeof raw.observed_at === 'string' ? { observed_at: raw.observed_at } : {}),
    ...(typeof raw.fresh_until === 'string' ? { fresh_until: raw.fresh_until } : {}),
    ...(typeof raw.staleness_policy === 'string' ? { staleness_policy: raw.staleness_policy } : {}),
    ...(typeof raw.captured_by === 'string' ? { captured_by: raw.captured_by } : {}),
    ...(typeof raw.captured_snapshot_id === 'string' ? { captured_snapshot_id: raw.captured_snapshot_id } : {}),
    ...(typeof raw.size === 'number' ? { size: raw.size } : {}),
    ...(typeof raw.mime_type === 'string' ? { mime_type: raw.mime_type } : {}),
  };
}

function readCount(raw: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  return 1;
}

function readOptionalNumber(raw: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  return undefined;
}

function readString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function readRunMeta(raw: Record<string, unknown>): {
  agent_id?: string;
  agent_kind?: string;
  agent_role?: string;
  worker_session_id?: string;
  sweep_id?: string;
} {
  const meta: {
    agent_id?: string;
    agent_kind?: string;
    agent_role?: string;
    worker_session_id?: string;
    sweep_id?: string;
  } = {};
  const agentId = readString(raw, ['agent_id', 'agentId']);
  if (agentId) meta.agent_id = agentId;
  const agentKind = readString(raw, ['agent_kind', 'agentKind']);
  if (agentKind) meta.agent_kind = agentKind;
  const agentRole = readString(raw, ['agent_role', 'agentRole']);
  if (agentRole) meta.agent_role = agentRole;
  const workerSessionId = readString(raw, ['worker_session_id', 'workerSessionId']);
  if (workerSessionId) meta.worker_session_id = workerSessionId;
  const sweepId = readString(raw, ['sweep_id', 'sweepId']);
  if (sweepId) meta.sweep_id = sweepId;
  return meta;
}

function readVerdictDetail(raw: Record<string, unknown>): {
  status: string;
  delivery_state?: string;
  reason?: string;
  counts?: Record<string, number>;
} | undefined {
  const detail = raw.verdict_detail ?? raw.verdictDetail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  const d = detail as Record<string, unknown>;
  const counts = d.counts;
  const verdictDetail: {
    status: string;
    delivery_state?: string;
    reason?: string;
    counts?: Record<string, number>;
  } = {
    status: readString(d, ['status']) ?? 'UNKNOWN',
  };
  const deliveryState = readString(d, ['delivery_state', 'deliveryState']);
  if (deliveryState) verdictDetail.delivery_state = deliveryState;
  const reason = readString(d, ['reason']);
  if (reason) verdictDetail.reason = reason;
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
    verdictDetail.counts = counts as Record<string, number>;
  }
  return verdictDetail;
}

function readStringArray(raw: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = raw[key];
    if (!Array.isArray(value)) continue;
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return [];
}

function asFamily(raw: string | undefined): AssessorFamily {
  return raw && ASSESSOR_FAMILIES.includes(raw as AssessorFamily) ? (raw as AssessorFamily) : 'rtd';
}

function asRunStatus(raw: string | undefined): Run['status'] {
  if (raw === 'queued' || raw === 'running' || raw === 'completed' || raw === 'cancelled' || raw === 'failed')
    return raw;
  return 'running';
}

function readValidationStats(raw: Record<string, unknown>): {
  received: number;
  rejected: number;
  rejection_reasons: Record<string, number>;
} {
  const received = readOptionalNumber(raw, ['received']) ?? 0;
  const rejected = readOptionalNumber(raw, ['rejected']) ?? 0;
  const rejectionReasonsRaw = raw.rejection_reasons ?? raw.rejectionReasons;
  const rejection_reasons: Record<string, number> = {};
  if (rejectionReasonsRaw && typeof rejectionReasonsRaw === 'object' && !Array.isArray(rejectionReasonsRaw)) {
    for (const [key, value] of Object.entries(rejectionReasonsRaw as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        rejection_reasons[key] = Math.max(0, Math.floor(value));
      }
    }
  }
  return { received, rejected, rejection_reasons };
}

function readProgressRecord(raw: Record<string, unknown>): RunProgress {
  const progress: RunProgress = {
    completed: readOptionalNumber(raw, ['completed']) ?? 0,
    total: readOptionalNumber(raw, ['total']) ?? 0,
  };
  const current = readString(raw, ['current']);
  if (current) progress.current = current;
  const phase = readString(raw, ['phase']);
  if (phase) progress.phase = phase;
  const pass = readOptionalNumber(raw, ['pass']);
  if (pass !== undefined) progress.pass = pass;
  const maxPasses = readOptionalNumber(raw, ['max_passes', 'maxPasses']);
  if (maxPasses !== undefined) progress.max_passes = maxPasses;
  const reason = readString(raw, ['reason']);
  if (reason) progress.reason = reason;
  const elapsed = readOptionalNumber(raw, ['elapsed_ms', 'elapsedMs']);
  if (elapsed !== undefined) progress.elapsed_ms = elapsed;
  return progress;
}

function readFindingRecord(raw: unknown): Finding | null {
  const p = readFindingPayload(raw);
  if (!p) return null;
  return {
    id: p.finding_id,
    identity_hash: p.identity_hash,
    run_id: p.run_id,
    category: asCategory(p.category),
    subject: p.subject,
    check: p.check,
    severity: asSeverity(p.severity),
    confidence: p.confidence ?? 0.8,
    title: p.title,
    summary: p.summary,
    evidence_ids: p.evidence_ids ?? [],
    emitted_at: p.emitted_at,
  };
}

function readRunRecord(raw: unknown): Run | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const id = readString(p, ['id', 'run_id', 'runId']);
  if (!id) return null;
  const started_at = readString(p, ['started_at', 'startedAt']) ?? new Date().toISOString();
  const meta = readRunMeta(p);
  const progressRaw = p.progress as Record<string, unknown> | undefined;
  const validationRaw = p.validation as Record<string, unknown> | undefined;
  const scopeRaw = p.scope as Record<string, unknown> | undefined;
  const scoreRaw = p.score as Record<string, unknown> | undefined;
  const connectorSnapshotsRaw = Array.isArray(p.connector_snapshots)
    ? p.connector_snapshots
    : Array.isArray(p.connectorSnapshots)
      ? p.connectorSnapshots
      : [];
  const failureRaw = p.failure as Record<string, unknown> | undefined;
  const agentId = readString(p, ['agent_id', 'agentId']);
  const agentKind = readString(p, ['agent_kind', 'agentKind']);
  const agentRole = readString(p, ['agent_role', 'agentRole']);
  const workerSessionId = readString(p, ['worker_session_id', 'workerSessionId']);
  const failureDetail = failureRaw ? readString(failureRaw, ['detail']) : undefined;
  const finishedAt = readString(p, ['finished_at', 'finishedAt']);
  const verdict = readString(p, ['verdict']);
  const verdictDetail = readVerdictDetail(p as Record<string, unknown>);
  return {
    id,
    swarm: asFamily(readString(p, ['swarm'])),
    status: asRunStatus(readString(p, ['status'])),
    started_at,
    ...(finishedAt !== undefined ? { finished_at: finishedAt } : {}),
    ...(meta.sweep_id ? { sweep_id: meta.sweep_id } : {}),
    progress: progressRaw ? readProgressRecord(progressRaw) : { completed: 0, total: 0 },
    ...(verdict ? { verdict: asVerdict(verdict) } : {}),
    ...(scoreRaw
      ? {
          score: {
            technical: typeof scoreRaw.technical === 'number' ? scoreRaw.technical : 0,
            product: typeof scoreRaw.product === 'number' ? scoreRaw.product : 0,
            ux: typeof scoreRaw.ux === 'number' ? scoreRaw.ux : 0,
            release: typeof scoreRaw.release === 'number' ? scoreRaw.release : 0,
            ops: typeof scoreRaw.ops === 'number' ? scoreRaw.ops : 0,
          },
        }
      : {}),
    ...(validationRaw
      ? {
          validation: readValidationStats(validationRaw),
        }
      : {}),
    ...(scopeRaw
      ? {
          scope: {
            project_root: typeof scopeRaw.project_root === 'string' ? scopeRaw.project_root : '',
            ...(typeof scopeRaw.repo_ref === 'string' ? { repo_ref: scopeRaw.repo_ref } : {}),
            ...(typeof scopeRaw.base_commit_sha === 'string'
              ? { base_commit_sha: scopeRaw.base_commit_sha }
              : {}),
            ...(typeof scopeRaw.diff_range === 'string' ? { diff_range: scopeRaw.diff_range } : {}),
            ...(Array.isArray(scopeRaw.path_globs)
              ? {
                  path_globs: scopeRaw.path_globs.filter(
                    (item): item is string => typeof item === 'string',
                  ),
                }
              : {}),
            ...(typeof scopeRaw.depth === 'string' ? { depth: scopeRaw.depth } : {}),
          },
        }
      : {}),
    ...(Array.isArray(connectorSnapshotsRaw)
      ? {
          connector_snapshots: connectorSnapshotsRaw
            .map((snapshot): ConnectorSnapshot | null => {
              if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
              const s = snapshot as Record<string, unknown>;
              const connectorId = typeof s.connector_id === 'string' ? s.connector_id : '';
              const kind = typeof s.kind === 'string' ? s.kind : '';
              const snapshotId = typeof s.snapshot_id === 'string' ? s.snapshot_id : '';
              const capturedAt = typeof s.captured_at === 'string' ? s.captured_at : '';
              if (!connectorId || !kind || !snapshotId || !capturedAt) return null;
              return {
                connector_id: connectorId,
                kind,
                snapshot_id: snapshotId,
                captured_at: capturedAt,
                ...(typeof s.etag === 'string' ? { etag: s.etag } : {}),
              };
            })
            .filter((item): item is ConnectorSnapshot => item !== null),
        }
      : {}),
    ...(agentId !== undefined ? { agent_id: agentId } : {}),
    ...(agentKind !== undefined ? { agent_kind: agentKind } : {}),
    ...(agentRole !== undefined ? { agent_role: agentRole } : {}),
    ...(workerSessionId !== undefined ? { worker_session_id: workerSessionId } : {}),
    ...(failureRaw
      ? {
          failure: {
            status: asRunFailureStatus(readString(failureRaw, ['status'])),
            reason: readString(failureRaw, ['reason']) ?? 'assessment_failed',
            ...(failureDetail !== undefined ? { detail: failureDetail } : {}),
          },
        }
      : {}),
    ...(verdictDetail ? { verdict_detail: verdictDetail } : {}),
  };
}

function asRunFailureStatus(raw: string | undefined): RunFailure['status'] {
  return raw === 'cancelled' ? 'cancelled' : 'failed';
}

function readSweepRecord(raw: unknown): Sweep | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const id = readString(p, ['id', 'sweep_id', 'sweepId']);
  if (!id) return null;
  const started_at = readString(p, ['started_at', 'startedAt']) ?? new Date().toISOString();
  const progressRaw = p.progress as Record<string, unknown> | undefined;
  const verdictDetail = readVerdictDetail(p);
  const runIds = readStringArray(p, ['run_ids', 'runIds']);
  const families = readStringArray(p, ['families']).map((family) => asFamily(family));
  const failureRaw = p.failure as Record<string, unknown> | undefined;
  const agentId = readString(p, ['agent_id', 'agentId']);
  const agentKind = readString(p, ['agent_kind', 'agentKind']);
  const agentRole = readString(p, ['agent_role', 'agentRole']);
  const failureDetail = failureRaw ? readString(failureRaw, ['detail']) : undefined;
  const countsRaw = p.counts as Record<string, unknown> | undefined;
  const finishedAt = readString(p, ['finished_at', 'finishedAt']);
  const counts: Record<string, number> | undefined = countsRaw
    ? Object.fromEntries(
        Object.entries(countsRaw)
          .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
          .map(([key, value]) => [key, Math.max(0, Math.floor(value as number))]),
      )
    : undefined;
  return {
    id,
    families,
    status: asRunStatus(readString(p, ['status'])),
    started_at,
    ...(finishedAt !== undefined ? { finished_at: finishedAt } : {}),
    progress: progressRaw ? readProgressRecord(progressRaw) : readProgressRecord(p),
    ...(verdictDetail ? { verdict_detail: verdictDetail } : {}),
    ...(counts ? { counts } : {}),
    run_ids: runIds,
    ...(p.scope && typeof p.scope === 'object' && !Array.isArray(p.scope)
      ? {
          scope: {
            project_root: typeof (p.scope as Record<string, unknown>).project_root === 'string'
              ? ((p.scope as Record<string, unknown>).project_root as string)
              : '',
            ...(typeof (p.scope as Record<string, unknown>).repo_ref === 'string'
              ? { repo_ref: (p.scope as Record<string, unknown>).repo_ref as string }
              : {}),
            ...(typeof (p.scope as Record<string, unknown>).base_commit_sha === 'string'
              ? {
                  base_commit_sha: (p.scope as Record<string, unknown>).base_commit_sha as string,
                }
              : {}),
            ...(typeof (p.scope as Record<string, unknown>).diff_range === 'string'
              ? { diff_range: (p.scope as Record<string, unknown>).diff_range as string }
              : {}),
            ...(Array.isArray((p.scope as Record<string, unknown>).path_globs)
              ? {
                  path_globs: ((p.scope as Record<string, unknown>).path_globs as unknown[]).filter(
                    (item): item is string => typeof item === 'string',
                  ),
                }
              : {}),
            ...(typeof (p.scope as Record<string, unknown>).depth === 'string'
              ? { depth: (p.scope as Record<string, unknown>).depth as string }
              : {}),
          },
        }
      : {}),
    ...(agentId !== undefined ? { agent_id: agentId } : {}),
    ...(agentKind !== undefined ? { agent_kind: agentKind } : {}),
    ...(agentRole !== undefined ? { agent_role: agentRole } : {}),
    ...(failureRaw
      ? {
          failure: {
            status: asRunFailureStatus(readString(failureRaw, ['status'])),
            reason: readString(failureRaw, ['reason']) ?? 'sweep_failed',
            ...(failureDetail !== undefined ? { detail: failureDetail } : {}),
          },
        }
      : {}),
  };
}

function readNumberMap(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.max(0, Math.floor(value));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function hydrateAssessmentList(payload: Record<string, unknown>): void {
  const store = useAssessment.getState();
  const runs = Array.isArray(payload.runs) ? payload.runs : [];
  const sweeps = Array.isArray(payload.sweeps) ? payload.sweeps : [];
  for (const raw of runs) {
    const run = readRunRecord(raw);
    if (run) store.upsertRun(run);
  }
  for (const raw of sweeps) {
    const sweep = readSweepRecord(raw);
    if (sweep) store.upsertSweep(sweep);
  }
  const activeRunId = readString(payload, ['active_run_id', 'activeRunId']);
  if (activeRunId) store.setActive(activeRunId);
  const activeSweepId = readString(payload, ['active_sweep_id', 'activeSweepId']);
  if (activeSweepId) store.setActiveSweep(activeSweepId);
}

function hydrateAssessmentReport(payload: Record<string, unknown>): void {
  const store = useAssessment.getState();
  const run = readRunRecord(payload.run ?? payload);
  if (run) {
    store.upsertRun(run);
    store.setActive(run.id);
    if (run.sweep_id) store.setActiveSweep(run.sweep_id);
  }
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  for (const raw of findings) {
    const finding = readFindingRecord(raw);
    if (finding) store.emitFinding(finding);
  }
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  for (const raw of evidence) {
    const ref = readEvidencePayload(raw);
    if (!ref?.id) continue;
    store.upsertEvidence({
      id: ref.id,
      connector: ref.connector,
      kind: ref.kind,
      label: ref.label,
      captured_at: ref.captured_at,
      ttl_seconds: ref.ttl_seconds,
      ...(ref.preview !== undefined ? { preview: ref.preview } : {}),
      ...(ref.uri !== undefined ? { uri: ref.uri } : {}),
      ...(ref.locator !== undefined ? { locator: ref.locator } : {}),
      ...(ref.connector_id !== undefined ? { connector_id: ref.connector_id } : {}),
      ...(ref.snapshot_id !== undefined ? { snapshot_id: ref.snapshot_id } : {}),
      ...(ref.digest !== undefined ? { digest: ref.digest } : {}),
      ...(ref.source_etag !== undefined ? { source_etag: ref.source_etag } : {}),
      ...(ref.observed_at !== undefined ? { observed_at: ref.observed_at } : {}),
      ...(ref.fresh_until !== undefined ? { fresh_until: ref.fresh_until } : {}),
      ...(ref.staleness_policy !== undefined
        ? { staleness_policy: ref.staleness_policy as 'hard_expire' | 'warn_only' | 'immutable' }
        : {}),
      ...(ref.captured_by !== undefined ? { captured_by: ref.captured_by } : {}),
      ...(ref.captured_snapshot_id !== undefined ? { captured_snapshot_id: ref.captured_snapshot_id } : {}),
      ...(ref.size !== undefined ? { size: ref.size } : {}),
      ...(ref.mime_type !== undefined ? { mime_type: ref.mime_type } : {}),
    });
  }
  const sweep = readSweepRecord(payload.sweep);
  if (sweep) {
    store.upsertSweep(sweep);
    store.setActiveSweep(sweep.id);
  }
}

function hydrateAssessmentDiff(payload: Record<string, unknown>): void {
  const baseRunId = readString(payload, ['base_run_id', 'baseRunId']);
  const nextRunId = readString(payload, ['next_run_id', 'nextRunId']);
  if (!baseRunId || !nextRunId) return;

  const store = useAssessment.getState();
  const baseRun = readRunRecord(payload.base_run ?? payload.baseRun);
  const nextRun = readRunRecord(payload.next_run ?? payload.nextRun);
  if (baseRun) store.upsertRun(baseRun);
  if (nextRun) {
    store.upsertRun(nextRun);
    store.setActive(nextRun.id);
  }

  const entriesRaw = Array.isArray(payload.entries) ? payload.entries : [];
  const entries = entriesRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const raw = entry as Record<string, unknown>;
      const identityHash = readString(raw, ['identity_hash', 'identityHash']);
      if (!identityHash) return null;
      const bucket = readString(raw, ['bucket']) ?? 'persistent';
      const prev = readFindingRecord(raw.prev);
      const next = readFindingRecord(raw.next);
      return {
        bucket,
        identity_hash: identityHash,
        ...(prev ? { prev } : {}),
        ...(next ? { next } : {}),
      };
    })
    .filter(
      (entry): entry is {
        bucket: string;
        identity_hash: string;
        prev?: Finding;
        next?: Finding;
      } => entry !== null,
    );

  const counts = readNumberMap(payload.counts) ?? {
    resolved: 0,
    persistent: 0,
    regressed: 0,
    new: 0,
  };
  store.upsertDiff(baseRunId, nextRunId, { entries, counts } as DiffResult);
}

export function registerAssessmentHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('assessment.started', (ev) => {
      const p = ev.payload as StartedPayload | null;
      if (!p?.run_id) return;
      const swarm = asFamily(p.swarm) as Run['swarm'];
      const meta = readRunMeta(p as unknown as Record<string, unknown>);
      const run: Run = {
        id: p.run_id,
        swarm,
        status: 'running',
        started_at: p.started_at,
        progress: { completed: 0, total: p.total_checks },
        validation: {
          received: 0,
          rejected: 0,
          rejection_reasons: {},
        },
        ...(meta.sweep_id !== undefined ? { sweep_id: meta.sweep_id } : {}),
        ...(meta.agent_id !== undefined ? { agent_id: meta.agent_id } : {}),
        ...(meta.agent_kind !== undefined ? { agent_kind: meta.agent_kind } : {}),
        ...(meta.agent_role !== undefined ? { agent_role: meta.agent_role } : {}),
        ...(meta.worker_session_id !== undefined
          ? { worker_session_id: meta.worker_session_id }
          : {}),
        ...(p.scope
          ? {
              scope: {
                project_root: p.scope.project_root,
                ...(p.scope.repo_ref !== undefined ? { repo_ref: p.scope.repo_ref } : {}),
                ...(p.scope.base_commit_sha !== undefined
                  ? { base_commit_sha: p.scope.base_commit_sha }
                  : {}),
                ...(p.scope.diff_range !== undefined ? { diff_range: p.scope.diff_range } : {}),
                ...(p.scope.path_globs !== undefined ? { path_globs: p.scope.path_globs } : {}),
                ...(p.scope.depth !== undefined ? { depth: p.scope.depth } : {}),
              },
            }
          : {}),
        ...(p.connector_snapshots
          ? {
              connector_snapshots: p.connector_snapshots.map((snapshot) => ({
                connector_id: snapshot.connector_id,
                kind: snapshot.kind,
                snapshot_id: snapshot.snapshot_id,
                captured_at: snapshot.captured_at,
                ...(snapshot.etag !== undefined ? { etag: snapshot.etag } : {}),
              })),
            }
          : {}),
      };
      useAssessment.getState().upsertRun(run);
    }),
  );

  offs.push(
    transport.on('assessment.progress', (ev) => {
      const p = ev.payload as ProgressPayload | null;
      if (!p?.run_id) return;
      const raw = p as unknown as Record<string, unknown>;
      const phase = readString(raw, ['phase']);
      const reason = readString(raw, ['reason']);
      const pass = readOptionalNumber(raw, ['pass']);
      const maxPasses = readOptionalNumber(raw, ['max_passes', 'maxPasses']);
      const elapsedMs = readOptionalNumber(raw, ['elapsed_ms', 'elapsedMs']);
      useAssessment.getState().setProgress(p.run_id, {
        completed: p.completed,
        total: p.total,
        ...(p.current !== undefined ? { current: p.current } : {}),
        ...(phase !== undefined ? { phase } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(pass !== undefined ? { pass } : {}),
        ...(maxPasses !== undefined ? { max_passes: maxPasses } : {}),
        ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
      });
    }),
  );

  offs.push(
    transport.on('assessment.candidate_received', (ev) => {
      const p = ev.payload as CandidateReceivedPayload | null;
      if (!p?.run_id) return;
      useAssessment.getState().recordCandidateReceived(
        p.run_id,
        readCount(p as unknown as Record<string, unknown>, ['candidate_count', 'candidateCount']),
      );
    }),
  );

  offs.push(
    transport.on('assessment.candidate_rejected', (ev) => {
      const p = ev.payload as CandidateRejectedPayload | null;
      if (!p?.run_id) return;
      useAssessment
        .getState()
        .recordCandidateRejected(p.run_id, p.reason ?? p.summary ?? 'unknown');
    }),
  );

  const handleFinding = (ev: { payload: unknown }) => {
    const p = readFindingPayload(ev.payload);
    if (!p) return;
    const finding: Finding = {
      id: p.finding_id,
      identity_hash: p.identity_hash,
      run_id: p.run_id,
      category: asCategory(p.category),
      subject: p.subject,
      check: p.check,
      severity: asSeverity(p.severity),
      confidence: p.confidence ?? 0.8,
      title: p.title,
      summary: p.summary,
      evidence_ids: p.evidence_ids ?? [],
      emitted_at: p.emitted_at,
    };
    useAssessment.getState().emitFinding(finding);
  };

  offs.push(transport.on('assessment.finding_added', handleFinding));
  offs.push(transport.on('assessment.finding', handleFinding));

  const handleEvidence = (ev: { payload: unknown }) => {
    const p = readEvidencePayload(ev.payload);
    if (!p?.id) return;
    useAssessment.getState().upsertEvidence({
      id: p.id,
      connector: p.connector,
      kind: p.kind,
      label: p.label,
      captured_at: p.captured_at,
      ttl_seconds: p.ttl_seconds,
      ...(p.uri !== undefined ? { uri: p.uri } : {}),
      ...(p.locator !== undefined ? { locator: p.locator } : {}),
      ...(p.connector_id !== undefined ? { connector_id: p.connector_id } : {}),
      ...(p.snapshot_id !== undefined ? { snapshot_id: p.snapshot_id } : {}),
      ...(p.digest !== undefined ? { digest: p.digest } : {}),
      ...(p.source_etag !== undefined ? { source_etag: p.source_etag } : {}),
      ...(p.observed_at !== undefined ? { observed_at: p.observed_at } : {}),
      ...(p.fresh_until !== undefined ? { fresh_until: p.fresh_until } : {}),
      ...(p.staleness_policy !== undefined
        ? { staleness_policy: p.staleness_policy as 'hard_expire' | 'warn_only' | 'immutable' }
        : {}),
      ...(p.captured_by !== undefined ? { captured_by: p.captured_by } : {}),
      ...(p.captured_snapshot_id !== undefined ? { captured_snapshot_id: p.captured_snapshot_id } : {}),
      ...(p.size !== undefined ? { size: p.size } : {}),
      ...(p.mime_type !== undefined ? { mime_type: p.mime_type } : {}),
    });
  };

  offs.push(transport.on('assessment.evidence_attached', handleEvidence));
  offs.push(transport.on('assessment.evidence', handleEvidence));

  offs.push(
    transport.on('assessment.evidence_preview', (ev) => {
      const p = ev.payload as EvidencePreviewPayload | null;
      if (!p?.id || typeof p.preview !== 'string') return;
      useAssessment.getState().setEvidencePreview(p.id, p.preview);
    }),
  );

  offs.push(
    transport.on('assessment.completed', (ev) => {
      const p = ev.payload as CompletedPayload | null;
      if (!p?.run_id) return;
      const verdict = asVerdict(p.verdict);
      const score: Record<Category, number> = {
        technical: p.score?.technical ?? 0,
        product: p.score?.product ?? 0,
        ux: p.score?.ux ?? 0,
        release: p.score?.release ?? 0,
        ops: p.score?.ops ?? 0,
      };
      const meta = readRunMeta(p as unknown as Record<string, unknown>);
      const verdictDetail = readVerdictDetail(p as unknown as Record<string, unknown>);
      useAssessment.getState().completeRun(p.run_id, verdict, score, {
        ...(verdictDetail ? { verdict_detail: verdictDetail } : {}),
        ...(meta.agent_id !== undefined ? { agent_id: meta.agent_id } : {}),
        ...(meta.agent_kind !== undefined ? { agent_kind: meta.agent_kind } : {}),
        ...(meta.agent_role !== undefined ? { agent_role: meta.agent_role } : {}),
        ...(meta.worker_session_id !== undefined
          ? { worker_session_id: meta.worker_session_id }
          : {}),
      });
    }),
  );

  offs.push(
    transport.on('assessment.failed', (ev) => {
      const p = ev.payload as
        | (Record<string, unknown> & {
            run_id?: string;
            status?: string;
            reason?: string;
            detail?: string;
          })
        | null;
      if (!p?.run_id) return;
      const meta = readRunMeta(p);
      const status = p.status === 'cancelled' ? 'cancelled' : 'failed';
      useAssessment.getState().failRun(
        p.run_id,
        status,
        readString(p, ['reason']) ?? 'assessment_failed',
        readString(p, ['detail']),
        {
          ...(meta.agent_id !== undefined ? { agent_id: meta.agent_id } : {}),
          ...(meta.agent_kind !== undefined ? { agent_kind: meta.agent_kind } : {}),
          ...(meta.agent_role !== undefined ? { agent_role: meta.agent_role } : {}),
          ...(meta.worker_session_id !== undefined
            ? { worker_session_id: meta.worker_session_id }
            : {}),
        },
      );
    }),
  );

  // N3: backend emits `assessment.worker_output_rejected` BEFORE the
  // terminal `assessment.failed { reason: 'invalid_worker_output' }`.
  // Surface it on a dedicated store slice so the run-detail UI can show a
  // "Worker output rejected" banner with a Replay action — NOT the
  // queryErrors Retry banner. The two failure modes are different
  // categories: queryErrors are recoverable read-side failures (the run
  // exists; just couldn't fetch right now); worker_output_rejected means
  // the worker contract itself is broken and a Retry would just hit the
  // same broken envelope again.
  offs.push(
    transport.on('assessment.worker_output_rejected', (ev) => {
      const p = (ev.payload as Record<string, unknown> | null) ?? null;
      if (!p) return;
      const runId = readString(p, ['run_id', 'runId']);
      if (!runId) return;
      const meta = readRunMeta(p);
      const reason = readString(p, ['reason']) ?? 'schema_invalid';
      const code = readString(p, ['code']) ?? 'unknown';
      const detail = readString(p, ['detail', 'message']) ?? 'Worker output rejected.';
      const path = readString(p, ['path']);
      const sample = readString(p, ['sample']);
      const passRaw = p['pass'];
      const maxPassesRaw = p['max_passes'] ?? p['maxPasses'];
      const pass = typeof passRaw === 'number' ? passRaw : undefined;
      const maxPasses = typeof maxPassesRaw === 'number' ? maxPassesRaw : undefined;
      useAssessment.getState().recordWorkerOutputRejection({
        run_id: runId,
        ...(meta.worker_session_id !== undefined
          ? { worker_session_id: meta.worker_session_id }
          : {}),
        ...(meta.agent_id !== undefined ? { agent_id: meta.agent_id } : {}),
        ...(meta.agent_kind !== undefined ? { agent_kind: meta.agent_kind } : {}),
        ...(meta.agent_role !== undefined ? { agent_role: meta.agent_role } : {}),
        reason,
        code,
        detail,
        ...(path !== undefined ? { path } : {}),
        ...(pass !== undefined ? { pass } : {}),
        ...(maxPasses !== undefined ? { max_passes: maxPasses } : {}),
        ...(sample !== undefined ? { sample } : {}),
        ts: new Date().toISOString(),
      });
    }),
  );

  offs.push(
    transport.on('assessment.sweep.started', (ev) => {
      const sweep = readSweepRecord(ev.payload);
      if (!sweep) return;
      useAssessment.getState().upsertSweep(sweep);
    }),
  );

  offs.push(
    transport.on('assessment.sweep.progress', (ev) => {
      const payload = ev.payload as Record<string, unknown> | null;
      if (!payload) return;
      const sweepId = readString(payload, ['sweep_id', 'sweepId']);
      if (!sweepId) return;
      const progress = readProgressRecord(payload);
      useAssessment.getState().setSweepProgress(sweepId, progress);
      const verdict = readString(payload, ['verdict']);
      if (verdict === 'pass' || verdict === 'warn' || verdict === 'fail') {
        const sweep = readSweepRecord(payload);
        if (sweep) useAssessment.getState().upsertSweep(sweep);
      }
    }),
  );

  offs.push(
    transport.on('assessment.sweep.completed', (ev) => {
      const sweep = readSweepRecord(ev.payload);
      if (!sweep) return;
      useAssessment.getState().upsertSweep(sweep);
    }),
  );

  offs.push(
    transport.on('assessment.sweep.failed', (ev) => {
      const sweep = readSweepRecord(ev.payload);
      if (!sweep) return;
      useAssessment.getState().upsertSweep(sweep);
    }),
  );

  offs.push(
    transport.on('assessment.runs_listed', (ev) => {
      const payload = ev.payload as Record<string, unknown> | null;
      if (!payload) return;
      hydrateAssessmentList(payload);
    }),
  );

  offs.push(
    transport.on('assessment.report_fetched', (ev) => {
      const payload = ev.payload as Record<string, unknown> | null;
      if (!payload) return;
      hydrateAssessmentReport(payload);
    }),
  );

  offs.push(
    transport.on('assessment.replayed', (ev) => {
      const payload = ev.payload as Record<string, unknown> | null;
      if (!payload) return;
      hydrateAssessmentReport(payload);
    }),
  );

  offs.push(
    transport.on('assessment.diffed', (ev) => {
      const payload = ev.payload as Record<string, unknown> | null;
      if (!payload) return;
      hydrateAssessmentDiff(payload);
    }),
  );

  // P2: backend may emit a follow-up `assessment.query_failed` event after
  // accepting a command but failing during background execution (e.g. event
  // log truncation). Surface that as a queryError so the UI can render a
  // banner with a Retry CTA, mirroring the synchronous ack failure path.
  offs.push(
    transport.on('assessment.query_failed', (ev) => {
      const payload = (ev.payload as Record<string, unknown> | null) ?? null;
      if (!payload) return;
      const action = (payload['action'] ?? payload['kind']) as QueryAction | undefined;
      if (!action) return;
      const code = typeof payload['code'] === 'string' ? (payload['code'] as string) : undefined;
      const message =
        typeof payload['message'] === 'string'
          ? (payload['message'] as string)
          : reasonLabel('event_log_truncated');
      const targetId =
        typeof payload['target_id'] === 'string'
          ? (payload['target_id'] as string)
          : typeof payload['run_id'] === 'string'
            ? (payload['run_id'] as string)
            : typeof payload['sweep_id'] === 'string'
              ? (payload['sweep_id'] as string)
              : undefined;
      useAssessment.getState().recordQueryFailure({
        action,
        reason: reasonFromAckCode(code) ?? 'event_log_truncated',
        message,
        ts: new Date().toISOString(),
        ...(targetId !== undefined ? { targetId } : {}),
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
