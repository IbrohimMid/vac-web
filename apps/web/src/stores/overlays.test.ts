import { beforeEach, describe, expect, it } from 'vitest';
import { useOverlays } from './overlays';

function reset() {
  useOverlays.setState({ stack: [] });
}

describe('overlay stack', () => {
  beforeEach(reset);

  it('open pushes onto stack', () => {
    const id = useOverlays.getState().open('command_palette');
    const s = useOverlays.getState();
    expect(s.stack.length).toBe(1);
    expect(s.stack[0]?.id).toBe(id);
    expect(s.stack[0]?.kind).toBe('command_palette');
  });

  it('dismiss removes by id', () => {
    const id = useOverlays.getState().open('command_palette');
    useOverlays.getState().dismiss(id);
    expect(useOverlays.getState().stack.length).toBe(0);
  });

  it('dismissTopmost removes innermost', () => {
    useOverlays.getState().open('command_palette');
    useOverlays.getState().open('gate_detail');
    const removed = useOverlays.getState().dismissTopmost();
    expect(removed).toBe(true);
    expect(useOverlays.getState().stack.length).toBe(1);
    expect(useOverlays.getState().stack[0]?.kind).toBe('command_palette');
  });

  it('dismissTopmost on empty stack returns false', () => {
    expect(useOverlays.getState().dismissTopmost()).toBe(false);
  });

  it('stack depth capped at 2', () => {
    useOverlays.getState().open('command_palette');
    useOverlays.getState().open('gate_detail');
    useOverlays.getState().open('diff_viewer');
    const s = useOverlays.getState();
    expect(s.stack.length).toBe(2);
    expect(s.stack[0]?.kind).toBe('gate_detail');
    expect(s.stack[1]?.kind).toBe('diff_viewer');
  });

  it('isOpen detects kind anywhere in stack', () => {
    useOverlays.getState().open('command_palette');
    useOverlays.getState().open('gate_detail');
    expect(useOverlays.getState().isOpen('command_palette')).toBe(true);
    expect(useOverlays.getState().isOpen('diff_viewer')).toBe(false);
  });

  it('topmost returns last-opened overlay', () => {
    useOverlays.getState().open('command_palette');
    const gid = useOverlays.getState().open('gate_detail');
    expect(useOverlays.getState().topmost()?.id).toBe(gid);
  });

  it('dismissAll clears', () => {
    useOverlays.getState().open('command_palette');
    useOverlays.getState().open('gate_detail');
    useOverlays.getState().dismissAll();
    expect(useOverlays.getState().stack.length).toBe(0);
  });

  it('params passed through to overlay entry', () => {
    useOverlays.getState().open('command_palette', { foo: 'bar' });
    expect(useOverlays.getState().topmost()?.params.foo).toBe('bar');
  });
});
