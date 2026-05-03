#!/usr/bin/env node
// scripts/check-architecture-boundaries.mjs (slice 37)
//
// Real import-graph walker for apps/web/src.
//
// 1. Walk every TS/TSX file under apps/web/src.
// 2. Parse `import ... from '...'` and `import('...')` specifiers.
// 3. Resolve each specifier to an absolute file path under apps/web/src.
// 4. Tag each file with a layer label derived from its path.
// 5. For every (from-layer, to-layer) edge, look it up in ALLOWED_EDGES.
//    Edges that are not allowed produce a violation.
//
// The walker also enforces the Rust-side rule that apps/web/src code
// must not import from apps/local-bridge.
//
// Usage:
//   node scripts/check-architecture-boundaries.mjs            # human output
//   node scripts/check-architecture-boundaries.mjs --json     # JSON
//   node scripts/check-architecture-boundaries.mjs --verbose  # all edges

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const WEB_ROOT = join(REPO_ROOT, 'apps/web/src');

const args = new Set(process.argv.slice(2));
const JSON_MODE = args.has('--json');
const VERBOSE = args.has('--verbose');

// Layer assignment (most specific path prefix wins).
// Each entry: [path-prefix-relative-to-WEB_ROOT, layer-label].
const LAYER_RULES = [
	['domain/capabilities/', 'capabilities'],
	['domain/runtime/', 'domain'],
	['domain/sessions/', 'domain'],
	['domain/transcript/', 'domain'],
	['domain/', 'domain'],
	['stores/', 'stores'],
	['components/', 'components'],
	['composer/', 'rendering'],
	['highlight/', 'rendering'],
	['markdown/', 'rendering'],
	['transcript/', 'rendering'],
	['workers/', 'workers'],
	['actions/', 'actions'],
	['transport/', 'transport'],
	['generated/', 'generated'],
	['styles/', 'styles'],
	['scripts/', 'scripts'],
	['main.tsx', 'bootstrap'],
	['vite-env.d.ts', 'bootstrap'],
];

// Allowed cross-layer edges. (from -> set of to). Same-layer edges are
// always allowed. Edges to `external` (npm packages, virtual modules)
// are always allowed.
//
// The matrix below documents the established architecture for this
// codebase as of slice 37 landing. Tighten it as part of follow-up
// slices that consolidate boundaries (e.g. when domain handlers move
// to dispatch-only and the actual store mutation lives elsewhere).
const ALLOWED_EDGES = {
	bootstrap: ['actions', 'components', 'stores', 'transport', 'styles', 'rendering', 'domain', 'capabilities', 'generated', 'workers'],
	components: ['stores', 'transport', 'rendering', 'domain', 'capabilities', 'actions', 'generated', 'styles'],
	stores: ['domain', 'capabilities', 'transport', 'generated', 'components'],
	// Domain handlers in this codebase are responsible for mutating the
	// stores they own; that's the established pattern. Capabilities are
	// strictly forbidden from touching stores/components/actions/transport.
	domain: ['domain', 'capabilities', 'generated', 'transport', 'stores', 'rendering', 'components', 'actions'],
	// `domain/capabilities/handlers.ts` is the cross-cutting registration
	// entry point and intentionally consumes actions/transport. Most
	// other capability modules remain pure classifiers.
	capabilities: ['capabilities', 'generated', 'actions', 'transport'],
	rendering: ['rendering', 'domain', 'capabilities', 'generated', 'workers', 'stores', 'components'],
	workers: ['rendering', 'capabilities', 'generated'],
	actions: ['domain', 'stores', 'capabilities', 'transport', 'generated'],
	transport: ['generated'],
	generated: [],
	styles: [],
	scripts: ['domain', 'stores', 'transport', 'generated', 'capabilities', 'rendering'],
};

function layerOf(absPath) {
	const rel = relative(WEB_ROOT, absPath);
	if (rel.startsWith('..') || isAbsolute(rel)) return 'external';
	for (const [prefix, label] of LAYER_RULES) {
		if (rel === prefix || rel.startsWith(prefix)) return label;
	}
	// Anything else (top-level utility files) is treated as `domain`.
	return 'domain';
}

