// Assessment store: runs + findings + evidence.
//
// Upstream VAC (PRs #6/#7) emits finding.emit + evidence.capture events; the
// bridge translates those into `assessment.*` ServerEvents that flow here.
// `identityHash` on findings enables dedup across re-emissions and, in Phase 5,
// the assessment diff (resolved / persistent / regressed / new).

import { create } from 'zustand';
import type { DiffResult } from './assessmentDiff';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type Category = 'technical' | 'product' | 'ux' | 'release' | 'ops';
export type Verdict = 'pass' | 'warn' | 'fail' | 'unknown';
export type FreshnessTier = 'fresh' | 'aging' | 'stale' | 'hard_expire';
export type RunStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
export type SweepMode = 'sequential' | 'parallel';
export type SweepFailurePolicy = 'continue' | 'stop_on_fail';

export interface EvidenceRef {
  id: string;
  connector: string;
  kind: string;
  label: string;
  captured_at: string;
  ttl_seconds: number;
  preview?: string;
  preview_error?: string;
  preview_failure_reason?: 'connector_unavailable' | 'unsupported_source' | 'permission_denied' | 'not_found' | 'preview_failed';
  uri?: string;
  locator?: Record<string, unknown>;
  connector_id?: string;
  snapshot_id?: string;
  digest?: string;
  source_etag?: string;
  observed_at?: string;
  fresh_until?: string;
  staleness_policy?: 'hard_expire' | 'warn_only' | 'immutable';
  captured_by?: string;
  captured_snapshot_id?: string;
  size?: number;
  mime_type?: string;
}

export interface RunScope {
  project_root: string;
  repo_ref?: string;
  base_commit_sha?: string;
  diff_range?: string;
  path_globs?: string[];
  depth?: string;
}

export interface ConnectorSnapshot {
  connector_id: string;
  kind: string;
  snapshot_id: string;
  captured_at: string;
  etag?: string;
}

export interface RunProgress {
  completed: number;
  total: number;
  current?: string;
  phase?: string;
  pass?: number;
  max_passes?: number;
  reason?: string;
  elapsed_ms?: number;
}

export interface RunVerdictDetail {
  status: string;
  delivery_state?: string;
  reason?: string;
  counts?: Record<string, number>;
}

export interface RunFailure {
  status: 'failed' | 'cancelled';
  reason: string;
  detail?: string;
}

export type AssessmentQuerySource = 'index' | 'event_log';
export type AssessmentQueryFallbackReason = 'index_missing' | 'index_incomplete' | 'index_error';

export interface AssessmentQueryProvenance {
  query_source?: AssessmentQuerySource;
  fallback_reason?: AssessmentQueryFallbackReason | null;
}

export interface Finding {
  id: string;
  identity_hash: string;
  run_id: string;
  category: Category;
  subject: string;
  check: string;
  severity: Severity;
  confidence: number;
  title: string;
  summary: string;
  evidence_ids: string[];
  emitted_at: string;
}

export interface CandidateValidationStats {
  received: number;
  rejected: number;
  rejection_reasons: Record<string, number>;
}

export type WorkerOutputRejectionReason =
  | 'json_parse_failed'
  | 'schema_version_unsupported'
  | 'schema_invalid'
  | 'candidate_schema_invalid'
  | 'empty_output'
  | 'redaction_applied';

// Phase 4 shipped with `rtd | pm`; Phase 6 widens the string to the full
// 12-family catalog. Kept as a plain string so upstream can introduce new
// families without a protocol-ts regen blocking the UI.
export type AssessorFamily =
  | 'rtd'
  | 'pm'
  | 'ux'
  | 'frontend'
  | 'security'
  | 'reliability'
  | 'performance'
  | 'qa'
  | 'docs'
  | 'launch'
  | 'release'
  | 'growth';

export const ASSESSOR_FAMILIES: AssessorFamily[] = [
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
];

