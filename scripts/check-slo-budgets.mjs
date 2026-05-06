#!/usr/bin/env node
// scripts/check-slo-budgets.mjs
//
// Slice 8.3 closeout (2026-05-06): validate the SLO budgets YAML block in
// the observability slice plan, so a malformed budget can never silently
// land. The check is structural (well-formed key + numeric ms target in
// 1..60000ms), not a runtime measurement.
//
// Source: docs/plans/wiring/41-observability-slos.md (block under `slos:`).

import { readFileSync } from 'node:fs';

const PLAN = 'docs/plans/wiring/41-observability-slos.md';
const src = readFileSync(PLAN, 'utf8');
const m = src.match(/```yaml\s*\nslos:\s*\n([\s\S]*?)\n```/);
if (!m) {
	console.error(`SLO YAML block not found in ${PLAN}`);
	process.exit(1);
}

const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
const failures = [];
const budgets = {};
for (const line of lines) {
	if (line.startsWith('#')) continue;
	const entry = line.match(/^([a-z][a-z0-9_]*):\s*(\d+)\s*$/);
	if (!entry) {
		failures.push(`malformed SLO line: ${line}`);
		continue;
	}
	const key = entry[1];
	const val = entry[2];
	if (!/_p\d+_ms$/.test(key)) failures.push(`SLO key missing _p<n>_ms suffix: ${key}`);
	const n = Number(val);
	if (!Number.isFinite(n) || n <= 0 || n > 60000) {
		failures.push(`SLO value out of range (1..60000ms): ${key}=${val}`);
	}
	budgets[key] = n;
}

if (failures.length) {
	console.error('SLO budget check FAILED:');
	for (const f of failures) console.error('  - ' + f);
	process.exit(1);
}

console.log(`✓ SLO budgets: ${Object.keys(budgets).length} entries validated`);
for (const [k, v] of Object.entries(budgets)) console.log(`  ${k} = ${v}ms`);
