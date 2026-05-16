import {
  useMutations,
  type MutationStatus,
} from '../../stores/mutations';
import { useAudit } from '../../stores/audit';
import type { TransportHandle } from '../../transport';

function logUserAudit(
  kind: string,
  requestId: string,
  summary: string,
  status: MutationStatus,
  detail?: string,
): void {
  useAudit.getState().append({
    source: 'user', kind, requestId, summary, status,
    ...(detail ? { detail } : {}),
  });
}

// Phase B2 (Sprint B): outbound action helpers for the bridge mutation
// pipeline. Each helper optimistically transitions the store status and
// then waits for the transport ack. On success the message is refreshed;
// on failure the status is reverted to 'pending' with an error message so
// the user can retry from the inbox. Apply / failed lifecycle is wired in
// Phase B3 via the `bridge.mutation.applied|failed|updated` events.

interface BridgeActionCopy {
  sending: string;
  requested: string;
  failed: string;
}

async function dispatchBridgeMutation(
  transport: TransportHandle,
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
  requestId: string,
  optimisticStatus: MutationStatus,
  copy: BridgeActionCopy,
): Promise<void> {
  useMutations.getState().setStatus(requestId, optimisticStatus, copy.sending);
  logUserAudit(type, requestId, copy.sending, optimisticStatus);
  try {
    await transport.send(sessionId, type, payload);
    useMutations.getState().setStatus(requestId, optimisticStatus, copy.requested);
    logUserAudit(`${type}.ack`, requestId, copy.requested, optimisticStatus);
  } catch (err) {
    const detail = err instanceof Error && err.message ? err.message : copy.failed;
    const msg = `${copy.failed} ${detail}`.trim();
    useMutations.getState().setStatus(requestId, 'pending', msg);
    logUserAudit(`${type}.failed`, requestId, msg, 'pending', detail);
    throw err;
  }
}

export async function approveMutation(
  transport: TransportHandle,
  sessionId: string,
  requestId: string,
  note?: string,
): Promise<void> {
  await dispatchBridgeMutation(
    transport,
    sessionId,
    'bridge.mutation.approve',
    {
      session_id: sessionId,
      request_id: requestId,
      ...(note ? { note } : {}),
    },
    requestId,
    'approved',
    {
      sending: 'Sending approval to local AI...',
      requested: 'Approval sent to local AI. Awaiting bridge apply.',
      failed: 'Failed to send approval.',
    },
  );
}

export async function rejectMutation(
  transport: TransportHandle,
  sessionId: string,
  requestId: string,
  reason?: string,
): Promise<void> {
  await dispatchBridgeMutation(
    transport,
    sessionId,
    'bridge.mutation.reject',
    {
      session_id: sessionId,
      request_id: requestId,
      ...(reason ? { reason } : {}),
    },
    requestId,
    'rejected',
    {
      sending: 'Sending rejection to local AI...',
      requested: 'Rejection sent to local AI.',
      failed: 'Failed to send rejection.',
    },
  );
}

// Retry a failed apply by re-sending an approve. The bridge is responsible
// for idempotency on its side; on the browser we just optimistically reset
// the status to `approved` so the inbox shows the retry in flight.
export async function retryMutation(
  transport: TransportHandle,
  sessionId: string,
  requestId: string,
  note?: string,
): Promise<void> {
  await approveMutation(transport, sessionId, requestId, note);
}

export async function refineMutation(
  transport: TransportHandle,
  sessionId: string,
  requestId: string,
  note: string,
): Promise<void> {
  await dispatchBridgeMutation(
    transport,
    sessionId,
    'bridge.mutation.refine_request',
    {
      session_id: sessionId,
      request_id: requestId,
      note,
    },
    requestId,
    'pending',
    {
      sending: 'Sending refine request to local AI...',
      requested: 'Refine request sent to local AI.',
      failed: 'Failed to send refine request.',
    },
  );
}