export interface Run extends AssessmentQueryProvenance {
  id: string;
  swarm: AssessorFamily;
  status: RunStatus;
  started_at: string;
  finished_at?: string;
  sweep_id?: string;
  progress: RunProgress;
  verdict?: Verdict;
  score?: Record<Category, number>;
  validation?: CandidateValidationStats;
  scope?: RunScope;
  connector_snapshots?: ConnectorSnapshot[];
  agent_id?: string;
  agent_kind?: string;
  agent_role?: string;
  worker_session_id?: string;
  verdict_detail?: RunVerdictDetail;
  failure?: RunFailure;
  query_source?: AssessmentQuerySource;
  fallback_reason?: AssessmentQueryFallbackReason | null;
}

export interface Sweep extends AssessmentQueryProvenance {
  id: string;
  families: AssessorFamily[];
  status: RunStatus;
  started_at: string;
  finished_at?: string;
  progress: RunProgress;
  verdict?: Verdict;
  verdict_detail?: RunVerdictDetail;
  counts?: Record<string, number>;
  requested_mode?: SweepMode;
  effective_mode?: SweepMode;
  mode?: SweepMode;
  concurrency?: number;
  failure_policy?: SweepFailurePolicy;
  running_count?: number;
  pending_count?: number;
  completed_count?: number;
  failed_count?: number;
  run_ids: string[];
  scope?: RunScope;
  agent_id?: string;
  agent_kind?: string;
  agent_role?: string;
  failure?: RunFailure;
}

// P2 failure UX: query failures from `assessment.*` ack errors.
// Reasons map from backend ack codes:
//   - assessment.not_found             -> 'not_found'
//   - persistence.disabled             -> 'backend_unavailable'
//   - assessment.invalid_payload       -> 'invalid_payload'
//   - assessment.query_failed          -> 'event_log_truncated' (load_events failed)
//   - <transport timeout / disconnect> -> 'timeout'
//   - anything else                    -> 'unknown'
export type QueryFailureReason =
  | 'not_found'
  | 'event_log_truncated'
  | 'backend_unavailable'
  | 'invalid_payload'
  | 'timeout'
  | 'unknown';

export type QueryAction =
  | 'list_runs'
  | 'fetch_report'
  | 'replay'
  | 'diff'
  | 'fetch_evidence_preview'
  | 'sweep.run'
  | 'sweep.cancel'
  | 'run';

export interface QueryFailure {
  action: QueryAction;
  reason: QueryFailureReason;
  message: string;
  ts: string;
  /** Optional target identifier (run id, sweep id, evidence id, or composite). */
  targetId?: string;
}

/** Compose a stable key for `queryErrors` lookups. */
export function queryFailureKey(action: QueryAction, targetId?: string): string {
  return targetId ? `${action}:${targetId}` : action;
}

// N3 (worker output rejection) — kept SEPARATE from queryErrors on purpose.
// queryErrors are recoverable read-side failures the operator can Retry;
// worker output rejections are write-side worker-contract failures that
// need a Replay (or different worker) instead. Conflating them in one
// banner would hide the distinction and tempt operators to keep mashing
// Retry on a structurally broken worker.
export interface WorkerOutputRejection {
  /** The run that produced the broken envelope. */
  run_id: string;
  /** Worker session that produced the broken envelope, if known. */
  worker_session_id?: string;
  /** Provenance triplet, when the backend supplied it. */
  agent_id?: string;
  agent_kind?: string;
  agent_role?: string;
  /** Stable low-cardinality error category emitted by the backend. */
  reason: WorkerOutputRejectionReason;
  /** Stable machine code (e.g. `unparseable`, `schema_version_unsupported`, `severity_invalid`). */
  code: string;
  /** Human-readable detail for the banner body. */
  detail: string;
  /** Optional JSON pointer-ish path to the bad field. */
  path?: string;
  /** Optional sample-level note. `redaction_applied` means the diagnostic sample was scrubbed. */
  sample_reason?: WorkerOutputRejectionReason;
  /** True when the sample text was truncated for safety. */
  sample_truncated?: boolean;
  /** Pass index inside max_passes when the worker re-tries; both omitted when unknown. */
  pass?: number;
  max_passes?: number;
  /** Truncated + redacted transcript sample (≤ 500 chars). */
  sample?: string;
  /** Wallclock the rejection event was observed on this client. */
  ts: string;
}

