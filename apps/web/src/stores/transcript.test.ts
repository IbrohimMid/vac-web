import { beforeEach, describe, expect, it } from 'vitest';
import { HOT_WINDOW_SIZE, useTranscript } from './transcript';

function reset() {
  useTranscript.setState({
    messages: new Map(),
    order: [],
    hotWindowIds: new Set(),
    mode: 'live',
  });
}

describe('transcript store', () => {
  beforeEach(reset);

  it('upsert adds message to order + hot window', () => {
    useTranscript.getState().upsert({
      id: 'm1',
      role: 'assistant',
      content: '',
      state: 'streaming',
      createdAt: 't',
    });
    const s = useTranscript.getState();
    expect(s.order).toEqual(['m1']);
    expect(s.hotWindowIds.has('m1')).toBe(true);
    expect(s.messages.get('m1')?.isCold).toBe(false);
  });

  it('appendDelta accumulates content', () => {
    useTranscript.getState().upsert({
      id: 'm1',
      role: 'assistant',
      content: '',
      state: 'streaming',
      createdAt: 't',
    });
    useTranscript.getState().appendDelta('m1', 'Hel');
    useTranscript.getState().appendDelta('m1', 'lo');
    expect(useTranscript.getState().messages.get('m1')?.content).toBe('Hello');
  });

  it('complete transitions state', () => {
    useTranscript.getState().upsert({
      id: 'm1',
      role: 'assistant',
      content: 'x',
      state: 'streaming',
      createdAt: 't',
    });
    useTranscript.getState().complete('m1');
    expect(useTranscript.getState().messages.get('m1')?.state).toBe('completed');
  });

  it('freeze sets isCold + renderedHTML, removes from hot window', () => {
    useTranscript.getState().upsert({
      id: 'm1',
      role: 'assistant',
      content: 'hello',
      state: 'completed',
      createdAt: 't',
    });
    useTranscript.getState().freeze('m1', '<p>hello</p>');
    const s = useTranscript.getState();
    expect(s.messages.get('m1')?.isCold).toBe(true);
    expect(s.messages.get('m1')?.renderedHTML).toBe('<p>hello</p>');
    expect(s.hotWindowIds.has('m1')).toBe(false);
  });

  it('freeze ignores non-completed messages', () => {
    useTranscript.getState().upsert({
      id: 'm1',
      role: 'assistant',
      content: '',
      state: 'streaming',
      createdAt: 't',
    });
    useTranscript.getState().freeze('m1', '<p>x</p>');
    expect(useTranscript.getState().messages.get('m1')?.isCold).toBe(false);
  });

  it('unfreeze restores to hot window', () => {
    useTranscript.getState().upsert({
      id: 'm1',
      role: 'assistant',
      content: 'x',
      state: 'completed',
      createdAt: 't',
    });
    useTranscript.getState().freeze('m1', '<p>x</p>');
    useTranscript.getState().unfreeze('m1');
    const s = useTranscript.getState();
    expect(s.messages.get('m1')?.isCold).toBe(false);
    expect(s.hotWindowIds.has('m1')).toBe(true);
  });

  it('appendDelta is no-op on cold messages', () => {
    useTranscript.getState().upsert({
      id: 'm1',
      role: 'assistant',
      content: 'x',
      state: 'completed',
      createdAt: 't',
    });
    useTranscript.getState().freeze('m1', '<p>x</p>');
    useTranscript.getState().appendDelta('m1', 'should-be-ignored');
    expect(useTranscript.getState().messages.get('m1')?.content).toBe('x');
  });

  it('other messages preserve identity when one is updated (no mass rerender)', () => {
    useTranscript.getState().upsert({
      id: 'a',
      role: 'assistant',
      content: 'A',
      state: 'streaming',
      createdAt: 't',
    });
    useTranscript.getState().upsert({
      id: 'b',
      role: 'assistant',
      content: 'B',
      state: 'streaming',
      createdAt: 't',
    });
    const before = useTranscript.getState().messages.get('a');
    useTranscript.getState().appendDelta('b', 'more');
    const after = useTranscript.getState().messages.get('a');
    expect(after).toBe(before);
  });

  it('HOT_WINDOW_SIZE constant exposed', () => {
    expect(HOT_WINDOW_SIZE).toBeGreaterThan(0);
  });

  // Slice 50: rendering pipeline mode field on the transcript store.
  it('defaults rendering mode to live', () => {
    expect(useTranscript.getState().mode).toBe('live');
  });

  it('setMode transitions through live/replay/frozen', () => {
    const { setMode } = useTranscript.getState();
    setMode('replay');
    expect(useTranscript.getState().mode).toBe('replay');
    setMode('frozen');
    expect(useTranscript.getState().mode).toBe('frozen');
    setMode('live');
    expect(useTranscript.getState().mode).toBe('live');
  });

  it('clear removes content and resets rendering mode to live', () => {
    useTranscript.getState().upsert({
      id: 'm1',
      role: 'assistant',
      content: 'old replay content',
      state: 'completed',
      createdAt: 't',
    });
    useTranscript.getState().setMode('replay');
    useTranscript.getState().clear();
    const s = useTranscript.getState();
    expect(s.messages.size).toBe(0);
    expect(s.order).toEqual([]);
    expect(s.hotWindowIds.size).toBe(0);
    expect(s.mode).toBe('live');
  });
});
