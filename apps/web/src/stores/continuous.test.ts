import { describe, expect, it } from 'vitest';
import {
  TRIGGER_ROUTING,
  debounceDecision,
  familiesForTrigger,
  inputSurfaceSkip,
} from './continuous';

describe('TRIGGER_ROUTING', () => {
  it('cadence.cron fires all enabled families', () => {
    const families = familiesForTrigger('cadence.cron', new Set(['rtd', 'security']));
    expect(families).toEqual(expect.arrayContaining(['rtd', 'security']));
  });

  it('pr.merged intersects with enabled set', () => {
    const families = familiesForTrigger('pr.merged', new Set(['rtd', 'pm']));
    expect(families).toEqual(['rtd']); // security + qa not enabled
  });

  it('every source has a routing entry', () => {
    const keys = Object.keys(TRIGGER_ROUTING);
    expect(keys).toContain('pr.merged');
    expect(keys).toContain('cadence.cron');
  });
});

describe('debounceDecision', () => {
  it('first event scheduled', () => {
    expect(debounceDecision(1_000_000, null, 60_000)).toBe('scheduled');
  });
  it('within window → coalesced', () => {
    expect(debounceDecision(1_000_050, 1_000_000, 60_000)).toBe('coalesced');
  });
  it('past window → scheduled again', () => {
    expect(debounceDecision(1_100_000, 1_000_000, 60_000)).toBe('scheduled');
  });
});

describe('inputSurfaceSkip', () => {
  it('no patterns → never skip (conservative)', () => {
    expect(inputSurfaceSkip(['foo.ts'], [])).toBe(false);
  });
  it('no changed paths → skip', () => {
    expect(inputSurfaceSkip([], ['apps/web/src/**'])).toBe(true);
  });
  it('matching glob → run', () => {
    expect(inputSurfaceSkip(['apps/web/src/x.ts'], ['apps/web/src/**'])).toBe(false);
  });
  it('non-matching → skip', () => {
    expect(inputSurfaceSkip(['docs/README.md'], ['apps/web/src/**'])).toBe(true);
  });
  it('literal glob match', () => {
    expect(inputSurfaceSkip(['package.json'], ['package*.json'])).toBe(false);
    expect(inputSurfaceSkip(['package-lock.json'], ['package*.json'])).toBe(false);
  });
});
