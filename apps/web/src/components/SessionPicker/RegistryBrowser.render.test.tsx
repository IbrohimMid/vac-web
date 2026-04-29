// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegistryBrowser, type RegistryAgentEntry } from './RegistryBrowser';
import type { EventFrame, TransportHandle } from '../../transport';

// Each test wires a fresh fake transport that:
//  - records `send(sessionId, type, payload)` calls so we can assert
//    the wire shape mirrors the bridge's expectations,
//  - exposes `emit(type, payload)` so the test can drive the
//    `registry.synced` / `registry.added` event lane on demand.
function makeTransport(opts: {
  ackFor?: Record<string, { ok: boolean; code?: string; message?: string }>;
}) {
  const handlers = new Map<string, (ev: EventFrame) => void>();
  const sends: Array<{ sessionId: string; type: string; payload: unknown }> = [];
  const send = vi.fn(async (sessionId: string, type: string, payload: object) => {
    sends.push({ sessionId, type, payload });
    const a = opts.ackFor?.[type];
    if (a && !a.ok) {
      return {
        ackOf: 'cmd_x',
        ok: false,
        error: { code: a.code ?? 'error', message: a.message ?? 'failure' },
      };
    }
    return { ackOf: 'cmd_x', ok: true };
  });
  const transport: TransportHandle = {
    send: send as unknown as TransportHandle['send'],
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => {
        if (handlers.get(type) === handler) handlers.delete(type);
      };
    },
    availableAgents: () => [],
    close: () => {},
  };
  const emit = (type: string, payload: unknown) => {
    const h = handlers.get(type);
    if (!h) throw new Error(`no handler registered for ${type}`);
    // EventFrame shape: bridge stamps seq/session_id/ts; we stub the
    // minimum the consumer cares about (payload).
    h({
      seq: 1,
      session_id: 'sess_pending_registry',
      type,
      payload: payload as Record<string, unknown>,
      v: 1,
      ts: 0,
    } as unknown as EventFrame);
  };
  return { transport, send, sends, emit };
}

// Helpers to flush microtasks twice — the component fires `await
// transport.send(...)` before the `registry.synced` event arrives, so
// we need to drain the promise queue, then run the event emit, then
// drain again to let setState commits flush.
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

const REMOTE_ENTRY: RegistryAgentEntry = {
  id: 'remote-claude',
  label: 'Claude Remote',
  kind: 'acp',
  command: 'claude-acp',
  args: ['--mode', 'cockpit'],
  install_hint: 'Install: npm i -g @anthropic-ai/claude-acp',
  source: 'remote',
  installed: false,
};
const LOCAL_ENTRY: RegistryAgentEntry = {
  id: 'local-mock',
  label: 'Local Mock',
  kind: 'mock',
  command: 'mock-acp',
  args: [],
  source: 'local',
  installed: true,
};

describe('RegistryBrowser', () => {
  afterEach(cleanup);

  it('sends registry.sync on mount and renders mixed local + remote entries', async () => {
    const { transport, send, emit } = makeTransport({});
    render(<RegistryBrowser transport={transport} onClose={() => {}} />);

    // Mount-effect kicks off `registry.sync` with the sentinel
    // session id so the bridge routes via the sessionless lane.
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(call[0]).toBe('sess_pending_registry');
    expect(call[1]).toBe('registry.sync');
    expect(call[2]).toEqual({});

    // Drive the bridge's `registry.synced` event back through the
    // queued handler. After this the modal must show both entries
    // partitioned by `source`.
    await act(async () => {
      emit('registry.synced', {
        source: 'https://registry.example/agents.toml',
        sourceKind: 'url',
        fromCache: true,
        agents: [LOCAL_ENTRY, REMOTE_ENTRY],
      });
      await flush();
    });

    expect(screen.getByTestId('registry-source')).toHaveTextContent(
      'https://registry.example/agents.toml',
    );
    expect(screen.getByTestId('registry-source')).toHaveTextContent('cached');
    // Remote-only list shows the remote entry…
    expect(screen.getByTestId('registry-row-remote-claude')).toBeInTheDocument();
    // …and the local entry only appears in the collapsed details
    // pane, so its add-button is NOT rendered.
    expect(screen.queryByTestId('registry-add-local-mock')).toBeNull();
  });

  it('surfaces bridge error code verbatim when registry.sync ack is not ok', async () => {
    const { transport } = makeTransport({
      ackFor: {
        'registry.sync': {
          ok: false,
          code: 'registry.not_configured',
          message: 'no [registry] table in agents.toml',
        },
      },
    });
    render(<RegistryBrowser transport={transport} onClose={() => {}} />);
    // The error path goes: useEffect → sync() → await send() → ack.ok=false
    // → setError + setSyncing(false). React batches these and the
    // effect's await yields multiple microtasks before the commit; use
    // `waitFor` so we don't have to pick a microtask count by hand.
    const err = await waitFor(() => screen.getByTestId('registry-error'));
    expect(err).toHaveTextContent('registry.not_configured');
    expect(err).toHaveTextContent('no [registry] table in agents.toml');
  });

  it('sends registry.add with the entry payload and shows the restart banner on success', async () => {
    const { transport, send, sends, emit } = makeTransport({});
    render(<RegistryBrowser transport={transport} onClose={() => {}} />);
    await flush();
    await act(async () => {
      emit('registry.synced', {
        source: '/etc/vac/registry.toml',
        sourceKind: 'path',
        fromCache: false,
        agents: [REMOTE_ENTRY],
      });
      await flush();
    });

    fireEvent.click(screen.getByTestId('registry-add-remote-claude'));
    await flush();

    // Sequence: registry.sync (mount) + registry.add (click).
    expect(send).toHaveBeenCalledTimes(2);
    const addCall = sends[1];
    if (!addCall) throw new Error('expected registry.add to have been sent');
    expect(addCall.type).toBe('registry.add');
    expect(addCall.sessionId).toBe('sess_pending_registry');
    expect(addCall.payload).toMatchObject({
      id: 'remote-claude',
      label: 'Claude Remote',
      kind: 'acp',
      command: 'claude-acp',
      args: ['--mode', 'cockpit'],
      install_hint: 'Install: npm i -g @anthropic-ai/claude-acp',
    });

    // Drive the success event — the bridge wrote the entry to the
    // local config so we expect an Added badge + a restart hint.
    await act(async () => {
      emit('registry.added', {
        id: 'remote-claude',
        added: true,
        path: '/home/op/.config/vac/agents.toml',
      });
      await flush();
    });
    expect(screen.getByTestId('registry-info')).toHaveTextContent('Restart the bridge');
    expect(screen.getByTestId('registry-info')).toHaveTextContent(
      '/home/op/.config/vac/agents.toml',
    );
    expect(screen.getByTestId('registry-added-remote-claude')).toBeInTheDocument();
    // Add button is replaced by the badge once added.
    expect(screen.queryByTestId('registry-add-remote-claude')).toBeNull();
  });

  it('renders the empty-remote message when sync returns only local entries', async () => {
    const { transport, emit } = makeTransport({});
    render(<RegistryBrowser transport={transport} onClose={() => {}} />);
    await flush();
    await act(async () => {
      emit('registry.synced', {
        source: '/etc/vac/registry.toml',
        sourceKind: 'path',
        fromCache: false,
        agents: [LOCAL_ENTRY],
      });
      await flush();
    });
    expect(screen.getByTestId('registry-empty')).toBeInTheDocument();
  });
});
