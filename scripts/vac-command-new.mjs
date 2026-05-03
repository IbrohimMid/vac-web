#!/usr/bin/env node
// scripts/vac-command-new.mjs (slice 39)
//
// Scaffold a new entry in config/control-plane/command-manifest.yaml.
//
// Usage:
//   node scripts/vac-command-new.mjs <id> <status> <scope> "<summary>"
//
// Examples:
//   node scripts/vac-command-new.mjs session.snapshot not_wired session "Snapshot the active session."
//   node scripts/vac-command-new.mjs review.revert_file not_wired session "Revert a file in the active changeset."
//
// Arguments:
//   <id>      — fully-qualified id (`module.action`), lowercase, dot-separated.
//   <status>  — one of: implemented | not_wired | frontend_owned | protocol_only | internal | deprecated
//   <scope>   — one of: sessionless | session | either
//   <summary> — quoted single-sentence description.
//
// The script:
//   1. Validates id, status, and scope.
//   2. Refuses to scaffold if the id is already declared.
//   3. Appends a new entry to the END of the `commands:` list and prints
//      the generated YAML snippet so the author can move it under the
//      correct section heading.
//   4. Reminds the author to run `pnpm codegen:catalog` and to add a
//      capability classifier or surface affordance entry where relevant.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST_PATH = new URL(
	'../config/control-plane/command-manifest.yaml',
	import.meta.url,
).pathname;

const VALID_STATUS = new Set([
	'implemented',
	'not_wired',
	'frontend_owned',
	'protocol_only',
	'internal',
	'deprecated',
]);
const VALID_SCOPE = new Set(['sessionless', 'session', 'either']);

function usage(msg) {
	if (msg) process.stderr.write(`error: ${msg}\n`);
	process.stderr.write(
		'usage: vac-command-new <id> <status> <scope> "<summary>"\n' +
			`  status: ${[...VALID_STATUS].join(' | ')}\n` +
			`  scope:  ${[...VALID_SCOPE].join(' | ')}\n`,
	);
	process.exit(2);
}

const [, , rawId, rawStatus, rawScope, ...rest] = process.argv;
if (!rawId || !rawStatus || !rawScope || rest.length === 0) usage('missing arguments');

const id = String(rawId).trim();
const status = String(rawStatus).trim();
const scope = String(rawScope).trim();
const summary = rest.join(' ').trim();

if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(id)) {
	usage(`id ${JSON.stringify(id)} must be lowercase \`module.action\` form`);
}
if (!VALID_STATUS.has(status)) usage(`status must be one of: ${[...VALID_STATUS].join(', ')}`);
if (!VALID_SCOPE.has(scope)) usage(`scope must be one of: ${[...VALID_SCOPE].join(', ')}`);
if (!summary) usage('summary required');
if (summary.length > 240) usage('summary must be ≤ 240 characters');
if (!/[.!?]\s*$/.test(summary)) {
	process.stderr.write('warn: summary should end with terminal punctuation\n');
}

if (!existsSync(MANIFEST_PATH)) {
	process.stderr.write(`manifest not found: ${MANIFEST_PATH}\n`);
	process.exit(1);
}

const original = readFileSync(MANIFEST_PATH, 'utf8');

// Naive but robust check: an existing entry has a line `  - id: <id>`
// at two-space indent under the top-level `commands:` block.
const idRegex = new RegExp(`^\\s{2}-\\s+id:\\s+${id.replace(/\./g, '\\.')}\\s*$`, 'm');
if (idRegex.test(original)) {
	process.stderr.write(`command id ${id} already declared in command-manifest.yaml\n`);
	process.exit(1);
}

const safeSummary = summary
	.replace(/\\/g, '\\\\')
	.replace(/"/g, '\\"');

const entry = [
	`  # TODO(${id}): move under the correct section heading and add fields`,
	'  # like `runtime`, `runtime_session`, or `ui:` as needed.',
	`  - id: ${id}`,
	`    status: ${status}`,
	`    scope: ${scope}`,
	`    summary: "${safeSummary}"`,
	'',
].join('\n');

let next = original;
if (!next.endsWith('\n')) next += '\n';
next += entry;

writeFileSync(MANIFEST_PATH, next);

process.stdout.write(`appended ${id} to ${join('config/control-plane', 'command-manifest.yaml')}\n`);
process.stdout.write(
	'next steps:\n' +
		'  1. open command-manifest.yaml and move the new entry under the matching section.\n' +
		'  2. run `pnpm codegen:catalog` to regenerate command_catalog.{ts,rs}.\n' +
		'  3. if the command is `not_wired`, ensure the surface uses\n' +
		'     affordanceCatalog/feature.not_wired fallback.\n' +
		'  4. add a capability classifier under apps/web/src/domain/capabilities/\n' +
		'     if the command produces structured errors or events.\n',
);
