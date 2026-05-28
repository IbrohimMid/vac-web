#!/usr/bin/env node
// scripts/check-ownership-coverage.mjs
//
// Zero-tolerance ownership coverage validation script.
// Verifies that every single file and folder in the vac-web repository is
// accounted for in `.vac/registry/ownership.yaml` to prevent code bloat,
// backend-only features, and untracked dead code.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';

const OWNER_MANIFEST = '.vac/registry/ownership.yaml';

if (!existsSync(OWNER_MANIFEST)) {
	console.error(`Error: Ownership manifest not found at ${OWNER_MANIFEST}`);
	process.exit(1);
}

// 1. Load and parse the ownership manifest
let manifest;
try {
	manifest = yaml.load(readFileSync(OWNER_MANIFEST, 'utf8'));
} catch (e) {
	console.error(`Error: Failed to parse ${OWNER_MANIFEST}: ${e.message}`);
	process.exit(1);
}

const { exempt_paths = [], owners = {} } = manifest;

// 2. Segment-based Glob to Regex compiler (bulletproof)
function globToRegex(glob) {
	const segments = glob.split('/');
	const regexSegments = segments.map((seg, idx) => {
		if (seg === '**') {
			if (idx === 0) return '(?:.*/)?';
			if (idx === segments.length - 1) return '(?:/.*)?';
			return '(?:.*/)?';
		}
		// Escape standard regex characters except * and ?
		let pattern = seg.replace(/[-\/\\^$*+?.()|[\]{}]/g, (match) => {
			if (match === '*' || match === '?') return match;
			return '\\' + match;
		});
		pattern = pattern.replace(/\*/g, '[^\\/]*');
		pattern = pattern.replace(/\?/g, '.');
		return pattern;
	});

	let regexStr = '';
	for (let i = 0; i < regexSegments.length; i++) {
		const seg = regexSegments[i];
		if (seg === '(?:.*/)?' || seg === '(?:/.*)?') {
			regexStr += seg;
		} else {
			if (regexStr && !regexStr.endsWith(')?') && !regexStr.endsWith('/')) {
				regexStr += '\\/';
			}
			regexStr += seg;
		}
	}
	return new RegExp('^' + regexStr + '$');
}

const exemptRegexes = exempt_paths.map(globToRegex);

// Collect all ownership patterns mapped to their respective owner keys
const ownerMappings = [];
for (const [ownerKey, ownerDef] of Object.entries(owners)) {
	const paths = ownerDef.paths || [];
	for (const pattern of paths) {
		ownerMappings.push({
			owner: ownerKey,
			pattern,
			regex: globToRegex(pattern),
		});
	}
}

// 3. Recursive filesystem walker
function walk(dir, fileList = []) {
	const files = readdirSync(dir);
	for (const file of files) {
		const fullPath = join(dir, file);
		const relPath = relative('.', fullPath);

		// Check if directory/file itself is exempt to avoid entering it
		const isExempt = exemptRegexes.some((regex) => regex.test(relPath) || regex.test(relPath + '/'));
		if (isExempt) {
			continue;
		}

		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			walk(fullPath, fileList);
		} else if (stat.isFile()) {
			fileList.push(relPath);
		}
	}
	return fileList;
}

// 4. Perform the check
console.log('Scanning workspace for untracked code and files...');
const allFiles = walk('.');
const untracked = [];
const trackedStats = new Map();

for (const file of allFiles) {
	let matched = false;
	for (const mapping of ownerMappings) {
		if (mapping.regex.test(file)) {
			matched = true;
			trackedStats.set(mapping.owner, (trackedStats.get(mapping.owner) || 0) + 1);
		}
	}
	if (!matched) {
		untracked.push(file);
	}
}

// 5. Report results
if (untracked.length > 0) {
	console.error('\n✗ Path ownership validation FAILED!');
	console.error(`Found ${untracked.length} untracked files in the workspace.`);
	console.error('All files must be explicitly registered under an owner in `.vac/registry/ownership.yaml` to prevent code bloat and dead code.');
	console.error('\nUntracked files list:');
	for (const file of untracked.slice(0, 50)) {
		console.error(`  - ${file}`);
	}
	if (untracked.length > 50) {
		console.error(`  ... and ${untracked.length - 50} more files.`);
	}
	process.exit(1);
}

console.log('\n✓ Path ownership validation SUCCESSFUL!');
console.log(`Matched ${allFiles.length} files under strict .vac/registry/ownership.yaml maps:`);
for (const [owner, count] of trackedStats.entries()) {
	console.log(`  - Team [${owner}]: tracks ${count} files`);
}
process.exit(0);
