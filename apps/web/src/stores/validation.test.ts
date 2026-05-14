import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_VALIDATION_PRESETS, selectSessionValidationRuns, useValidation } from './validation';

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
});
