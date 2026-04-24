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
}

interface ProgressPayload {
  run_id: string;
  completed: number;
  total: number;
  current?: string;
}

interface FindingPayload {
  finding_id: string;
  identity_hash: string;
  run_id: string;
  category?: string;
  subject: string;
  check: string;
  severity?: string;
  confidence?: number;
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
    transport.on('assessment.finding', (ev) => {
      const p = ev.payload as FindingPayload | null;
      if (!p?.finding_id || !p.identity_hash) return;
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
    }),
  );

  offs.push(
    transport.on('assessment.evidence', (ev) => {
      const p = ev.payload as EvidencePayload | null;
      if (!p?.id) return;
      useAssessment.getState().upsertEvidence({
        id: p.id,
        connector: p.connector,
        kind: p.kind,
        label: p.label,
        captured_at: p.captured_at,
        ttl_seconds: p.ttl_seconds,
      });
    }),
  );

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
