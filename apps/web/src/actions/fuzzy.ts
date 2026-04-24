// Tiny fuzzy matcher — scores how well `query` matches `target`.
// Returns null if no match; else a number in [0, 1] (higher = better).

export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0.5;
  let qi = 0;
  let lastMatch = -1;
  let runBonus = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (lastMatch === ti - 1) runBonus += 0.05;
      lastMatch = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  // Heuristic score: letter-density + startswith bonus + run bonus.
  const density = q.length / t.length;
  const startsBonus = t.startsWith(q) ? 0.3 : 0;
  return Math.min(1, density + startsBonus + runBonus);
}
