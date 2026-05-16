// Gate store. Spec: docs/gates.md.
//
// Phase 4 surfaces: DevComplete, ReadyToDeploy.
// State = { open | pass | fail }. Overrides require signer(s); ReadyToDeploy
// needs two-party signoff.

import { create } from 'zustand';

export type GateId =
  | 'DevComplete'
  | 'ReadyToDeploy'
  | 'QAComplete'
  | 'ReadyForStaging'
  | 'ReadyToPublish'
  | 'ReadyForGrowth'
  | 'MutationAuditClean';

export const GATE_ORDER: GateId[] = [
  'DevComplete',
  'QAComplete',
  'ReadyForStaging',
  'ReadyToDeploy',
  'ReadyToPublish',
  'ReadyForGrowth',
  'MutationAuditClean',
];
export type GateState = 'open' | 'pass' | 'fail';

export interface Gate {
  id: GateId;
  state: GateState;
  summary: string;
  blockers: string[];
  criteria: Array<{ id: string; label: string; satisfied: boolean }>;
  signers: Array<{ name: string; signed_at: string }>;
  required_signers: number;
  overridden: boolean;
  last_changed_at: string;
}

interface GatesSlice {
  gates: Map<GateId, Gate>;
  upsert(g: Gate): void;
  addSigner(id: GateId, name: string): void;
  override(id: GateId, reason: string): void;
  clear(): void;
}

export const useGates = create<GatesSlice>((set) => ({
  gates: new Map(),

  upsert(g) {
    set((s) => {
      const gates = new Map(s.gates);
      gates.set(g.id, g);
      return { gates };
    });
  },

  addSigner(id, name) {
    set((s) => {
      const cur = s.gates.get(id);
      if (!cur) return s;
      if (cur.signers.some((x) => x.name === name)) return s;
      const gates = new Map(s.gates);
      gates.set(id, {
        ...cur,
        signers: [...cur.signers, { name, signed_at: new Date().toISOString() }],
        last_changed_at: new Date().toISOString(),
      });
      return { gates };
    });
  },

  override(id, reason) {
    set((s) => {
      const cur = s.gates.get(id);
      if (!cur) return s;
      const gates = new Map(s.gates);
      gates.set(id, {
        ...cur,
        overridden: true,
        state: 'pass',
        summary: `override: ${reason}`,
        last_changed_at: new Date().toISOString(),
      });
      return { gates };
    });
  },

  clear() {
    set({ gates: new Map() });
  },
}));
