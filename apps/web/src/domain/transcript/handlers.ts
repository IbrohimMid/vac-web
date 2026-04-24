// Wire transport events → transcript store with typed payload narrowing.

import { onMessageCompleted } from '../../transcript/FreezeController';
import { useTranscript, type Role } from '../../stores/transcript';
import type { TransportHandle } from '../../transport';

interface MessageAddedPayload {
  message_id: string;
  role: string;
  created_at: string;
}
interface DeltaPayload {
  message_id: string;
  delta: string;
}
interface CompletedPayload {
  message_id: string;
}
interface ErrorPayload {
  message_id: string;
  error: string;
}

function asRole(raw: string | undefined): Role {
  if (raw === 'user' || raw === 'assistant' || raw === 'tool') return raw;
  return 'assistant';
}

export function registerTranscriptHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('transcript.message_added', (ev) => {
      const p = ev.payload as MessageAddedPayload | null;
      if (!p?.message_id) return;
      useTranscript.getState().upsert({
        id: p.message_id,
        role: asRole(p.role),
        content: '',
        state: 'streaming',
        createdAt: p.created_at,
      });
    }),
  );

  offs.push(
    transport.on('transcript.delta', (ev) => {
      const p = ev.payload as DeltaPayload | null;
      if (!p?.message_id || typeof p.delta !== 'string') return;
      useTranscript.getState().appendDelta(p.message_id, p.delta);
    }),
  );

  offs.push(
    transport.on('transcript.completed', (ev) => {
      const p = ev.payload as CompletedPayload | null;
      if (!p?.message_id) return;
      useTranscript.getState().complete(p.message_id);
      onMessageCompleted(p.message_id);
    }),
  );

  offs.push(
    transport.on('transcript.error', (ev) => {
      const p = ev.payload as ErrorPayload | null;
      if (!p?.message_id) return;
      useTranscript.getState().error(p.message_id, p.error ?? 'unknown error');
    }),
  );

  return () => offs.forEach((off) => off());
}