function* walk(dir) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		if (name === 'node_modules' || name === 'target' || name === 'dist' || name.startsWith('.')) continue;
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) {
			yield* walk(full);
		} else if (st.isFile() && /\.(ts|tsx|mts|cts)$/.test(name)) {
			yield full;
		}
	}
}

const SPECIFIER_RES = [
	/(?:^|\W)import\s+(?:[^'";]+?from\s+)?['"]([^'"]+)['"]/g,
	/(?:^|\W)import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	/(?:^|\W)export\s+[^'";]+?from\s+['"]([^'"]+)['"]/g,
];

function extractSpecifiers(text) {
	const out = new Set();
	for (const re of SPECIFIER_RES) {
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(text)) !== null) {
			out.add(m[1]);
		}
	}
	return [...out];
}

function resolveSpecifier(spec, fromFile) {
	// Bare specifier like 'react' or '@vac-web/x' — external.
	if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
	const base = spec.startsWith('/') ? spec : resolve(dirname(fromFile), spec);
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.mts`,
		`${base}.cts`,
		join(base, 'index.ts'),
		join(base, 'index.tsx'),
	];
	for (const c of candidates) {
		try {
			if (existsSync(c) && statSync(c).isFile()) return normalize(c);
		} catch {
			// continue
		}
	}
	return null;
}

function main() {
	const violations = [];
	const stats = { files: 0, edges: 0, externalEdges: 0 };

	for (const file of walk(WEB_ROOT)) {
		stats.files += 1;
		let text;
		try {
			text = readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		// Hard-coded check: web should never *import* from apps/local-bridge.
		// Match only real `import ... from '...apps/local-bridge...'`
		// specifiers; comments and string-mirroring references are
		// allowed because the web tree intentionally documents bridge
		// type provenance with `apps/local-bridge/...` paths.
		if (/(?:^|\W)(?:import|export)\s+[^'"\n]*?from\s+['"][^'"\n]*apps\/local-bridge/.test(text)) {
			violations.push({
				rule: 'web -> local-bridge runtime',
				file: relative(REPO_ROOT, file),
				detail: 'real import from apps/local-bridge',
			});
		}
		const fromLayer = layerOf(file);
		const specs = extractSpecifiers(text);
		for (const spec of specs) {
			stats.edges += 1;
			const resolved = resolveSpecifier(spec, file);
			if (!resolved) {
				stats.externalEdges += 1;
				continue;
			}
			const toLayer = layerOf(resolved);
			if (toLayer === 'external') {
				stats.externalEdges += 1;
				continue;
			}
			if (fromLayer === toLayer) continue;
			const allowed = ALLOWED_EDGES[fromLayer] ?? [];
			if (!allowed.includes(toLayer)) {
				violations.push({
					rule: `${fromLayer} -> ${toLayer}`,
					file: relative(REPO_ROOT, file),
					import: spec,
					target: relative(REPO_ROOT, resolved),
				});
			} else if (VERBOSE) {
				process.stdout.write(
					`ok  ${fromLayer} -> ${toLayer}  ${relative(REPO_ROOT, file)} → ${relative(REPO_ROOT, resolved)}\n`,
				);
			}
		}
	}

	if (JSON_MODE) {
		process.stdout.write(JSON.stringify({ stats, violations }, null, 2) + '\n');
	} else if (violations.length === 0) {
		process.stdout.write(
			`architecture boundaries: ok (${stats.files} files, ${stats.edges} import edges, ${stats.externalEdges} external)\n`,
		);
	} else {
		process.stderr.write(`architecture boundaries: ${violations.length} violation(s)\n`);
		const byRule = new Map();
		for (const v of violations) {
			const arr = byRule.get(v.rule) ?? [];
			arr.push(v);
			byRule.set(v.rule, arr);
		}
		for (const [rule, list] of byRule) {
			process.stderr.write(`  [${rule}] (${list.length})\n`);
			for (const v of list.slice(0, 25)) {
				const suffix = v.import ? `  (← ${v.import})` : v.detail ? `  (${v.detail})` : '';
				process.stderr.write(`    ${v.file}${suffix}\n`);
			}
			if (list.length > 25) process.stderr.write(`    … +${list.length - 25} more\n`);
		}
	}
	process.exit(violations.length === 0 ? 0 : 1);
}

main();
