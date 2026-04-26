// Transport events → assessment store. Upstream VAC (PRs #6/#7) emits
// finding.emit + evidence.capture; the bridge re-tags these as
// `assessment.*` / `evidence.*` ServerEvents.

import {
  useAssessment,
  type Category,
  type Finding,
  type Run,
  type Severity,
  type Verdict,
} from '../../stores/assessment';
import type { TransportHandle } from '../../transport';

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

export function registerAssessmentHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('assessment.started', (ev) => {
      const p = ev.payload as StartedPayload | null;
      if (!p?.run_id) return;
      // Permissive: unknown family names still flow through as `rtd` so the
      // UI doesn't drop events on family rollout.
      const known = new Set([
        'rtd',
        'pm',
        'ux',
        'frontend',
        'security',
        'reliability',
        'performance',
        'qa',
        'docs',
        'launch',
        'release',
        'growth',
      ]);
      const swarm = (known.has(p.swarm) ? p.swarm : 'rtd') as Run['swarm'];
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
      useAssessment.getState().setProgress(p.run_id, {
        completed: p.completed,
        total: p.total,
        ...(p.current !== undefined ? { current: p.current } : {}),
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
      useAssessment.getState().completeRun(p.run_id, verdict, score);
    }),
  );

  return () => offs.forEach((off) => off());
}