interface AssessmentSlice {
  runs: Map<string, Run>;
  runOrder: string[];
  activeRunId: string | null;
  sweeps: Map<string, Sweep>;
  sweepOrder: string[];
  activeSweepId: string | null;
  findings: Map<string, Finding>;
  findingsByHash: Map<string, string>; // identity_hash -> finding id
  evidence: Map<string, EvidenceRef>;
  diffs: Map<string, DiffResult>;
  diffOrder: string[];
  /** P2: keyed by `queryFailureKey(action, targetId)`. */
  queryErrors: Map<string, QueryFailure>;
  /** N3: worker-output rejection events keyed by run_id. Distinct from
   *  queryErrors so the UI can surface a Replay-action banner instead of
   *  a Retry banner; see WorkerOutputRejection doc above. */
  workerOutputErrors: Map<string, WorkerOutputRejection>;

  upsertRun(run: Run): void;
  upsertSweep(sweep: Sweep): void;
  setProgress(runId: string, progress: RunProgress): void;
  setSweepProgress(sweepId: string, progress: RunProgress): void;
  completeRun(
    runId: string,
    verdict: Verdict,
    score: Record<Category, number>,
    meta?: {
      query_source?: AssessmentQuerySource;
      fallback_reason?: AssessmentQueryFallbackReason | null;
      verdict_detail?: RunVerdictDetail;
      agent_id?: string;
      agent_kind?: string;
      agent_role?: string;
      worker_session_id?: string;
    },
  ): void;
  completeSweep(
    sweepId: string,
    verdict: Verdict,
    counts: Record<string, number>,
    meta?: {
      query_source?: AssessmentQuerySource;
      fallback_reason?: AssessmentQueryFallbackReason | null;
      verdict_detail?: RunVerdictDetail;
      agent_id?: string;
      agent_kind?: string;
      agent_role?: string;
    },
  ): void;
  failRun(
    runId: string,
    status: RunFailure['status'],
    reason: string,
    detail?: string,
    meta?: {
      query_source?: AssessmentQuerySource;
      fallback_reason?: AssessmentQueryFallbackReason | null;
      agent_id?: string;
      agent_kind?: string;
      agent_role?: string;
      worker_session_id?: string;
    },
  ): void;
  failSweep(
    sweepId: string,
    status: RunFailure['status'],
    reason: string,
    detail?: string,
    meta?: {
      query_source?: AssessmentQuerySource;
      fallback_reason?: AssessmentQueryFallbackReason | null;
      verdict_detail?: RunVerdictDetail;
      agent_id?: string;
      agent_kind?: string;
      agent_role?: string;
    },
  ): void;
  setActive(runId: string | null): void;
  setActiveSweep(sweepId: string | null): void;
  recordCandidateReceived(runId: string, count?: number): void;
  recordCandidateRejected(runId: string, reason: string): void;

  emitFinding(f: Finding): void;
  upsertEvidence(e: EvidenceRef): void;
  setEvidencePreview(id: string, preview: string): void;
  setEvidencePreviewFailure(id: string, reason: NonNullable<EvidenceRef['preview_failure_reason']>, message: string): void;
  upsertDiff(baseRunId: string, nextRunId: string, diff: DiffResult): void;

  recordQueryFailure(failure: QueryFailure): void;
  clearQueryFailure(action: QueryAction, targetId?: string): void;
  clearAllQueryErrors(): void;

  /** N3: record an `assessment.worker_output_rejected` event. */
  recordWorkerOutputRejection(rejection: WorkerOutputRejection): void;
  /** N3: drop the rejection for a specific run (e.g. operator dismissed banner or replayed). */
  clearWorkerOutputRejection(runId: string): void;
  /** N3: drop all worker output rejections (used by `clear()`). */
  clearAllWorkerOutputErrors(): void;

  clear(): void;
}

