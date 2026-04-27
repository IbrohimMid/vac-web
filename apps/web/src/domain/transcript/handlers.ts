// Wire transport events → transcript store with typed payload narrowing.

import { onMessageCompleted } from '../../transcript/FreezeController';
import { useTranscript, type Role } from '../../stores/transcript';
import type { TransportHandle } from '../../transport';

interface MessageAddedPayload {
  message_id: string;
  role: string;
  created_at: string;
}

function asRole(raw: string | undefined): Role {
  if (raw === 'user' || raw === 'assistant' || raw === 'tool') return raw;
  return 'assistant';
}

export function registerTranscriptHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];
  const activeIds = new Map<string, string>();

  function resolveMessageId(sessionId: string, isDelta: boolean): string {
    let id = activeIds.get(sessionId);
    const store = useTranscript.getState();

    if (id && isDelta) {
      const msg = store.messages.get(id);
      // If the currently known active message is already finalized, we need a new one for the new turn.
      if (!msg || msg.state === 'completed' || msg.state === 'error' || msg.isCold) {
        id = undefined;
      }
    }

    if (!id) {
      id = `msg_agent_${sessionId}_${Date.now()}`;
      activeIds.set(sessionId, id);
    }
    return id;
  }

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
      const p = ev.payload as any;
      if (typeof p?.delta !== 'string') return;

      const messageId = p.message_id || resolveMessageId(ev.session_id, true);
      const store = useTranscript.getState();
      if (!store.messages.has(messageId)) {
        store.upsert({
          id: messageId,
          role: 'assistant',
          content: '',
          state: 'streaming',
          createdAt: new Date().toISOString(),
        });
      }

      store.appendDelta(messageId, p.delta);
    }),
  );

  offs.push(
    transport.on('transcript.completed', (ev) => {
      const p = ev.payload as any;
      const messageId = p?.message_id || resolveMessageId(ev.session_id, false);
      useTranscript.getState().complete(messageId);
      onMessageCompleted(messageId);
    }),
  );

  offs.push(
    transport.on('transcript.error', (ev) => {
      const p = ev.payload as any;
      const messageId = p?.message_id || resolveMessageId(ev.session_id, false);
      useTranscript.getState().error(messageId, p?.error ?? 'unknown error');
    }),
  );

  return () => offs.forEach((off) => off());
}
