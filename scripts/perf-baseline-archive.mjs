#!/usr/bin/env node
// Append the latest perf measurements (produced by the existing perf-budget
// pipeline) into .perf-baseline/history.jsonl, tagged with the commit SHA
// and timestamp. The script is best-effort: a missing or unreadable input
// file results in a logged no-op (exit 0) so CI is never broken by
// archival alone.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, '.perf-baseline');
const OUT_FILE = path.join(OUT_DIR, 'history.jsonl');
const SOURCE = process.env.PERF_MEASUREMENTS_FILE
  || path.join(ROOT, '.perf-budget', 'measurements.json');

if (!fs.existsSync(SOURCE)) {
  console.warn(`[perf-baseline-archive] no measurements at ${SOURCE}, skipping.`);
  process.exit(0);
}

let measurements;
try {
  measurements = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
} catch (err) {
  console.warn(`[perf-baseline-archive] could not parse ${SOURCE}: ${(err && err.message) || err}`);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const sha = (process.env.GITHUB_SHA || '').slice(0, 12);
const ref = process.env.GITHUB_REF || '';
const runId = process.env.GITHUB_RUN_ID || '';
const entry = {
  recorded_at: new Date().toISOString(),
  commit: sha || null,
  ref: ref || null,
  run_id: runId || null,
  measurements,
};

fs.appendFileSync(OUT_FILE, JSON.stringify(entry) + '\n');
console.log(`[perf-baseline-archive] appended entry for ${sha || 'local'} to ${OUT_FILE}`);