export const useAssessment = create<AssessmentSlice>((set) => ({
  runs: new Map(),
  runOrder: [],
  activeRunId: null,
  sweeps: new Map(),
  sweepOrder: [],
  activeSweepId: null,
  findings: new Map(),
  findingsByHash: new Map(),
  evidence: new Map(),
  diffs: new Map(),
  diffOrder: [],
  queryErrors: new Map(),
  workerOutputErrors: new Map(),

  upsertRun(run) {
    set((s) => {
      const runs = new Map(s.runs);
      const runOrder = runs.has(run.id) ? s.runOrder : [...s.runOrder, run.id];
      const prev = runs.get(run.id);
      runs.set(run.id, {
        ...prev,
        ...run,
        validation: prev?.validation ?? run.validation ?? {
          received: 0,
          rejected: 0,
          rejection_reasons: {},
        },
      });
      const sweeps = new Map(s.sweeps);
      if (run.sweep_id) {
        const prevSweep = sweeps.get(run.sweep_id) ?? {
          id: run.sweep_id,
          families: [],
          status: 'running' as const,
          started_at: run.started_at,
          progress: { completed: 0, total: 0 },
          run_ids: [],
        };
        sweeps.set(run.sweep_id, {
          ...prevSweep,
          run_ids: prevSweep.run_ids.includes(run.id)
            ? prevSweep.run_ids
            : [...prevSweep.run_ids, run.id],
        });
      }
      return {
        runs,
        runOrder,
        activeRunId: s.activeRunId ?? run.id,
        activeSweepId: s.activeSweepId ?? run.sweep_id ?? null,
        sweeps,
      };
    });
  },

  upsertSweep(sweep) {
    set((s) => {
      const sweeps = new Map(s.sweeps);
      const sweepOrder = sweeps.has(sweep.id) ? s.sweepOrder : [...s.sweepOrder, sweep.id];
      const prev = sweeps.get(sweep.id);
      sweeps.set(sweep.id, {
        ...prev,
        ...sweep,
        run_ids: Array.from(new Set([...(prev?.run_ids ?? []), ...(sweep.run_ids ?? [])])),
      });
      return {
        sweeps,
        sweepOrder,
        activeSweepId: s.activeSweepId ?? sweep.id,
      };
    });
  },

  setProgress(runId, progress) {
    set((s) => {
      const cur = s.runs.get(runId);
      if (!cur) return s;
      const runs = new Map(s.runs);
      runs.set(runId, { ...cur, progress });
      return { runs };
    });
  },

  setSweepProgress(sweepId, progress) {
    set((s) => {
      const cur = s.sweeps.get(sweepId);
      if (!cur) return s;
      const sweeps = new Map(s.sweeps);
      sweeps.set(sweepId, { ...cur, progress });
      return { sweeps };
    });
  },

  completeRun(runId, verdict, score, meta) {
    set((s) => {
      const cur = s.runs.get(runId);
      if (!cur) return s;
      const runs = new Map(s.runs);
      const next: Run = {
        ...cur,
        status: 'completed',
        verdict,
        score,
        ...(meta?.verdict_detail ? { verdict_detail: meta.verdict_detail } : {}),
        ...(meta?.agent_id !== undefined ? { agent_id: meta.agent_id } : {}),
        ...(meta?.agent_kind !== undefined ? { agent_kind: meta.agent_kind } : {}),
        ...(meta?.agent_role !== undefined ? { agent_role: meta.agent_role } : {}),
        ...(meta?.worker_session_id !== undefined
          ? { worker_session_id: meta.worker_session_id }
          : {}),
        finished_at: new Date().toISOString(),
      };
      delete next.failure;
      runs.set(runId, next);
      return { runs };
    });
  },

  completeSweep(sweepId, verdict, counts, meta) {
    set((s) => {
      const cur = s.sweeps.get(sweepId);
      if (!cur) return s;
      const sweeps = new Map(s.sweeps);
      const next: Sweep = {
        ...cur,
        status: 'completed',
        verdict,
        counts,
        ...(meta?.verdict_detail ? { verdict_detail: meta.verdict_detail } : {}),
        ...(meta?.agent_id !== undefined ? { agent_id: meta.agent_id } : {}),
        ...(meta?.agent_kind !== undefined ? { agent_kind: meta.agent_kind } : {}),
        ...(meta?.agent_role !== undefined ? { agent_role: meta.agent_role } : {}),
        finished_at: new Date().toISOString(),
      };
      delete next.failure;
      sweeps.set(sweepId, next);
      return { sweeps };
    });
  },

  failRun(runId, status, reason, detail, meta) {
    set((s) => {
      const cur = s.runs.get(runId);
      if (!cur) return s;
      const runs = new Map(s.runs);
      runs.set(runId, {
        ...cur,
        status,
        failure: {
          status,
          reason,
          ...(detail !== undefined ? { detail } : {}),
        },
        ...(meta?.agent_id !== undefined ? { agent_id: meta.agent_id } : {}),
        ...(meta?.agent_kind !== undefined ? { agent_kind: meta.agent_kind } : {}),
        ...(meta?.agent_role !== undefined ? { agent_role: meta.agent_role } : {}),
        ...(meta?.worker_session_id !== undefined
          ? { worker_session_id: meta.worker_session_id }
          : {}),
        finished_at: new Date().toISOString(),
      });
      return { runs };
    });
  },

  failSweep(sweepId, status, reason, detail, meta) {
    set((s) => {
      const cur = s.sweeps.get(sweepId);
      if (!cur) return s;
      const sweeps = new Map(s.sweeps);
      sweeps.set(sweepId, {
        ...cur,
        status,
        failure: {
          status,
          reason,
          ...(detail !== undefined ? { detail } : {}),
        },
        ...(meta?.verdict_detail ? { verdict_detail: meta.verdict_detail } : {}),
        ...(meta?.agent_id !== undefined ? { agent_id: meta.agent_id } : {}),
        ...(meta?.agent_kind !== undefined ? { agent_kind: meta.agent_kind } : {}),
        ...(meta?.agent_role !== undefined ? { agent_role: meta.agent_role } : {}),
        finished_at: new Date().toISOString(),
      });
      return { sweeps };
    });
  },

  setActive(runId) {
    set({ activeRunId: runId });
  },

  setActiveSweep(sweepId) {
    set({ activeSweepId: sweepId });
  },

  recordCandidateReceived(runId, count = 1) {
    if (count <= 0) return;
    set((s) => {
      const cur = s.runs.get(runId);
      if (!cur) return s;
      const runs = new Map(s.runs);
      const validation = cur.validation ?? {
        received: 0,
        rejected: 0,
        rejection_reasons: {},
      };
      runs.set(runId, {
        ...cur,
        validation: {
          received: validation.received + count,
          rejected: validation.rejected,
          rejection_reasons: { ...validation.rejection_reasons },
        },
      });
      return { runs };
    });
  },

  recordCandidateRejected(runId, reason) {
    const key = reason.trim() || 'unknown';
    set((s) => {
      const cur = s.runs.get(runId);
      if (!cur) return s;
      const runs = new Map(s.runs);
      const validation = cur.validation ?? {
        received: 0,
        rejected: 0,
        rejection_reasons: {},
      };
      runs.set(runId, {
        ...cur,
        validation: {
          received: validation.received,
          rejected: validation.rejected + 1,
          rejection_reasons: {
            ...validation.rejection_reasons,
            [key]: (validation.rejection_reasons[key] ?? 0) + 1,
          },
        },
      });
      return { runs };
    });
  },

  emitFinding(f) {
    set((s) => {
      const existingId = s.findingsByHash.get(f.identity_hash);
      const findings = new Map(s.findings);
      const findingsByHash = new Map(s.findingsByHash);
      if (existingId && existingId !== f.id) {
        // Merge-by-hash: overwrite existing entry with new content under new id,
        // drop the old id. Keeps hash authoritative.
        findings.delete(existingId);
      }
      findings.set(f.id, f);
      findingsByHash.set(f.identity_hash, f.id);
      return { findings, findingsByHash };
    });
  },

  upsertEvidence(e) {
    set((s) => {
      const evidence = new Map(s.evidence);
      const prev = evidence.get(e.id);
      evidence.set(e.id, { ...prev, ...e });
      return { evidence };
    });
  },

  setEvidencePreview(id, preview) {
    set((s) => {
      const cur = s.evidence.get(id);
      if (!cur) return s;
      const evidence = new Map(s.evidence);
      const next = { ...cur, preview };
      delete next.preview_error;
      delete next.preview_failure_reason;
      evidence.set(id, next);
      return { evidence };
    });
  },

  setEvidencePreviewFailure(id, reason, message) {
    set((s) => {
      const cur = s.evidence.get(id);
      if (!cur) return s;
      const evidence = new Map(s.evidence);
      evidence.set(id, { ...cur, preview_error: message, preview_failure_reason: reason });
      return { evidence };
    });
  },

  upsertDiff(baseRunId, nextRunId, diff) {
    set((s) => {
      const key = `${baseRunId}\x00${nextRunId}`;
      const diffs = new Map(s.diffs);
      const diffOrder = diffs.has(key) ? s.diffOrder : [...s.diffOrder, key];
      diffs.set(key, diff);
      // P2: a successful diff result clears any prior failure for this pair.
      const errKey = queryFailureKey('diff', `${baseRunId}\x00${nextRunId}`);
      let queryErrors = s.queryErrors;
      if (queryErrors.has(errKey)) {
        queryErrors = new Map(queryErrors);
        queryErrors.delete(errKey);
      }
      return { diffs, diffOrder, queryErrors };
    });
  },

  recordQueryFailure(failure) {
    set((s) => {
      const key = queryFailureKey(failure.action, failure.targetId);
      const queryErrors = new Map(s.queryErrors);
      queryErrors.set(key, failure);
      return { queryErrors };
    });
  },

  clearQueryFailure(action, targetId) {
    set((s) => {
      const key = queryFailureKey(action, targetId);
      if (!s.queryErrors.has(key)) return s;
      const queryErrors = new Map(s.queryErrors);
      queryErrors.delete(key);
      return { queryErrors };
    });
  },

  clearAllQueryErrors() {
    set((s) => (s.queryErrors.size === 0 ? s : { queryErrors: new Map() }));
  },

  recordWorkerOutputRejection(rejection) {
    set((s) => {
      const workerOutputErrors = new Map(s.workerOutputErrors);
      workerOutputErrors.set(rejection.run_id, rejection);
      return { workerOutputErrors };
    });
  },

  clearWorkerOutputRejection(runId) {
    set((s) => {
      if (!s.workerOutputErrors.has(runId)) return s;
      const workerOutputErrors = new Map(s.workerOutputErrors);
      workerOutputErrors.delete(runId);
      return { workerOutputErrors };
    });
  },

  clearAllWorkerOutputErrors() {
    set((s) =>
      s.workerOutputErrors.size === 0 ? s : { workerOutputErrors: new Map() },
    );
  },

  clear() {
    set({
      runs: new Map(),
      runOrder: [],
      activeRunId: null,
      sweeps: new Map(),
      sweepOrder: [],
      activeSweepId: null,
      findings: new Map(),
      findingsByHash: new Map(),
      evidence: new Map(),
      diffs: new Map(),
      diffOrder: [],
      queryErrors: new Map(),
      workerOutputErrors: new Map(),
    });
  },
}));

// Freshness tier from ttl + captured_at. Spec: docs/evidence-freshness.md §4.
// fresh: < 0.5 ttl · aging: < ttl · stale: < 2 ttl · hard_expire: ≥ 2 ttl.
export function freshnessTier(e: EvidenceRef, now = Date.now()): FreshnessTier {
  const captured = Date.parse(e.captured_at);
  if (!Number.isFinite(captured) || e.ttl_seconds <= 0) return 'stale';
  const ageMs = now - captured;
  const ttlMs = e.ttl_seconds * 1000;
  if (ageMs < ttlMs * 0.5) return 'fresh';
  if (ageMs < ttlMs) return 'aging';
  if (ageMs < ttlMs * 2) return 'stale';
  return 'hard_expire';
}
