import { create } from 'zustand';
import type { Severity } from '../components/SeverityIcon';

export interface Facet {
  kind: string;
  label: string;
  severity: Severity;
  actionId?: string;
}

interface PulseSlice {
  facets: Facet[];
  setFacets(f: Facet[]): void;
}

export const useSystemPulse = create<PulseSlice>((set) => ({
  facets: [],
  setFacets(f) {
    set({ facets: f });
  },
}));
