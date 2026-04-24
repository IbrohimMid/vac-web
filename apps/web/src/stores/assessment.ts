// Assessment store: runs + findings + evidence.
//
// Upstream VAC (PRs #6/#7) emits finding.emit + evidence.capture events; the
// bridge translates those into `assessment.*` ServerEvents that flow here.
// `identityHash` on findings enables dedup across re-emissions and, in Phase 5,
// the assessment diff (resolved / persistent / regressed / new).

import { create } from 'zustand';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type Category = 'technical' | 'product' | 'ux' | 'release' | 'ops';
export type Verdict = 'pass' | 'warn' | 'fail' | 'unknown';
export type FreshnessTier = 'fresh' | 'aging' | 'stale' | 'hard_expire';
export type RunStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface EvidenceRef {
  id: string;
  connector: string;
  kind: string;
  label: string;
  captured_at: string;
  ttl_seconds: number;
  preview?: string;
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

export interface Run {
  id: string;
  swarm: AssessorFamily;
  status: RunStatus;
  started_at: string;
  finished_at?: string;
  progress: { completed: number; total: number; current?: string };
  verdict?: Verdict;
  score?: Record<Category, number>;
}

interface AssessmentSlice {
  runs: Map<string, Run>;
  runOrder: string[];
  activeRunId: string | null;
  findings: Map<string, Finding>;
  findingsByHash: Map<string, string>; // identity_hash -> finding id
  evidence: Map<string, EvidenceRef>;

  upsertRun(run: Run): void;
  setProgress(runId: string, progress: Run['progress']): void;
  completeRun(runId: string, verdict: Verdict, score: Record<Category, number>): void;
  setActive(runId: string | null): void;

  emitFinding(f: Finding): void;
  upsertEvidence(e: EvidenceRef): void;
  setEvidencePreview(id: string, preview: string): void;

  clear(): void;
}

export const useAssessment = create<AssessmentSlice>((set) => ({
  runs: new Map(),
  runOrder: [],
  activeRunId: null,
  findings: new Map(),
  findingsByHash: new Map(),
  evidence: new Map(),

  upsertRun(run) {
    set((s) => {
      const runs = new Map(s.runs);
      const runOrder = runs.has(run.id) ? s.runOrder : [...s.runOrder, run.id];
      runs.set(run.id, run);
      return {
        runs,
        runOrder,
        activeRunId: s.activeRunId ?? run.id,
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

  completeRun(runId, verdict, score) {
    set((s) => {
      const cur = s.runs.get(runId);
      if (!cur) return s;
      const runs = new Map(s.runs);
      runs.set(runId, {
        ...cur,
        status: 'completed',
        verdict,
        score,
        finished_at: new Date().toISOString(),
      });
      return { runs };
    });
  },

  setActive(runId) {
    set({ activeRunId: runId });
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
      evidence.set(id, { ...cur, preview });
      return { evidence };
    });
  },

  clear() {
    set({
      runs: new Map(),
      runOrder: [],
      activeRunId: null,
      findings: new Map(),
      findingsByHash: new Map(),
      evidence: new Map(),
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
