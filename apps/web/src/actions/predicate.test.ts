// Phase 2.6 red-team: ActionSpec.available_when predicate parser must reject
// malicious inputs without evaluating them.

import { describe, expect, it } from 'vitest';
import { evaluate, type Context } from './predicate';

const ctx: Context = {
  session: { open: true, streaming: false },
  workbench: { tab: 'transcript' },
  approvals: { pendingCount: 0 },
  gates: {},
};

describe('predicate evaluator', () => {
  it('returns true on null/empty', () => {
    expect(evaluate(null, ctx)).toBe(true);
    expect(evaluate('', ctx)).toBe(true);
  });

  it('handles simple path truthy', () => {
    expect(evaluate('session.open', ctx)).toBe(true);
    expect(evaluate('session.streaming', ctx)).toBe(false);
  });

  it('handles negation', () => {
    expect(evaluate('!session.streaming', ctx)).toBe(true);
    expect(evaluate('!session.open', ctx)).toBe(false);
  });

  it('handles AND / OR', () => {
    expect(evaluate('session.open && !session.streaming', ctx)).toBe(true);
    expect(evaluate('session.streaming || session.open', ctx)).toBe(true);
    expect(evaluate('session.streaming && session.open', ctx)).toBe(false);
  });

  it('handles comparison with literal', () => {
    expect(evaluate("workbench.tab == 'transcript'", ctx)).toBe(true);
    expect(evaluate("workbench.tab == 'runtime'", ctx)).toBe(false);
    expect(evaluate('approvals.pendingCount == 0', ctx)).toBe(true);
    expect(evaluate('approvals.pendingCount > 5', ctx)).toBe(false);
  });

  it('rejects arbitrary JS (fails open for safety)', () => {
    // Anything that doesn't parse should return true (advisory UX, not security).
    expect(evaluate('alert(1)', ctx)).toBe(true);
    expect(evaluate('window.location="evil"', ctx)).toBe(true);
    expect(evaluate('fetch("/api")', ctx)).toBe(true);
  });

  it('parens work', () => {
    expect(evaluate('(session.open && !session.streaming)', ctx)).toBe(true);
    expect(evaluate('!(session.streaming || !session.open)', ctx)).toBe(true);
  });
});
