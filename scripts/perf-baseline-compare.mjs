#!/usr/bin/env node
// Compare the most recent perf measurement against a rolling window in
// .perf-baseline/history.jsonl. Flags any p95/median/p99 that has regressed
// more than --threshold percent vs the median of the last --window entries.
// Defaults: warn-only (exit 0). Pass --strict to exit 1 on regression so the
// CI step can later be made gating.
//
// CLI:  node scripts/perf-baseline-compare.mjs --window 10 --threshold 25 [--strict]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}
const windowSize = Number(flag('window', '10'));
const thresholdPct = Number(flag('threshold', '25'));
const strict = args.includes('--strict');

const HIST = path.join(process.cwd(), '.perf-baseline', 'history.jsonl');
if (!fs.existsSync(HIST)) {
  console.log('[perf-baseline-compare] no history yet, skipping.');
  process.exit(0);
}

const lines = fs.readFileSync(HIST, 'utf8').split('\n').filter(Boolean);
if (lines.length < 2) {
  console.log(`[perf-baseline-compare] only ${lines.length} entry, need >=2; skipping.`);
  process.exit(0);
}

const entries = lines
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

const latest = entries[entries.length - 1];
const window = entries.slice(Math.max(0, entries.length - 1 - windowSize), entries.length - 1);
if (window.length === 0) {
  console.log('[perf-baseline-compare] no prior entries in window, skipping.');
  process.exit(0);
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const metrics = ['p95_ms', 'median_ms', 'p99_ms'];
const regressions = [];
const ok = [];
const latestM = latest.measurements || {};

for (const [name, latestRow] of Object.entries(latestM)) {
  if (!latestRow || typeof latestRow !== 'object') continue;
  for (const metric of metrics) {
    const latestVal = Number(latestRow[metric]);
    if (!Number.isFinite(latestVal)) continue;
    const windowVals = window
      .map((e) => {
        const row = (e.measurements || {})[name];
        if (!row || typeof row !== 'object') return NaN;
        return Number(row[metric]);
      })
      .filter((v) => Number.isFinite(v));
    const baseline = median(windowVals);
    if (baseline == null || baseline === 0) continue;
    const deltaPct = ((latestVal - baseline) / baseline) * 100;
    const row = {
      measurement: name,
      metric,
      latest: latestVal,
      baseline,
      delta_pct: Number(deltaPct.toFixed(2)),
    };
    if (deltaPct > thresholdPct) regressions.push(row);
    else ok.push(row);
  }
}

console.log(`[perf-baseline-compare] window=${window.length} threshold=${thresholdPct}%`);
console.log(JSON.stringify({ regressions, ok }, null, 2));

if (regressions.length > 0) {
  console.warn(`[perf-baseline-compare] ${regressions.length} regression(s) over threshold.`);
  if (strict) process.exit(1);
}
