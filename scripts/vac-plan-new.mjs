#!/usr/bin/env node
// scripts/vac-plan-new.mjs
//
// Scaffold a new wiring plan slice from the standard template.
//
// Usage:
//   node scripts/vac-plan-new.mjs <slice-id> "<title>"
//
// Example:
//   node scripts/vac-plan-new.mjs 51 "some_new_capability"
//
// The script:
//   1. Validates that no slice with the same number already exists.
//   2. Writes docs/plans/wiring/NN-<title>.md with the standard skeleton.
//   3. Reminds the author to register the slice in 00-index.md.

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLANS_DIR = new URL('../docs/plans/wiring/', import.meta.url).pathname;

function usage(msg) {
	if (msg) process.stderr.write(`error: ${msg}\n`);
	process.stderr.write('usage: vac-plan-new <slice-id> "<title>"\n');
	process.exit(2);
}

const [, , rawId, ...rest] = process.argv;
if (!rawId || rest.length === 0) usage('missing arguments');

const sliceId = String(rawId).padStart(2, '0');
const title = rest.join(' ').trim();
if (!/^\d{2,3}$/.test(sliceId)) usage('slice-id must be a number');
if (!title) usage('title required');

const slug = title
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, '-')
	.replace(/(^-|-$)/g, '');
const filename = `${sliceId}-${slug}.md`;
const dest = join(PLANS_DIR, filename);

if (existsSync(dest)) {
	process.stderr.write(`slice file already exists: ${filename}\n`);
	process.exit(1);
}
for (const existing of readdirSync(PLANS_DIR)) {
	if (existing.startsWith(`${sliceId}-`)) {
		process.stderr.write(`slice id collision: ${existing}\n`);
		process.exit(1);
	}
}

const body = `# ${title}

- Slice id: \`wiring.${slug.replace(/-/g, '_')}\`
- Status: planned
- Owner: <team>
- Validation gates: typecheck, vitest, lint, cargo check, cargo test
- Related ADR(s): _none_
- Related plan(s): _none_

\`\`\`yaml
slice:
  id: wiring.${slug.replace(/-/g, '_')}
  status: planned
  goals:
    - <goal 1>
    - <goal 2>
  acceptance:
    - <criterion 1>
    - <criterion 2>
  steps:
    - id: step_01
      title: <first step>
      kind: code | doc | schema | test
      status: pending
\`\`\`

## Context

<why this slice exists; pointer to slices upstream / downstream>

## Plan

<step-by-step plan, each step concrete and small>

## Validation

<exact commands and expected counts>

## Risks / open questions

<list>
`;

writeFileSync(dest, body);
process.stdout.write(`wrote ${filename}\n`);
process.stdout.write('next: register the slice in docs/plans/wiring/00-index.md\n');
