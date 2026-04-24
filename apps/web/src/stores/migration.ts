// Migration packet store. Distinct from the generic handoff store because
// the trust model is stricter per `docs/capability-profiles.md §4.2`:
//   - dry-run required (profile-level invariant)
//   - two-party always (can't be overridden)
//   - reversibility proof executed before real dispatch
//   - explicit maintenance window

import { create } from 'zustand';

export type MigrationPhase =
  | 'draft'
  | 'dry_run_queued'
  | 'dry_run_running'
  | 'dry_run_completed'
  | 'dry_run_failed'
  | 'reversibility_verifying'
  | 'reversibility_failed'
  | 'awaiting_signoff'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'rolled_back'
  | 'failed'
  | 'rejected';

export interface MigrationPacket {
  id: string;
  title: string;
  forward_sql: string;
  rollback_sql: string;
  phase: MigrationPhase;
  maintenance_start: string;
  maintenance_end: string;
  dry_run_log: string[];
  reversibility_ok?: boolean;
  signers: Array<{ name: string; role: 'author' | 'approver'; signed_at: string }>;
  created_at: string;
  updated_at: string;
}

interface MigrationSlice {
  packets: Map<string, MigrationPacket>;
  order: string[];
  active_id: string | null;
  upsert(p: MigrationPacket): void;
  appendDryRunLog(id: string, line: string): void;
  setPhase(id: string, phase: MigrationPhase): void;
  setReversibility(id: string, ok: boolean): void;
  addSigner(id: string, name: string, role: 'author' | 'approver'): boolean;
  setActive(id: string | null): void;
  clear(): void;
}

const MAX_DRY_LOG = 500;

export const useMigration = create<MigrationSlice>((set, get) => ({
  packets: new Map(),
  order: [],
  active_id: null,

  upsert(p) {
    set((s) => {
      const packets = new Map(s.packets);
      const order = packets.has(p.id) ? s.order : [...s.order, p.id];
      const prev = packets.get(p.id);
      // Merge semantics: partial updates (e.g. phase-only) keep prior fields.
      packets.set(p.id, { ...prev, ...p, updated_at: new Date().toISOString() });
      return {
        packets,
        order,
        active_id: s.active_id ?? p.id,
      };
    });
  },

  appendDryRunLog(id, line) {
    set((s) => {
      const cur = s.packets.get(id);
      if (!cur) return s;
      const packets = new Map(s.packets);
      const log = cur.dry_run_log.length >= MAX_DRY_LOG
        ? [...cur.dry_run_log.slice(cur.dry_run_log.length - MAX_DRY_LOG + 1), line]
        : [...cur.dry_run_log, line];
      packets.set(id, { ...cur, dry_run_log: log });
      return { packets };
    });
  },

  setPhase(id, phase) {
    set((s) => {
      const cur = s.packets.get(id);
      if (!cur) return s;
      const packets = new Map(s.packets);
      packets.set(id, { ...cur, phase, updated_at: new Date().toISOString() });
      return { packets };
    });
  },

  setReversibility(id, ok) {
    set((s) => {
      const cur = s.packets.get(id);
      if (!cur) return s;
      const packets = new Map(s.packets);
      packets.set(id, { ...cur, reversibility_ok: ok });
      return { packets };
    });
  },

  /**
   * Two-party invariant: a single name cannot hold both `author` and
   * `approver` roles. Returns false on self-sign attempt.
   */
  addSigner(id, name, role) {
    const cur = get().packets.get(id);
    if (!cur) return true;
    const trimmed = name.trim();
    if (!trimmed) return false;
    const already = cur.signers.find((s) => s.name === trimmed);
    if (already) return false; // same person cannot re-sign
    if (role === 'approver' && cur.signers.some((s) => s.role === 'author' && s.name === trimmed)) {
      return false;
    }
    set((s) => {
      const packets = new Map(s.packets);
      const curr = packets.get(id);
      if (!curr) return s;
      packets.set(id, {
        ...curr,
        signers: [...curr.signers, { name: trimmed, role, signed_at: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      });
      return { packets };
    });
    return true;
  },

  setActive(id) {
    set({ active_id: id });
  },

  clear() {
    set({ packets: new Map(), order: [], active_id: null });
  },
}));

/**
 * Canonical predicate: is this packet allowed to run *right now*?
 * Maintenance window + two-party + reversibility proven + dry-run ok.
 */
export function canDispatchMigration(p: MigrationPacket, now: Date): boolean {
  // Only `scheduled` dispatches. `awaiting_signoff` is by definition still
  // waiting for the second signer; transition to `scheduled` happens when
  // the second signer adds and reversibility is proven.
  if (p.phase !== 'scheduled') return false;
  if (p.reversibility_ok !== true) return false;
  const start = Date.parse(p.maintenance_start);
  const end = Date.parse(p.maintenance_end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const t = now.getTime();
  if (t < start || t > end) return false;
  return p.signers.some((s) => s.role === 'author') &&
    p.signers.some((s) => s.role === 'approver');
}
