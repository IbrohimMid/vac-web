// HandoffBuilder visible-list logic — extracted from the component so the
// "active-run medium+ ∪ selected (any)" contract is testable without DOM.
//
// Acceptance from Stage J audit: a finding selected via the report flow
// MUST be visible in the picker even when its run differs from the active
// run, or when its severity is below the medium floor.

import type { Finding, Severity } from '../../stores/assessment';

const SEV_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export function visibleHandoffFindings(
  all: Iterable<Finding>,
  activeRunId: string | null,
  selected: ReadonlySet<string>,
): Finding[] {
  const seen = new Set<string>();
  const list: Finding[] = [];
  for (const f of all) {
    const eligible =
      (!activeRunId || f.run_id === activeRunId) &&
      SEV_ORDER[f.severity] >= SEV_ORDER.medium;
    if (!eligible && !selected.has(f.id)) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    list.push(f);
  }
  list.sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]);
  return list;
}

export function isCarryover(
  f: Finding,
  activeRunId: string | null,
  selected: ReadonlySet<string>,
): boolean {
  if (!selected.has(f.id)) return false;
  const fromOtherRun = activeRunId != null && f.run_id !== activeRunId;
  const belowFloor = SEV_ORDER[f.severity] < SEV_ORDER.medium;
  return fromOtherRun || belowFloor;
}
