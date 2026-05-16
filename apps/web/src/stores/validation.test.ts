import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_VALIDATION_PRESETS,
  parseValidationPresets,
  selectSessionValidationRuns,
  useValidation,
} from './validation';

function reset() {
  useValidation.getState().resetAll();
}

describe('validation store', () => {
  beforeEach(reset);

  it('keeps default presets', () => {
    expect(useValidation.getState().presets).toEqual(DEFAULT_VALIDATION_PRESETS);
    expect(useValidation.getState().presets.some((p) => p.heavy)).toBe(true);
  });

  it('upserts runs newest-first and selects first run', () => {
    useValidation.getState().upsertRun({ id: 'r1', sessionId: 's1', command: 'pnpm test', label: 'Test', status: 'running', startedAt: 't1', relatedFiles: [] });
    useValidation.getState().upsertRun({ id: 'r2', sessionId: 's1', command: 'pnpm typecheck', label: 'Typecheck', status: 'passed', startedAt: 't2', relatedFiles: [] });
    expect(useValidation.getState().order).toEqual(['r2', 'r1']);
    expect(useValidation.getState().selectedRunId).toBe('r1');
  });

  it('merges an existing run without duplicating order', () => {
    useValidation.getState().upsertRun({ id: 'r1', sessionId: 's1', command: 'pnpm test', label: 'Test', status: 'running', startedAt: 't1', relatedFiles: [] });
    useValidation.getState().upsertRun({ id: 'r1', sessionId: 's1', command: 'pnpm test', label: 'Test', status: 'failed', startedAt: 't1', finishedAt: 't2', message: 'boom', relatedFiles: ['a.ts'] });
    expect(useValidation.getState().order).toEqual(['r1']);
    expect(useValidation.getState().runs.get('r1')).toMatchObject({ status: 'failed', message: 'boom', relatedFiles: ['a.ts'] });
  });

  it('filters runs by session', () => {
    useValidation.getState().upsertRun({ id: 'r1', sessionId: 's1', command: 'a', label: 'A', status: 'passed', startedAt: 't1', relatedFiles: [] });
    useValidation.getState().upsertRun({ id: 'r2', sessionId: 's2', command: 'b', label: 'B', status: 'passed', startedAt: 't2', relatedFiles: [] });
    expect(selectSessionValidationRuns('s1').map((r) => r.id)).toEqual(['r1']);
  });

  it('clears one session', () => {
    useValidation.getState().upsertRun({ id: 'r1', sessionId: 's1', command: 'a', label: 'A', status: 'passed', startedAt: 't1', relatedFiles: [] });
    useValidation.getState().upsertRun({ id: 'r2', sessionId: 's2', command: 'b', label: 'B', status: 'passed', startedAt: 't2', relatedFiles: [] });
    useValidation.getState().clearSession('s1');
    expect(useValidation.getState().order).toEqual(['r2']);
  });

  it('cancelRun marks queued or running runs cancelled with finishedAt', () => {
    useValidation.getState().upsertRun({ id: 'q1', sessionId: 's1', command: 'a', label: 'A', status: 'queued', startedAt: 't1', relatedFiles: [] });
    useValidation.getState().cancelRun('q1');
    const r = useValidation.getState().runs.get('q1');
    expect(r?.status).toBe('cancelled');
    expect(typeof r?.finishedAt).toBe('string');
  });

  it('cancelRun is a no-op for passed/failed/cancelled runs', () => {
    useValidation.getState().upsertRun({ id: 'p1', sessionId: 's1', command: 'a', label: 'A', status: 'passed', startedAt: 't1', finishedAt: 't2', relatedFiles: [] });
    useValidation.getState().cancelRun('p1');
    expect(useValidation.getState().runs.get('p1')?.status).toBe('passed');
    useValidation.getState().upsertRun({ id: 'f1', sessionId: 's1', command: 'a', label: 'A', status: 'failed', startedAt: 't1', relatedFiles: [] });
    useValidation.getState().cancelRun('f1');
    expect(useValidation.getState().runs.get('f1')?.status).toBe('failed');
  });

  it('cancelRun ignores unknown run ids', () => {
    useValidation.getState().cancelRun('nope');
    expect(useValidation.getState().runs.size).toBe(0);
  });

  it('setPresets replaces the preset list', () => {
    useValidation.getState().setPresets([{ id: 'x', label: 'X', command: 'echo x' }]);
    expect(useValidation.getState().presets).toEqual([{ id: 'x', label: 'X', command: 'echo x' }]);
  });
});

describe('parseValidationPresets', () => {
  it('parses a valid array', () => {
    const out = parseValidationPresets([
      { id: 'a', label: 'A', command: 'cmd-a' },
      { id: 'b', label: 'B', command: 'cmd-b', heavy: true },
    ]);
    expect(out).toEqual([
      { id: 'a', label: 'A', command: 'cmd-a' },
      { id: 'b', label: 'B', command: 'cmd-b', heavy: true },
    ]);
  });

  it('parses a JSON string', () => {
    const out = parseValidationPresets('[{"id":"a","label":"A","command":"cmd"}]');
    expect(out).toEqual([{ id: 'a', label: 'A', command: 'cmd' }]);
  });

  it('returns null for invalid JSON', () => {
    expect(parseValidationPresets('{not json')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseValidationPresets('')).toBeNull();
    expect(parseValidationPresets([])).toBeNull();
  });

  it('skips malformed entries but keeps valid ones', () => {
    const out = parseValidationPresets([
      { id: 'a' },
      { id: 'b', label: 'B', command: 'cmd-b' },
    ]);
    expect(out).toEqual([{ id: 'b', label: 'B', command: 'cmd-b' }]);
  });
});
