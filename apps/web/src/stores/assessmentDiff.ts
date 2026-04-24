// AssessmentDiff compute: 4-way classification keyed by identity_hash.
//
// resolved   — present in prev run, absent in new
// persistent — present in both, same severity
// regressed  — present in both, severity increased
// new        — absent in prev, present in new

import type { Finding, Severity } from './assessment';

export type DiffBucket = 'resolved' | 'persistent' | 'regressed' | 'new';

const SEV_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface DiffEntry {
  bucket: DiffBucket;
  identity_hash: string;
  prev?: Finding;
  next?: Finding;
}

export interface DiffResult {
  entries: DiffEntry[];
  counts: Record<DiffBucket, number>;
}

export function computeDiff(prev: Finding[], next: Finding[]): DiffResult {
  const prevByHash = new Map<string, Finding>();
  for (const f of prev) prevByHash.set(f.identity_hash, f);
  const nextByHash = new Map<string, Finding>();
  for (const f of next) nextByHash.set(f.identity_hash, f);

  const entries: DiffEntry[] = [];
  const counts: Record<DiffBucket, number> = {
    resolved: 0,
    persistent: 0,
    regressed: 0,
    new: 0,
  };

  for (const [hash, p] of prevByHash) {
    const n = nextByHash.get(hash);
    if (!n) {
      entries.push({ bucket: 'resolved', identity_hash: hash, prev: p });
      counts.resolved++;
    } else if (SEV_ORDER[n.severity] > SEV_ORDER[p.severity]) {
      entries.push({ bucket: 'regressed', identity_hash: hash, prev: p, next: n });
      counts.regressed++;
    } else {
      entries.push({ bucket: 'persistent', identity_hash: hash, prev: p, next: n });
      counts.persistent++;
    }
  }
  for (const [hash, n] of nextByHash) {
    if (!prevByHash.has(hash)) {
      entries.push({ bucket: 'new', identity_hash: hash, next: n });
      counts.new++;
    }
  }

  return { entries, counts };
}

/**
 * Convergence check: compare current cycle to history.
 * Stuck = for 3 consecutive cycles, `persistent + regressed` does not strictly decrease.
 */
export function isStuck(history: number[]): boolean {
  if (history.length < 3) return false;
  const tail = history.slice(-3);
  return tail[0]! <= tail[1]! && tail[1]! <= tail[2]!;
}
