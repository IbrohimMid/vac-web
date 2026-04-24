// Wire handoff.* transport events → handoff store + notify lane.

import { useHandoff, type Packet, type PacketStatus, type Pin } from '../../stores/handoff';
import { useNotify } from '../../stores/notify';
import type { TransportHandle } from '../../transport';

function asStatus(raw: string | undefined): PacketStatus {
  const known: PacketStatus[] = [
    'draft',
    'pending_approval',
    'approved',
    'rejected',
    'dispatched',
    'executing',
    'completed',
    'failed',
    'invalidated',
    'expired',
  ];
  return known.includes(raw as PacketStatus) ? (raw as PacketStatus) : 'draft';
}

interface UpsertPayload {
  packet_id: string;
  title?: string;
  target_profile?: string;
  status?: string;
  tasks?: Packet['tasks'];
  pin?: Pin;
  signers?: Packet['signers'];
  required_signers?: number;
  executor_session_id?: string;
  convergence_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface StatusPayload {
  packet_id: string;
  status: string;
  reason?: string;
}

interface InvalidatedPayload {
  packet_id: string;
  reason: string;
  drift?: { expected: string; actual: string };
}

interface DispatchProgressPayload {
  packet_id: string;
  executor_session_id?: string;
  current_task?: string;
  completed: number;
  total: number;
}

interface ConvergencePayload {
  packet_id: string;
  cycles: number;
  last_persistent_regressed: number[];
}

export function registerHandoffHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('handoff.upserted', (ev) => {
      const p = ev.payload as UpsertPayload | null;
      if (!p?.packet_id) return;
      // Merge-by-id: partial updates (e.g. only { status, signers } on approve)
      // must not wipe fields the first emit populated. Append new signers by
      // name; prefer payload-provided fields over the existing value.
      const prev = useHandoff.getState().packets.get(p.packet_id);
      const mergedSigners = (() => {
        if (!p.signers) return prev?.signers ?? [];
        if (!prev) return p.signers;
        const seen = new Set(prev.signers.map((s) => s.name));
        return [...prev.signers, ...p.signers.filter((s) => !seen.has(s.name))];
      })();
      const packet: Packet = {
        id: p.packet_id,
        title: p.title ?? prev?.title ?? 'Untitled',
        target_profile: p.target_profile ?? prev?.target_profile ?? 'executor.code@1.0.0',
        status: p.status ? asStatus(p.status) : (prev?.status ?? 'draft'),
        tasks: p.tasks ?? prev?.tasks ?? [],
        pin:
          p.pin ??
          prev?.pin ?? {
            worktree_digest: '',
            base_sha: '',
            captured_at: new Date().toISOString(),
            policy: 'strict',
            connector_snapshots: [],
          },
        signers: mergedSigners,
        required_signers: p.required_signers ?? prev?.required_signers ?? 2,
        ...(p.executor_session_id !== undefined
          ? { executor_session_id: p.executor_session_id }
          : prev?.executor_session_id !== undefined
            ? { executor_session_id: prev.executor_session_id }
            : {}),
        convergence_count: p.convergence_count ?? prev?.convergence_count ?? 0,
        created_at: p.created_at ?? prev?.created_at ?? new Date().toISOString(),
        updated_at: p.updated_at ?? new Date().toISOString(),
      };
      useHandoff.getState().upsert(packet);
    }),
  );

  offs.push(
    transport.on('handoff.status', (ev) => {
      const p = ev.payload as StatusPayload | null;
      if (!p?.packet_id) return;
      useHandoff.getState().setStatus(p.packet_id, asStatus(p.status));
    }),
  );

  offs.push(
    transport.on('handoff.invalidated', (ev) => {
      const p = ev.payload as InvalidatedPayload | null;
      if (!p?.packet_id) return;
      useHandoff.getState().setStatus(p.packet_id, 'invalidated');
      useNotify.getState().receive({
        id: `handoff_invalid_${p.packet_id}`,
        lane: 'sticky',
        severity: 'error',
        subsystem: 'handoff',
        title: 'Handoff invalidated',
        message: p.reason ?? 'pin drift detected — build a fresh packet',
        correlationId: p.packet_id,
        ts: new Date().toISOString(),
      });
    }),
  );

  offs.push(
    transport.on('handoff.dispatch_progress', (ev) => {
      const p = ev.payload as DispatchProgressPayload | null;
      if (!p?.packet_id) return;
      if (p.executor_session_id) {
        useHandoff.getState().setExecutorSession(p.packet_id, p.executor_session_id);
      }
    }),
  );

  offs.push(
    transport.on('handoff.convergence_stuck', (ev) => {
      const p = ev.payload as ConvergencePayload | null;
      if (!p?.packet_id) return;
      useHandoff.getState().incrementConvergence(p.packet_id);
      useNotify.getState().receive({
        id: `convergence_${p.packet_id}`,
        lane: 'sticky',
        severity: 'warn',
        subsystem: 'handoff',
        title: 'Convergence stuck',
        message: `Packet ${p.packet_id} has not improved across ${p.cycles} cycles.`,
        correlationId: p.packet_id,
        ts: new Date().toISOString(),
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
