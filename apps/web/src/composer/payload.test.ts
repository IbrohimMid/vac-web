// Lock the message.submit envelope shape — Stage I contract.
//
// Both composer modes (textarea + contentEditable) MUST send the same envelope:
//   { text, attachments, mentions }
//
// Adding/removing/renaming a top-level field here is a protocol change and
// requires bridge + mock-engine updates. Keep this test in sync.

import { describe, expect, it } from 'vitest';
import { buildSubmitPayload } from '../components/Composer/Composer';
import type { MentionRef } from './serialize';

describe('buildSubmitPayload (contract lock)', () => {
  it('emits text + attachments + mentions, all required keys', () => {
    const p = buildSubmitPayload({
      text: 'hello',
      attachments: [],
      mentions: [],
    });
    expect(Object.keys(p).sort()).toEqual(['attachments', 'mentions', 'text']);
  });

  it('preserves attachment + mention shape verbatim', () => {
    const a = { kind: 'file', label: 'src/foo.ts', payload: 'src/foo.ts' };
    const m: MentionRef = {
      id: 'file:src/foo.ts',
      kind: 'file',
      label: 'src/foo.ts',
      payload: 'src/foo.ts',
    };
    const p = buildSubmitPayload({
      text: 'see @src/foo.ts',
      attachments: [a],
      mentions: [m],
    });
    expect(p).toEqual({
      text: 'see @src/foo.ts',
      attachments: [a],
      mentions: [m],
    });
  });

  it('empty mentions array is preserved (textarea-mode contract)', () => {
    const p = buildSubmitPayload({ text: 't', attachments: [], mentions: [] });
    expect(p.mentions).toEqual([]);
    expect(Array.isArray(p.mentions)).toBe(true);
  });

  it('does not introduce extra keys', () => {
    const p = buildSubmitPayload({ text: 't', attachments: [], mentions: [] });
    const allowed = new Set(['text', 'attachments', 'mentions']);
    for (const k of Object.keys(p)) {
      expect(allowed.has(k)).toBe(true);
    }
  });
});
