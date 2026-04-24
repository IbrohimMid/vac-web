// Release plane store: deploy targets, in-flight deploys, release notes drafts,
// post-release observations.
//
// Deploy is gated — the caller checks `ReadyToDeploy` + `ReadyForStaging`
// before issuing `release.deploy`. The store caches the last known verdict
// of each target's gate snapshot so the Deploy page can render gate guards.

import { create } from 'zustand';

export type DeployStatus =
  | 'idle'
  | 'queued'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'rolled_back';

export type PublishStatus = 'idle' | 'queued' | 'publishing' | 'published' | 'failed';

export interface DeployTarget {
  id: string;
  label: string;
  environment: 'staging' | 'production';
  region?: string;
  last_status: DeployStatus;
  last_commit?: string;
  last_deployed_at?: string;
}

export interface DeployEvent {
  id: string;
  target_id: string;
  commit: string;
  status: DeployStatus;
  started_at: string;
  finished_at?: string;
  packet_id?: string;
}

export interface ReleaseNotesDraft {
  id: string;
  target_id: string;
  commit_range: string;
  markdown: string;
  source_refs: Array<{ kind: 'commit' | 'packet' | 'connector'; ref: string }>;
  generated_at: string;
}

export interface PostDeployObservation {
  id: string;
  target_id: string;
  connector: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  observed_at: string;
}

interface ReleaseSlice {
  targets: Map<string, DeployTarget>;
  deploys: Map<string, DeployEvent>;
  deployOrder: string[];
  notes: Map<string, ReleaseNotesDraft>;
  observations: PostDeployObservation[];

  setTargets(list: DeployTarget[]): void;
  upsertDeploy(ev: DeployEvent): void;
  setNotes(draft: ReleaseNotesDraft): void;
  appendObservation(o: PostDeployObservation): void;
  clear(): void;
}

export const useRelease = create<ReleaseSlice>((set) => ({
  targets: new Map(),
  deploys: new Map(),
  deployOrder: [],
  notes: new Map(),
  observations: [],

  setTargets(list) {
    const m = new Map<string, DeployTarget>();
    for (const t of list) m.set(t.id, t);
    set({ targets: m });
  },

  upsertDeploy(ev) {
    set((s) => {
      const deploys = new Map(s.deploys);
      const deployOrder = deploys.has(ev.id) ? s.deployOrder : [...s.deployOrder, ev.id];
      deploys.set(ev.id, ev);
      // Mirror onto the target's summary.
      const targets = new Map(s.targets);
      const t = targets.get(ev.target_id);
      if (t) {
        targets.set(ev.target_id, {
          ...t,
          last_status: ev.status,
          last_commit: ev.commit,
          ...(ev.finished_at ? { last_deployed_at: ev.finished_at } : {}),
        });
      }
      return { deploys, deployOrder, targets };
    });
  },

  setNotes(draft) {
    set((s) => {
      const notes = new Map(s.notes);
      notes.set(draft.id, draft);
      return { notes };
    });
  },

  appendObservation(o) {
    set((s) => ({ observations: [...s.observations, o].slice(-200) }));
  },

  clear() {
    set({
      targets: new Map(),
      deploys: new Map(),
      deployOrder: [],
      notes: new Map(),
      observations: [],
    });
  },
}));
