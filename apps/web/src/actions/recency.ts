// Action usage recency — localStorage persisted.

const KEY = 'vac_web_action_recency';
const MAX_ENTRIES = 100;

interface Data {
  [actionId: string]: number; // last-used ms
}

function read(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Data;
  } catch {
    return {};
  }
}

function write(d: Data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* quota exceeded; drop silently */
  }
}

export function markUsed(id: string): void {
  const d = read();
  d[id] = Date.now();
  // Trim to MAX_ENTRIES, keep most recent.
  const entries = Object.entries(d).sort(([, a], [, b]) => b - a);
  const trimmed: Data = {};
  for (const [k, v] of entries.slice(0, MAX_ENTRIES)) trimmed[k] = v;
  write(trimmed);
}

/** Recency bonus: 30% if used in last 5 min, 10% if in last hour, 0% else. */
export function recencyBonus(id: string, now = Date.now()): number {
  const d = read();
  const t = d[id];
  if (t === undefined) return 0;
  const age = now - t;
  if (age < 5 * 60_000) return 0.3;
  if (age < 60 * 60_000) return 0.1;
  return 0;
}
