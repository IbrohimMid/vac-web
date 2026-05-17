#!/usr/bin/env node
// Enforce schema x-assertions that cannot be represented by plain JSON Schema.
// S09-F04: JSON Schema allOf handles static if/then assertions; this gate keeps
// runtime-only assertions explicit and validates identity_hash derivation.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const V1 = join(ROOT, 'packages', 'protocol', 'v1');
const SAMPLES = join(V1, '_samples');
const RUNTIME_SAMPLES = join(V1, '_runtime_assertion_samples');

const KNOWN_SCHEMA_ASSERTIONS = new Map([
  [
    'assessment_finding.schema.json',
    new Set([
      'severity=critical implies confidence >= 0.7',
      'evidence must be non-empty (minItems:1)',
    ]),
  ],
  [
    'evidence_ref.schema.json',
    new Set(['digest is required when kind in {file, commit, pr}.']),
  ],
  [
    'capability_profile.schema.json',
    new Set(["If class='assessor', fs.write must be 'none' and git.commit must be false."]),
  ],
]);

const KNOWN_RUNTIME_ASSERTIONS = new Map([
  [
    'assessment_finding.schema.json',
    new Set([
      'identity_hash must equal sha256(family_id|category|subsystem|normalize(title)|primary_evidence_locator)',
    ]),
  ],
  [
    'capability_profile.schema.json',
    new Set([
      "If connectors.write is non-empty, each entry must appear in tool_allow as 'connector.write.<id>'.",
      'tool_deny is evaluated before tool_allow (deny wins).',
    ]),
  ],
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function fail(message) {
  console.error('[schema-assertions] FAIL ' + message);
  process.exitCode = 1;
}

function checkAssertionRegistry() {
  for (const path of walk(V1)) {
    if (!path.endsWith('.schema.json')) continue;
    if (path.includes('/_samples/')) continue;
    const rel = relative(V1, path);
    if (rel.startsWith('_defs/')) continue;
    const schema = JSON.parse(readFileSync(path, 'utf8'));
    const staticAllowed = KNOWN_SCHEMA_ASSERTIONS.get(rel) ?? new Set();
    const runtimeAllowed = KNOWN_RUNTIME_ASSERTIONS.get(rel) ?? new Set();
    for (const assertion of schema['x-assertions'] ?? []) {
      if (!staticAllowed.has(assertion)) {
        fail(`${rel}: unmapped x-assertion: ${assertion}`);
      }
    }
    for (const assertion of schema['x-runtime-assertions'] ?? []) {
      if (!runtimeAllowed.has(assertion)) {
        fail(`${rel}: unmapped x-runtime-assertion: ${assertion}`);
      }
    }
  }
}

function normalizeTitle(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function primaryEvidenceLocator(finding) {
  const evidence = Array.isArray(finding.evidence) ? finding.evidence[0] : null;
  if (!evidence || typeof evidence !== 'object') return '';
  const uri = typeof evidence.uri === 'string' ? evidence.uri : '';
  if (evidence.locator && typeof evidence.locator === 'object') {
    return uri + '#' + JSON.stringify(evidence.locator, Object.keys(evidence.locator).sort());
  }
  return uri;
}

export function assessmentFindingIdentityHash(finding) {
  const raw = [
    finding.family_id,
    finding.category,
    finding.subsystem,
    normalizeTitle(finding.title),
    primaryEvidenceLocator(finding),
  ].join('|');
  return 'sha256:' + createHash('sha256').update(raw).digest('hex');
}

function checkAssessmentFindingSamples() {
  const dir = join(SAMPLES, 'assessment_finding');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const expected = assessmentFindingIdentityHash(data);
    const ok = data.identity_hash === expected;
    if (file.startsWith('valid-') && !ok) {
      fail(`assessment_finding/${file}: identity_hash ${data.identity_hash} != ${expected}`);
    }
  }

  const runtimeDir = join(RUNTIME_SAMPLES, 'assessment_finding');
  for (const file of readdirSync(runtimeDir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(join(runtimeDir, file), 'utf8'));
    const expected = assessmentFindingIdentityHash(data);
    const ok = data.identity_hash === expected;
    if (file === 'invalid-bad-identity-hash.json' && ok) {
      fail(`assessment_finding/${file}: invalid fixture unexpectedly matches derived identity_hash`);
    }
    if (file.startsWith('valid-') && !ok) {
      fail(`assessment_finding/${file}: identity_hash ${data.identity_hash} != ${expected}`);
    }
  }
}

checkAssertionRegistry();
checkAssessmentFindingSamples();

if (process.exitCode) process.exit(process.exitCode);
console.log('[schema-assertions] OK — x-assertions are mapped and runtime identity_hash checks pass.');
