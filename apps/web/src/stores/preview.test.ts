import { beforeEach, describe, expect, it } from 'vitest';
import {
  PREVIEW_CONSOLE_CAP,
  PREVIEW_NETWORK_CAP,
  isAllowedPreviewUrl,
  usePreview,
} from './preview';

describe('usePreview', () => {
  beforeEach(() => {
    usePreview.getState().resetAll();
  });

  it('starts idle with no URL or diagnostics', () => {
    const s = usePreview.getState();
    expect(s.status).toBe('idle');
    expect(s.url).toBeNull();
    expect(s.consoleErrors).toEqual([]);
    expect(s.networkFailures).toEqual([]);
  });

  it('beginOpen moves to starting and stores the URL', () => {
    usePreview.getState().beginOpen('http://localhost:4181');
    const s = usePreview.getState();
    expect(s.status).toBe('starting');
    expect(s.url).toBe('http://localhost:4181');
    expect(s.lastUpdatedAt).not.toBeNull();
  });

  it('beginOpen clears stale errors and unsupported reasons', () => {
    usePreview.getState().setError('boom');
    usePreview.getState().setUnsupported('no bridge');
    usePreview.getState().beginOpen(null);
    const s = usePreview.getState();
    expect(s.errorMessage).toBeNull();
    expect(s.unsupportedReason).toBeNull();
  });

  it('setUpdated keeps URL when payload omits it', () => {
    usePreview.getState().beginOpen('http://localhost:4181');
    usePreview.getState().setUpdated({ status: 'running' });
    const s = usePreview.getState();
    expect(s.status).toBe('running');
    expect(s.url).toBe('http://localhost:4181');
  });

  it('setUpdated can replace URL with a new value', () => {
    usePreview.getState().setUpdated({ status: 'running', url: 'http://127.0.0.1:4181' });
    expect(usePreview.getState().url).toBe('http://127.0.0.1:4181');
  });

  it('setUpdated can clear URL explicitly', () => {
    usePreview.getState().beginOpen('http://localhost:4181');
    usePreview.getState().setUpdated({ status: 'stopped', url: null });
    expect(usePreview.getState().url).toBeNull();
  });

  it('setUnsupported records reason and clears error', () => {
    usePreview.getState().setError('old');
    usePreview.getState().setUnsupported('no response from bridge within timeout');
    const s = usePreview.getState();
    expect(s.status).toBe('unsupported');
    expect(s.unsupportedReason).toBe('no response from bridge within timeout');
    expect(s.errorMessage).toBeNull();
  });

  it('setError records message and status', () => {
    usePreview.getState().setError('permission denied');
    const s = usePreview.getState();
    expect(s.status).toBe('failed');
    expect(s.errorMessage).toBe('permission denied');
  });

  it('setStopped keeps current URL', () => {
    usePreview.getState().beginOpen('http://localhost:4181');
    usePreview.getState().setStopped();
    const s = usePreview.getState();
    expect(s.status).toBe('stopped');
    expect(s.url).toBe('http://localhost:4181');
  });

  it('appendConsoleError stores details', () => {
    usePreview.getState().appendConsoleError({ message: 'ReferenceError', source: 'main.js', line: 7 });
    const entry = usePreview.getState().consoleErrors[0]!;
    expect(entry.message).toBe('ReferenceError');
    expect(entry.source).toBe('main.js');
    expect(entry.line).toBe(7);
    expect(entry.receivedAt).toBeTypeOf('number');
  });

  it('appendConsoleError caps the buffer', () => {
    for (let i = 0; i < PREVIEW_CONSOLE_CAP + 5; i += 1) {
      usePreview.getState().appendConsoleError({ message: `err-${i}` });
    }
    const entries = usePreview.getState().consoleErrors;
    expect(entries).toHaveLength(PREVIEW_CONSOLE_CAP);
    expect(entries[0]!.message).toBe('err-5');
  });

  it('appendNetworkFailure stores details', () => {
    usePreview.getState().appendNetworkFailure({ url: 'http://localhost/api', status: 500, message: 'fail' });
    const entry = usePreview.getState().networkFailures[0]!;
    expect(entry.url).toBe('http://localhost/api');
    expect(entry.status).toBe(500);
    expect(entry.message).toBe('fail');
  });

  it('appendNetworkFailure caps the buffer', () => {
    for (let i = 0; i < PREVIEW_NETWORK_CAP + 2; i += 1) {
      usePreview.getState().appendNetworkFailure({ url: `http://localhost/${i}` });
    }
    const entries = usePreview.getState().networkFailures;
    expect(entries).toHaveLength(PREVIEW_NETWORK_CAP);
    expect(entries[0]!.url).toBe('http://localhost/2');
  });

  it('clearConsole clears console and network diagnostics only', () => {
    usePreview.getState().beginOpen('http://localhost:4181');
    usePreview.getState().appendConsoleError({ message: 'err' });
    usePreview.getState().appendNetworkFailure({ url: 'http://localhost/api' });
    usePreview.getState().clearConsole();
    const s = usePreview.getState();
    expect(s.status).toBe('starting');
    expect(s.consoleErrors).toEqual([]);
    expect(s.networkFailures).toEqual([]);
  });

  it('resetAll returns to the initial state', () => {
    usePreview.getState().beginOpen('http://localhost:4181');
    usePreview.getState().appendConsoleError({ message: 'err' });
    usePreview.getState().resetAll();
    expect(usePreview.getState().status).toBe('idle');
    expect(usePreview.getState().url).toBeNull();
    expect(usePreview.getState().consoleErrors).toEqual([]);
  });
});

describe('isAllowedPreviewUrl', () => {
  it('allows localhost and loopback URLs', () => {
    expect(isAllowedPreviewUrl('http://localhost:4181')).toBe(true);
    expect(isAllowedPreviewUrl('https://localhost:4181/path')).toBe(true);
    expect(isAllowedPreviewUrl('http://127.0.0.1:4181')).toBe(true);
    expect(isAllowedPreviewUrl('http://[::1]:4181')).toBe(true);
  });

  it('rejects non-loopback, relative, and non-http URLs', () => {
    expect(isAllowedPreviewUrl('http://example.com')).toBe(false);
    expect(isAllowedPreviewUrl('/relative')).toBe(false);
    expect(isAllowedPreviewUrl('file:///tmp/app.html')).toBe(false);
    expect(isAllowedPreviewUrl('not a url')).toBe(false);
  });
});
