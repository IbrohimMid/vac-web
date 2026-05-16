// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildEditIntentPayload,
  buildFileContextPayload,
  buildSelectionContextPayload,
  buildFileIntentPayload,
  sendCodingContext,
} from './context';
import type { TransportHandle } from '../../transport';

function fakeTransport() {
  return {
    send: vi.fn().mockResolvedValue({} as never),
    on: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as TransportHandle & { send: ReturnType<typeof vi.fn> };
}

describe('buildFileContextPayload', () => {
  it('includes session_id and path only when no content/selection', () => {
    const p = buildFileContextPayload('s1', { path: 'src/a.ts' });
    expect(p).toEqual({ session_id: 's1', path: 'src/a.ts' });
  });

  it('emits excerpt verbatim for short files', () => {
    const p = buildFileContextPayload('s1', {
      path: 'src/a.ts',
      content: 'line1\nline2',
    });
    expect(p.excerpt).toBe('line1\nline2');
  });

  it('truncates very large files with elision marker', () => {
    const big = Array.from({ length: 200 }, (_, i) => 'L' + i).join('\n');
    const p = buildFileContextPayload('s1', { path: 'src/a.ts', content: big });
    expect(p.excerpt).toMatch(/lines elided/);
  });

  it('includes selection lines if provided', () => {
    const p = buildFileContextPayload('s1', {
      path: 'src/a.ts',
      selection: { start: 3, end: 5 },
    });
    expect(p.lines).toEqual({ start: 3, end: 5 });
  });
});

describe('buildSelectionContextPayload', () => {
  it('extracts selected lines (1-based, inclusive)', () => {
    const content = 'a\nb\nc\nd\ne';
    const p = buildSelectionContextPayload('s1', 'src/a.ts', content, {
      start: 2,
      end: 4,
    });
    expect(p.selected_text).toBe('b\nc\nd');
    expect(p.start_line).toBe(2);
    expect(p.end_line).toBe(4);
  });

  it('clamps out-of-range selection', () => {
    const content = 'a\nb';
    const p = buildSelectionContextPayload('s1', 'src/a.ts', content, {
      start: 0,
      end: 99,
    });
    expect(p.start_line).toBe(1);
    expect(p.end_line).toBe(2);
    expect(p.selected_text).toBe('a\nb');
  });
});

describe('buildFileIntentPayload', () => {
  it('omits hint when empty', () => {
    const p = buildFileIntentPayload('s1', 'src/a.ts');
    expect(p).toEqual({ session_id: 's1', path: 'src/a.ts' });
  });

  it('includes hint when provided', () => {
    const p = buildFileIntentPayload('s1', 'src/a.ts', 'extract helper');
    expect(p.hint).toBe('extract helper');
  });
});

describe('buildEditIntentPayload', () => {
  it('returns minimal payload when no chips/hint/selection', () => {
    const p = buildEditIntentPayload('s1', 'src/a.ts');
    expect(p).toEqual({ session_id: 's1', path: 'src/a.ts' });
  });

  it('trims hint and drops whitespace-only', () => {
    const empty = buildEditIntentPayload('s1', 'src/a.ts', { hint: '   ' });
    expect(empty.hint).toBeUndefined();
    const trimmed = buildEditIntentPayload('s1', 'src/a.ts', {
      hint: '  refactor this  ',
    });
    expect(trimmed.hint).toBe('refactor this');
  });

  it('deduplicates and trims chips, drops empty entries', () => {
    const p = buildEditIntentPayload('s1', 'src/a.ts', {
      chips: ['refactor', 'refactor', ' add types ', '', '  '],
    });
    expect(p.chips).toEqual(['refactor', 'add types']);
  });

  it('omits chips key when chips list is empty after filtering', () => {
    const p = buildEditIntentPayload('s1', 'src/a.ts', { chips: ['', '  '] });
    expect(p.chips).toBeUndefined();
  });

  it('attaches selected_range and selected_text sliced from content', () => {
    const p = buildEditIntentPayload('s1', 'src/a.ts', {
      selection: { start: 2, end: 4 },
      content: 'a\nb\nc\nd\ne',
    });
    expect(p.selected_range).toEqual({ start_line: 2, end_line: 4 });
    expect(p.selected_text).toBe('b\nc\nd');
  });

  it('clamps selected_range and slices content when selection runs past EOF', () => {
    const p = buildEditIntentPayload('s1', 'src/a.ts', {
      selection: { start: 0, end: 99 },
      content: 'a\nb',
    });
    expect(p.selected_range).toEqual({ start_line: 1, end_line: 99 });
    expect(p.selected_text).toBe('a\nb');
  });
});

describe('sendCodingContext', () => {
  it('forwards event type and payload to transport.send', async () => {
    const t = fakeTransport();
    const res = await sendCodingContext(t, 'coding.context.ask_about_file', {
      session_id: 's1',
      path: 'src/a.ts',
    });
    expect(res.ok).toBe(true);
    expect(t.send).toHaveBeenCalledWith('s1', 'coding.context.ask_about_file', {
      session_id: 's1',
      path: 'src/a.ts',
    });
  });

  it('returns error when payload missing session_id', async () => {
    const t = fakeTransport();
    const res = await sendCodingContext(t, 'coding.context.ask_about_file', {
      path: 'x',
    } as { session_id?: string });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing session_id');
    expect(t.send).not.toHaveBeenCalled();
  });

  it('returns error when transport.send rejects', async () => {
    const t = fakeTransport();
    t.send.mockRejectedValueOnce(new Error('disconnected'));
    const res = await sendCodingContext(t, 'coding.context.request_edit', {
      session_id: 's1',
      path: 'src/a.ts',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('disconnected');
  });
});
