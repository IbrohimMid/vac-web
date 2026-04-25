// Shared ActionSpec filter — both the ⌘K command palette and the `/` slash
// composer trigger funnel through this so command discovery cannot drift.
//
// Behavior (locked):
//   1. Source: full registry from useActions.
//   2. Visibility:
//        - `mode === 'palette'`  → `palette_visible === true`
//        - `mode === 'slash'`    → `slash_alias != null` (commands that opted
//                                  into a slash form)
//   3. Score:
//        - empty query → 1.0 baseline (so recently-used + alphabetical-ish
//          ordering matters; recency bonus adds on top).
//        - non-empty query → fuzzyScore(label) ?? fuzzyScore(id).
//          For slash mode, also tries fuzzyScore(slash_alias) so typing
//          `/asse` matches the alias even if the label is "Run RTD".
//        - `null` from fuzzyScore = filtered out.
//   4. Recency bonus added to base score.
//   5. Predicate `available_when` evaluated against `ctx`; predicate failures
//      annotate the row with `disabledReason` instead of removing it (lets
//      the UI render disabled with a tooltip).
//   6. Sort by score desc, slice to `limit`.

import { fuzzyScore } from './fuzzy';
import { evaluate, type Context } from './predicate';
import { recencyBonus } from './recency';
import type { ActionSpec } from './registry';

export type FilterMode = 'palette' | 'slash';

export interface FilteredRow {
  action: ActionSpec;
  score: number;
  disabledReason?: string;
}

export interface FilterArgs {
  actions: ActionSpec[];
  query: string;
  mode: FilterMode;
  ctx: Context;
  limit?: number;
}

const DEFAULT_LIMIT = 30;

export function filterActions({
  actions,
  query,
  mode,
  ctx,
  limit = DEFAULT_LIMIT,
}: FilterArgs): FilteredRow[] {
  const out: FilteredRow[] = [];
  for (const a of actions) {
    if (!isVisible(a, mode)) continue;
    const baseScore = scoreAction(a, query, mode);
    if (baseScore === null) continue;
    const score = baseScore + recencyBonus(a.id);
    const availableOk = evaluate(a.available_when ?? null, ctx);
    const row: FilteredRow = { action: a, score };
    if (!availableOk) row.disabledReason = `unavailable: ${a.available_when}`;
    out.push(row);
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}

function isVisible(a: ActionSpec, mode: FilterMode): boolean {
  if (mode === 'palette') return a.palette_visible === true;
  // mode === 'slash'
  return typeof a.slash_alias === 'string' && a.slash_alias.length > 0;
}

function scoreAction(a: ActionSpec, query: string, mode: FilterMode): number | null {
  if (!query) return 1;
  const candidates: string[] = [a.label, a.id];
  if (mode === 'slash' && a.slash_alias) candidates.push(a.slash_alias);
  let best: number | null = null;
  for (const c of candidates) {
    const s = fuzzyScore(query, c);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}
