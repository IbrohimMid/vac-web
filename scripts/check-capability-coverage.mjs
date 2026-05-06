#!/usr/bin/env node
// scripts/check-capability-coverage.mjs
//
// Slice 1.2 + 5.1 closeout (2026-05-06): validate that every backend code
// class under apps/local-bridge/src/ is mapped to a capability id in
// config/capability-coverage.yaml.
//
// Failure modes (each exits non-zero):
//   - manifest entry references a missing file
//   - filesystem has a backend module/file with no manifest entry (and not
//     on the exempt list)
//   - manifest has duplicate keys or malformed lines

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/local-bridge/src';
const MANIFEST = 'config/capability-coverage.yaml';
const EXEMPT_NAMES = new Set(['lib.rs', 'main.rs', 'generated']);

function parseManifest(src) {
	const map = new Map();
	const errs = [];
	let lineNum = 0;
	for (const raw of src.split('\n')) {
		lineNum++;
		const line = raw.replace(/#.*$/, '').trim();
		if (!line) continue;
		const m = line.match(/^([^:]+):\s*([a-z][a-z0-9_.]*)\s*$/);
		if (!m) {
			errs.push(`line ${lineNum}: malformed entry: ${raw}`);
			continue;
		}
		const path = m[1].trim();
		const cap = m[2];
		if (map.has(path)) errs.push(`line ${lineNum}: duplicate key: ${path}`);
		map.set(path, cap);
	}
	return { map, errs };
}

function discoverBackendUnits() {
	const units = [];
	for (const entry of readdirSync(ROOT)) {
		if (EXEMPT_NAMES.has(entry)) continue;
		const full = join(ROOT, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			const mod = join(full, 'mod.rs');
			if (existsSync(mod)) units.push(mod);
		} else if (entry.endsWith('.rs')) {
			units.push(full);
		}
	}
	return units.sort();
}

const manifestSrc = readFileSync(MANIFEST, 'utf8');
const { map, errs: parseErrs } = parseManifest(manifestSrc);
const failures = [...parseErrs];

for (const [path] of map) {
	if (!existsSync(path)) failures.push(`manifest entry missing on disk: ${path}`);
}

const units = discoverBackendUnits();
for (const unit of units) {
	if (!map.has(unit)) failures.push(`untracked backend module: ${unit} (add it to ${MANIFEST})`);
}

if (failures.length) {
	console.error('Capability coverage check FAILED:');
	for (const f of failures) console.error('  - ' + f);
	console.error(`\nSee docs/capabilities/README.md for the convention.`);
	process.exit(1);
}

console.log(`✓ Capability coverage: ${map.size} backend modules tagged across ${units.length} discovered units`);
for (const [path, cap] of map) console.log(`  ${path} → ${cap}`);
