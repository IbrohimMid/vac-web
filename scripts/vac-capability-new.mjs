#!/usr/bin/env node
// scripts/vac-capability-new.mjs
//
// Scaffold a new capability classifier module + test pair under
// apps/web/src/domain/capabilities/.
//
// Usage:
//   node scripts/vac-capability-new.mjs <name>
//
// Example:
//   node scripts/vac-capability-new.mjs releaseEvents
//
// Outputs:
//   apps/web/src/domain/capabilities/<name>.ts
//   apps/web/src/domain/capabilities/<name>.test.ts
//
// The generated module follows the canonical exports:
//   classify<Name>(code, ctx) -> { code, severity, ... }
//   is<Name>Event(event) -> boolean
//   <NAME>_CODES, <NAME>_FALLBACK

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CAPS_DIR = new URL('../apps/web/src/domain/capabilities/', import.meta.url).pathname;

function usage(msg) {
	if (msg) process.stderr.write(`error: ${msg}\n`);
	process.stderr.write('usage: vac-capability-new <name>\n');
	process.exit(2);
}

const [, , rawName] = process.argv;
if (!rawName) usage('missing name');
if (!/^[a-z][A-Za-z0-9]*$/.test(rawName)) usage('name must be camelCase');

const name = rawName;
const Pascal = name.charAt(0).toUpperCase() + name.slice(1);
const Upper = name.replace(/([A-Z])/g, '_$1').toUpperCase();

const modPath = join(CAPS_DIR, `${name}.ts`);
const testPath = join(CAPS_DIR, `${name}.test.ts`);
if (existsSync(modPath) || existsSync(testPath)) {
	process.stderr.write(`capability file already exists for ${name}\n`);
	process.exit(1);
}

const mod = `// Capability classifier: ${name} (scaffolded).
//
// Replace the placeholder codes / shape with real values for this domain.

export type ${Pascal}Severity = 'info' | 'warning' | 'error';

export interface ${Pascal}Decision {
	readonly code: string;
	readonly severity: ${Pascal}Severity;
	readonly userMessage: string;
}

const FALLBACK: ${Pascal}Decision = Object.freeze({
	code: '',
	severity: 'info',
	userMessage: 'Unknown ${name} signal.',
});

const ENTRIES: Record<string, Omit<${Pascal}Decision, 'code'>> = {
	// 'example.code': { severity: 'info', userMessage: 'Example.' },
};

export function classify${Pascal}(code: string): ${Pascal}Decision {
	if (typeof code !== 'string' || code.length === 0) return FALLBACK;
	const hit = ENTRIES[code];
	return hit ? { code, ...hit } : { ...FALLBACK, code };
}

export function is${Pascal}Event(event: string): boolean {
	return Object.prototype.hasOwnProperty.call(ENTRIES, event);
}

export const ${Upper}_CODES: ReadonlyArray<string> = Object.freeze(Object.keys(ENTRIES));
export { FALLBACK as ${Upper}_FALLBACK };
`;

const test = `import { describe, expect, it } from 'vitest';

import { classify${Pascal}, is${Pascal}Event, ${Upper}_FALLBACK } from './${name}';

describe('classify${Pascal}', () => {
	it('falls back deterministically for unknown codes', () => {
		const d = classify${Pascal}('totally.made.up');
		expect(d.severity).toBe(${Upper}_FALLBACK.severity);
	});

	it('rejects non-string input', () => {
		const d = classify${Pascal}('' as string);
		expect(d).toEqual(${Upper}_FALLBACK);
	});

	it('is${Pascal}Event returns false for unknown events', () => {
		expect(is${Pascal}Event('totally.made.up')).toBe(false);
	});
});
`;

writeFileSync(modPath, mod);
writeFileSync(testPath, test);
process.stdout.write(`wrote apps/web/src/domain/capabilities/${name}.ts\n`);
process.stdout.write(`wrote apps/web/src/domain/capabilities/${name}.test.ts\n`);
