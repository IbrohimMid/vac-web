import { useValidation, type ValidationRunStatus } from '../../stores/validation';
import type { TransportHandle } from '../../transport';

interface ValidationPayload {
  run_id?: string;
  task_id?: string;
  session_id?: string;
  command?: string;
  label?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  message?: string;
  error_message?: string;
  related_files?: unknown;
  source_event_type?: string;
}

interface ValidationRequestOpts {
  command?: string;
  taskId?: string | null;
  runId?: string | null;
  relatedFiles?: string[];
}

const STATUSES: ValidationRunStatus[] = ['idle', 'queued', 'running', 'passed', 'failed', 'cancelled'];

function asStatus(raw: string | undefined): ValidationRunStatus {
  return raw && STATUSES.includes(raw as ValidationRunStatus) ? (raw as ValidationRunStatus) : 'idle';
}

function payload(raw: unknown): ValidationPayload {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ValidationPayload) : {};
}

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

function fallbackRunId(p: ValidationPayload, evTs: string): string {
  const command = p.command ?? 'validation';
  const key = `${p.task_id ?? 'session'}:${command}:${p.started_at ?? evTs}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return `validation-${hash.toString(16)}`;
}

export function registerValidationHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];
  offs.push(transport.on('validation.run.updated', (ev) => {
    const p = payload(ev.payload);
    const sessionId = p.session_id ?? ev.session_id;
    const command = p.command ?? 'validation command';
    const message = p.message ?? p.error_message;
    useValidation.getState().upsertRun({
      id: p.run_id ?? fallbackRunId(p, ev.ts),
      sessionId,
      command,
      label: p.label ?? command,
      status: asStatus(p.status),
      startedAt: p.started_at ?? ev.ts,
      relatedFiles: strings(p.related_files),
      ...(p.finished_at !== undefined ? { finishedAt: p.finished_at } : {}),
      ...(typeof p.duration_ms === 'number' ? { durationMs: p.duration_ms } : {}),
      ...(message ? { message } : {}),
      ...(p.task_id ? { taskId: p.task_id } : {}),
      sourceEventType: p.source_event_type ?? 'validation.run.updated',
    });
  }));
  return () => offs.forEach((off) => off());
}

async function sendValidationEvent<P extends { session_id?: string }>(transport: TransportHandle, sessionId: string, type: string, payload: P): Promise<void> {
  await transport.send(sessionId, type, payload);
}

export async function requestValidationRun(transport: TransportHandle, sessionId: string, opts: ValidationRequestOpts = {}): Promise<void> {
  await sendValidationEvent(transport, sessionId, 'validation.run.request', {
    session_id: sessionId,
    ...(opts.command !== undefined ? { command: opts.command } : {}),
    ...(opts.taskId ? { task_id: opts.taskId } : {}),
    ...(opts.runId ? { run_id: opts.runId } : {}),
    ...(opts.relatedFiles !== undefined ? { related_files: opts.relatedFiles } : {}),
  });
}

export async function requestValidationFailureContext(transport: TransportHandle, sessionId: string, runId: string): Promise<void> {
  await sendValidationEvent(transport, sessionId, 'validation.failure.send_context', { session_id: sessionId, run_id: runId });
}
