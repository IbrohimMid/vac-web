#!/usr/bin/env node
// scripts/vac-doctor.mjs
//
// Authoritative custom doctor tool for vac-web's `.vac` control plane.
// Runs check subcommands to guarantee codebase alignment with .vac rules.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAC_DIR = path.join(ROOT, '.vac');

// Helper: load YAML
function loadYaml(filePath) {
	try {
		return yaml.load(fs.readFileSync(filePath, 'utf8'));
	} catch (e) {
		throw new Error(`Failed to read/parse ${path.relative(ROOT, filePath)}: ${e.message}`);
	}
}

// Helper: find all files in directory matching extension
function findYamlFiles(dirPath) {
	if (!fs.existsSync(dirPath)) return [];
	return fs.readdirSync(dirPath)
		.filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
		.map(file => path.join(dirPath, file));
}

// Helper: robust glob-to-regex for path mapping
function globToRegex(glob) {
	const segments = glob.split('/');
	const regexSegments = segments.map((seg, idx) => {
		if (seg === '**') {
			if (idx === 0) return '(?:.*/)?';
			if (idx === segments.length - 1) return '(?:/.*)?';
			return '(?:.*/)?';
		}
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

// =============================================================================
// SUBCOMMANDS
// =============================================================================

// 1. REGISTRY CHECK
function checkRegistry() {
	console.log('🩺 Running [vac doctor registry]...');
	const errors = [];
	
	const domainsFile = path.join(VAC_DIR, 'registry/domains.yaml');
	const productFile = path.join(VAC_DIR, 'registry/product.yaml');
	const statusFile = path.join(VAC_DIR, 'registry/status.yaml');

	if (!fs.existsSync(domainsFile)) errors.push('Missing registry/domains.yaml');
	if (!fs.existsSync(productFile)) errors.push('Missing registry/product.yaml');
	if (!fs.existsSync(statusFile)) errors.push('Missing registry/status.yaml');

	if (errors.length > 0) return { ok: false, errors };

	// Parse registries
	const domainsDoc = loadYaml(domainsFile);
	const productDoc = loadYaml(productFile);
	const statusDoc = loadYaml(statusFile);

	if (domainsDoc.schema_version !== 1 || domainsDoc.kind !== 'domains') {
		errors.push('registry/domains.yaml: invalid schema_version or kind');
	}
	if (productDoc.schema_version !== 1 || productDoc.kind !== 'product') {
		errors.push('registry/product.yaml: invalid schema_version or kind');
	}
	if (statusDoc.schema_version !== 1 || statusDoc.kind !== 'status') {
		errors.push('registry/status.yaml: invalid schema_version or kind');
	}

	// Cross-reference with capabilities folder
	const capabilityFiles = findYamlFiles(path.join(VAC_DIR, 'capabilities'));
	const capIds = new Set();
	for (const file of capabilityFiles) {
		const doc = loadYaml(file);
		if (doc.id) {
			capIds.add(doc.id);
		}
	}

	const registeredDomains = new Set((domainsDoc.domains || []).map(d => d.id));

	// Every capability ID (stripped of bridge.) must exist in domains.yaml
	for (const capId of capIds) {
		const stripped = capId.replace('bridge.', '');
		if (!registeredDomains.has(stripped)) {
			errors.push(`Capability ID '${capId}' is declared in capabilities/ but missing in registry/domains.yaml`);
		}
	}

	// Every domain in domains.yaml must correspond to an active capability file
	for (const domain of registeredDomains) {
		const expectedCapId = `bridge.${domain}`;
		if (!capIds.has(expectedCapId)) {
			errors.push(`Domain '${domain}' is registered in domains.yaml but missing corresponding capabilities file`);
		}
	}

	return { ok: errors.length === 0, errors };
}

// 2. WORKFLOW CHECK
function checkWorkflows() {
	console.log('🩺 Running [vac doctor workflow]...');
	const errors = [];
	
	// Collect valid capability IDs
	const capabilityFiles = findYamlFiles(path.join(VAC_DIR, 'capabilities'));
	const capIds = new Set();
	for (const file of capabilityFiles) {
		const doc = loadYaml(file);
		if (doc.id) capIds.add(doc.id);
	}

	const workflowFiles = findYamlFiles(path.join(VAC_DIR, 'workflows'));
	if (workflowFiles.length === 0) {
		errors.push('No workflow manifests found under workflows/');
	}

	for (const file of workflowFiles) {
		const doc = loadYaml(file);
		const relName = path.relative(ROOT, file);

		if (doc.schema_version !== 1 || doc.kind !== 'workflow') {
			errors.push(`${relName}: invalid schema_version or kind`);
			continue;
		}

		// Verify workflow steps map to actual capabilities
		const steps = doc.steps || [];
		for (const step of steps) {
			if (!step.id) errors.push(`${relName}: step missing id`);
			if (!step.uses) {
				errors.push(`${relName}: step '${step.id}' missing 'uses' field`);
				continue;
			}

			// e.g. capability.build.format_check -> we map capability. to bridge. namespace
			const usesCap = step.uses.replace('capability.', 'bridge.');
			// Extract capability domain prefix (e.g. bridge.build)
			const parts = usesCap.split('.');
			if (parts.length < 2) {
				errors.push(`${relName}: step '${step.id}' has malformed capability use '${step.uses}'`);
				continue;
			}
			const domainCap = `${parts[0]}.${parts[1]}`;

			if (!capIds.has(domainCap)) {
				errors.push(`${relName}: step '${step.id}' uses capability domain '${domainCap}' which is not declared in capabilities/`);
			}
		}
	}

	return { ok: errors.length === 0, errors };
}

// 3. POLICY CHECK
function checkPolicies() {
	console.log('🩺 Running [vac doctor policy]...');
	const errors = [];

	const extensionTrustFile = path.join(VAC_DIR, 'policies/extension-trust.yaml');
	const sessionResumeFile = path.join(VAC_DIR, 'policies/session-resume.yaml');
	const defaultLocalFile = path.join(VAC_DIR, 'policies/default-local.yaml');

	if (!fs.existsSync(extensionTrustFile)) errors.push('Missing policies/extension-trust.yaml');
	if (!fs.existsSync(sessionResumeFile)) errors.push('Missing policies/session-resume.yaml');
	if (!fs.existsSync(defaultLocalFile)) errors.push('Missing policies/default-local.yaml');

	if (errors.length > 0) return { ok: false, errors };

	// Verify extension-trust values
	const extDoc = loadYaml(extensionTrustFile);
	if (extDoc.schema_version !== 1 || extDoc.kind !== 'policy') {
		errors.push('policies/extension-trust.yaml: invalid schema_version or kind');
	}
	if (typeof extDoc.allow_unsigned !== 'boolean') {
		errors.push('policies/extension-trust.yaml: allow_unsigned must be a boolean');
	}

	// Verify session-resume thresholds
	const resDoc = loadYaml(sessionResumeFile);
	if (resDoc.schema_version !== 1 || resDoc.kind !== 'policy') {
		errors.push('policies/session-resume.yaml: invalid schema_version or kind');
	}
	const sr = resDoc.session_resume || {};
	if (!sr.default_mode) errors.push('policies/session-resume.yaml: missing session_resume.default_mode');
	if (typeof sr.retention_days !== 'number') {
		errors.push('policies/session-resume.yaml: session_resume.retention_days must be a number');
	}

	return { ok: errors.length === 0, errors };
}

// 4. SURFACE CHECK
function checkSurfaces() {
	console.log('🩺 Running [vac doctor surfaces]...');
	const errors = [];

	// Collect valid capability IDs
	const capabilityFiles = findYamlFiles(path.join(VAC_DIR, 'capabilities'));
	const capIds = new Set();
	for (const file of capabilityFiles) {
		const doc = loadYaml(file);
		if (doc.id) capIds.add(doc.id);
	}

	const surfaceFiles = findYamlFiles(path.join(VAC_DIR, 'surfaces'));
	if (surfaceFiles.length === 0) {
		errors.push('No surface manifests found under surfaces/');
	}

	for (const file of surfaceFiles) {
		const doc = loadYaml(file);
		const relName = path.relative(ROOT, file);

		if (doc.schema_version !== 1 || doc.kind !== 'surface') {
			errors.push(`${relName}: invalid schema_version or kind`);
			continue;
		}

		// Verify every declared surface capability exists
		const sCaps = doc.capabilities || [];
		for (const cap of sCaps) {
			if (!capIds.has(cap)) {
				errors.push(`${relName}: capability list references undeclared capability '${cap}'`);
			}
		}

		// Verify routes map to valid capabilities
		const routes = doc.routes || [];
		for (const route of routes) {
			if (route.capability && !capIds.has(route.capability)) {
				errors.push(`${relName}: route '${route.event || route.path}' maps to undeclared capability '${route.capability}'`);
			}
		}
	}

	return { ok: errors.length === 0, errors };
}

// 5. OWNERSHIP CHECK
function checkOwnership() {
	console.log('🩺 Running [vac doctor ownership]...');
	const errors = [];
	
	const ownershipFile = path.join(VAC_DIR, 'registry/ownership.yaml');
	if (!fs.existsSync(ownershipFile)) {
		errors.push('Missing registry/ownership.yaml');
		return { ok: false, errors };
	}

	const ownershipDoc = loadYaml(ownershipFile);
	if (ownershipDoc.schema_version !== 1 || ownershipDoc.kind !== 'ownership') {
		errors.push('registry/ownership.yaml: invalid schema_version or kind');
	}

	const { exempt_paths = [], owners = {} } = ownershipDoc;
	const exemptRegexes = exempt_paths.map(globToRegex);

	const ownerMappings = [];
	for (const [ownerKey, ownerDef] of Object.entries(owners)) {
		const paths = ownerDef.paths || [];
		for (const pattern of paths) {
			ownerMappings.push({
				owner: ownerKey,
				regex: globToRegex(pattern),
			});
		}
	}

	// Walker
	function walk(dir, fileList = []) {
		const files = fs.readdirSync(dir);
		for (const file of files) {
			const fullPath = path.join(dir, file);
			const relPath = path.relative('.', fullPath);

			if (file.startsWith('.') && file !== '.vac') {
				continue;
			}

			const isExempt = exemptRegexes.some((regex) => regex.test(relPath) || regex.test(relPath + '/'));
			if (isExempt) {
				continue;
			}

			const stat = fs.statSync(fullPath);
			if (stat.isDirectory()) {
				walk(fullPath, fileList);
			} else if (stat.isFile()) {
				fileList.push(relPath);
			}
		}
		return fileList;
	}

	let allFiles;
	try {
		allFiles = walk('.');
	} catch (e) {
		errors.push(`Filesystem traversal failed: ${e.message}`);
		return { ok: false, errors };
	}

	const untracked = [];
	for (const file of allFiles) {
		let matched = false;
		for (const mapping of ownerMappings) {
			if (mapping.regex.test(file)) {
				matched = true;
				break;
			}
		}
		if (!matched) {
			untracked.push(file);
		}
	}

	if (untracked.length > 0) {
		errors.push(`Found ${untracked.length} untracked files in the workspace. All files must be explicitly registered under an owner in registry/ownership.yaml`);
		// Print first 5 files in doctor logs for trace
		console.error('  Untracked sample:');
		for (const file of untracked.slice(0, 5)) {
			console.error(`    - ${file}`);
		}
	}

	return { ok: errors.length === 0, errors };
}

// =============================================================================
// MAIN DISPATCHER
// =============================================================================
function main() {
	console.log('🩺 Starting Custom vac-doctor for vac-web...');
	
	const checks = [
		{ name: 'Registry', run: checkRegistry },
		{ name: 'Workflow', run: checkWorkflows },
		{ name: 'Policy', run: checkPolicies },
		{ name: 'Surfaces', run: checkSurfaces },
		{ name: 'Ownership', run: checkOwnership }
	];

	let totalErrors = 0;
	
	for (const check of checks) {
		console.log('--------------------------------------------------');
		try {
			const res = check.run();
			if (res.ok) {
				console.log(`✓ [vac doctor] ${check.name} check: SUCCESS`);
			} else {
				console.error(`✗ [vac doctor] ${check.name} check: FAILED`);
				for (const err of res.errors) {
					console.error(`  - ${err}`);
				}
				totalErrors += res.errors.length;
			}
		} catch (e) {
			console.error(`✗ [vac doctor] ${check.name} check: PANICKED`);
			console.error(`  - ${e.message}`);
			totalErrors++;
		}
	}

	console.log('==================================================');
	if (totalErrors > 0) {
		console.error(`\n🩺 [vac doctor] FAILED with ${totalErrors} issue(s) across .vac files.`);
		process.exit(1);
	} else {
		console.log('\n✓ 🩺 [vac doctor] SUCCESS! Workspace complies 100% with .vac control plane rules.');
		process.exit(0);
	}
}

main();
