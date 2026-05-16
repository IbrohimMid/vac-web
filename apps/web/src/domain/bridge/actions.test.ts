import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveMutation,
  refineMutation,
  rejectMutation,
  retryMutation,
} from './actions';
import { useMutations, type MutationIntent } from '../../stores/mutations';
import type { TransportHandle } from '../../transport';

function fakeTransport(send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({} as never)): TransportHandle {
  return { send, on: vi.fn().mockReturnValue(() => {}), close: vi.fn() } as unknown as TransportHandle;
}

function seed(overrides: Partial<MutationIntent> = {}) {
  useMutations.getState().upsert({
    requestId: 'req-1',
    kind: 'write',
    summary: 'Create src/foo.ts',
    receivedAt: 1,
    status: 'pending',
    sourceEventType: 'bridge.mutation.requested',
    ...overrides,
  });
}

describe('bridge action dispatchers', () => {
  beforeEach(() => useMutations.setState({ intents: {}, order: [] }));

  it('approveMutation sends bridge.mutation.approve and stamps approved status', async () => {
    seed();
    const t = fakeTransport();
    await approveMutation(t, 's1', 'req-1', 'looks good');
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.approve', { session_id: 's1', request_id: 'req-1', note: 'looks good' });
    const cur = useMutations.getState().intents['req-1'];
    expect(cur?.status).toBe('approved');
    expect(cur?.statusMessage).toMatch(/Approval sent/);
  });

  it('rejectMutation sends bridge.mutation.reject with optional reason', async () => {
    seed();
    const t = fakeTransport();
    await rejectMutation(t, 's1', 'req-1');
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.reject', { session_id: 's1', request_id: 'req-1' });
    expect(useMutations.getState().intents['req-1']?.status).toBe('rejected');
  });

  it('refineMutation keeps the intent pending but updates the status message', async () => {
    seed();
    const t = fakeTransport();
    await refineMutation(t, 's1', 'req-1', 'use a hashmap');
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.refine_request', { session_id: 's1', request_id: 'req-1', note: 'use a hashmap' });
    const cur = useMutations.getState().intents['req-1'];
    expect(cur?.status).toBe('pending');
    expect(cur?.statusMessage).toMatch(/Refine request sent/);
  });

  it('approveMutation reverts to pending and surfaces error when transport.send rejects', async () => {
    seed();
    const t = fakeTransport(vi.fn().mockRejectedValue(new Error('disconnected')));
    await expect(approveMutation(t, 's1', 'req-1')).rejects.toThrow('disconnected');
    const cur = useMutations.getState().intents['req-1'];
    expect(cur?.status).toBe('pending');
    expect(cur?.statusMessage).toMatch(/Failed to send approval/);
    expect(cur?.statusMessage).toMatch(/disconnected/);
  });

  it('retryMutation re-sends bridge.mutation.approve and stamps approved', async () => {
    seed({ status: 'failed', statusMessage: 'Bridge apply failed: EACCES' });
    const t = fakeTransport();
    await retryMutation(t, 's1', 'req-1');
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.approve', expect.objectContaining({ request_id: 'req-1' }));
    expect(useMutations.getState().intents['req-1']?.status).toBe('approved');
  });

  it('rejectMutation reverts to pending on failure so user can retry', async () => {
    seed();
    const t = fakeTransport(vi.fn().mockRejectedValue(new Error('boom')));
    await expect(rejectMutation(t, 's1', 'req-1')).rejects.toThrow('boom');
    expect(useMutations.getState().intents['req-1']?.status).toBe('pending');
  });
});
