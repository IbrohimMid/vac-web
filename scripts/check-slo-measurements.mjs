#!/usr/bin/env node
// check-slo-measurements.mjs — assert tools/perf output meets SLO budgets.
//
// Slice 41 follow-up (R6, 2026-05-06).
//
// Usage:
//   node scripts/check-slo-measurements.mjs <perf-results.json>
//   node scripts/check-slo-measurements.mjs <perf-results.json> --strict
//   node scripts/check-slo-measurements.mjs <perf-results.json> --measurement-only
//
// Phase 1 default: measurement-only (warn but exit 0). Phase 2 will flip default
// to fail-on-exceed once a 2-week baseline establishes the CI-runner noise floor.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGETS_PATH = path.join(ROOT, 'config/slo-budgets.yaml');

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`check-slo-measurements — assert perf JSON meets SLO budgets.

Usage:
  node scripts/check-slo-measurements.mjs <perf-results.json>
  node scripts/check-slo-measurements.mjs <perf-results.json> --strict
  node scripts/check-slo-measurements.mjs <perf-results.json> --measurement-only

Defaults to --measurement-only in Phase 1 (warn but exit 0).
`);
  process.exit(args.length === 0 ? 1 : 0);
}

const inputPath = args[0];
const strict = args.includes('--strict');

function loadBudgets() {
  const raw = fs.readFileSync(BUDGETS_PATH, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || !Array.isArray(doc.budgets)) {
    throw new Error(`${BUDGETS_PATH}: missing budgets[] array`);
  }
  const map = new Map();
  for (const b of doc.budgets) {
    if (!b || typeof b.subsystem !== 'string' || typeof b.p95_ms !== 'number') {
      throw new Error(`${BUDGETS_PATH}: malformed budget entry`);
    }
    map.set(b.subsystem, b);
  }
  return map;
}

function loadMeasurements(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const doc = JSON.parse(raw);
  if (!doc || !Array.isArray(doc.measurements)) {
    throw new Error(`${p}: missing measurements[] array`);
  }
  return doc;
}

function main() {
  const budgets = loadBudgets();
  const report = loadMeasurements(inputPath);

  const exceeds = [];
  const ok = [];
  const orphans = [];

  for (const m of report.measurements) {
    const b = budgets.get(m.subsystem);
    if (!b) {
      orphans.push(m.subsystem);
      continue;
    }
    if (typeof m.p95_ms !== 'number') {
      throw new Error(`measurement ${m.subsystem}: missing p95_ms`);
    }
    if (m.p95_ms > b.p95_ms) {
      exceeds.push({ subsystem: m.subsystem, observed_p95_ms: m.p95_ms, budget_p95_ms: b.p95_ms });
    } else {
      ok.push({ subsystem: m.subsystem, observed_p95_ms: m.p95_ms, budget_p95_ms: b.p95_ms });
    }
  }

  const missing = [...budgets.keys()].filter(
    (s) => !report.measurements.some((m) => m.subsystem === s)
  );

  console.log(
    `check-slo-measurements: ${report.measurements.length} measurements vs ${budgets.size} budgets`
  );
  console.log(`  phase: ${report.phase || 'unknown'}`);
  console.log(`  mode: ${strict ? 'strict' : 'measurement-only'}`);
  for (const r of ok) {
    console.log(`  OK   ${r.subsystem}  p95=${r.observed_p95_ms}ms  budget=${r.budget_p95_ms}ms`);
  }
  for (const r of exceeds) {
    console.log(`  OVER ${r.subsystem}  p95=${r.observed_p95_ms}ms  budget=${r.budget_p95_ms}ms`);
  }
  for (const s of orphans) {
    console.log(`  ORPHAN measurement (no budget)  ${s}`);
  }
  for (const s of missing) {
    console.log(`  MISSING measurement (budgeted but not measured)  ${s}`);
  }

  if (exceeds.length > 0 && strict) {
    console.error(`FAIL: ${exceeds.length} subsystems exceed budget`);
    process.exit(1);
  }
  if (exceeds.length > 0) {
    console.warn(
      `WARN: ${exceeds.length} subsystems exceed budget (measurement-only mode; exit 0)`
    );
  }
  if (missing.length > 0) {
    console.warn(`WARN: ${missing.length} budgeted subsystems missing measurements`);
  }
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`check-slo-measurements: ERROR ${err.message}`);
  process.exit(2);
}
