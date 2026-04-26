// Runtime jobs store: background jobs list + ring-buffered log tails per job.

import { create } from 'zustand';

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  toolCallId?: string;
  approvedByApprovalId?: string | null;
  sourceEventType?: string;
  commandPreview?: string | null;
  outputPreview?: string | null;
  outputTruncated?: boolean;
  outputRedacted?: boolean;
}

export interface LogLine {
  ts: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

const LOG_CAP = 1000;

interface RuntimeSlice {
  jobs: Map<string, Job>;
  order: string[];
  logs: Map<string, LogLine[]>;
  upsert(job: Job): void;
  appendLog(id: string, line: LogLine): void;
  remove(id: string): void;
  clear(): void;
}

export const useRuntime = create<RuntimeSlice>((set) => ({
  jobs: new Map(),
  order: [],
  logs: new Map(),

  upsert(job) {
    set((s) => {
      const jobs = new Map(s.jobs);
      const order = jobs.has(job.id) ? s.order : [...s.order, job.id];
      jobs.set(job.id, job);
      return { jobs, order };
    });
  },

  appendLog(id, line) {
    set((s) => {
      const logs = new Map(s.logs);
      const prev = logs.get(id) ?? [];
      const next = prev.length >= LOG_CAP ? [...prev.slice(prev.length - LOG_CAP + 1), line] : [...prev, line];
      logs.set(id, next);
      return { logs };
    });
  },

  remove(id) {
    set((s) => {
      const jobs = new Map(s.jobs);
      jobs.delete(id);
      const logs = new Map(s.logs);
      logs.delete(id);
      return {
        jobs,
        order: s.order.filter((x) => x !== id),
        logs,
      };
    });
  },

  clear() {
    set({ jobs: new Map(), order: [], logs: new Map() });
  },
}));
