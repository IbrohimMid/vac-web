import { GATE_ORDER, useGates, type Gate, type GateId, type GateState } from '../../stores/gates';
import type { TransportHandle } from '../../transport';

function asState(raw: string | undefined): GateState {
  if (raw === 'open' || raw === 'pass' || raw === 'fail') return raw;
  return 'open';
}

interface ChangedPayload {
  id: string;
  state: string;
  summary?: string;
  blockers?: string[];
  criteria?: Array<{ id: string; label: string; satisfied: boolean }>;
  signers?: Array<{ name: string; signed_at: string }>;
  required_signers?: number;
  overridden?: boolean;
  last_changed_at?: string;
}

export function registerGateHandlers(transport: TransportHandle): () => void {
  return transport.on('gate.changed', (ev) => {
    const p = ev.payload as ChangedPayload | null;
    if (!p?.id) return;
    if (!GATE_ORDER.includes(p.id as GateId)) return;
    const g: Gate = {
      id: p.id as GateId,
      state: asState(p.state),
      summary: p.summary ?? '',
      blockers: p.blockers ?? [],
      criteria: p.criteria ?? [],
      signers: p.signers ?? [],
      // Two-party sign required on the post-dev release gates; single-signer
      // sufficient for pre-release checkpoints.
      required_signers:
        p.required_signers ??
        (p.id === 'ReadyToDeploy' || p.id === 'ReadyToPublish' ? 2 : 1),
      overridden: Boolean(p.overridden),
      last_changed_at: p.last_changed_at ?? new Date().toISOString(),
    };
    useGates.getState().upsert(g);
  });
}
