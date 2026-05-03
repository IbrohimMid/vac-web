#!/usr/bin/env node
// Generate a TypeScript snapshot of the error taxonomy from
// schema/error-taxonomy.yaml.
//
// Outputs:
//   apps/web/src/generated/errorTaxonomyCatalog.ts (TS snapshot)
//   apps/local-bridge/src/generated/error_taxonomy_catalog.rs (Rust snapshot)
//
// The hand-authored capability module
// (apps/web/src/domain/capabilities/errorTaxonomy.ts) is the runtime API.
// This codegen produces a parallel snapshot used by parity tests so the
// schema YAML cannot drift from the runtime classifier.
//
// Run via:
//   node scripts/codegen-error-taxonomy.mjs
//   node scripts/codegen-error-taxonomy.mjs --check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'schema/error-taxonomy.yaml');
const TS_OUT = path.join(ROOT, 'apps/web/src/generated/errorTaxonomyCatalog.ts');
const RS_OUT = path.join(ROOT, 'apps/local-bridge/src/generated/error_taxonomy_catalog.rs');
const HEADER_NOTE =
  'AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: schema/error-taxonomy.yaml';

const SEVERITIES = ['info', 'warning', 'error', 'critical'];
const RETRYABILITY = ['idempotent_retry', 'manual_retry', 'no_retry'];
const RECOVERY = [
  'check_profile',
  'check_connectivity',
  'check_audit',
  'reload_session',
  'reauthenticate',
  'wait_and_retry',
  'contact_admin',
  'no_action',
];

function loadCatalog() {
  const raw = fs.readFileSync(SOURCE, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || !Array.isArray(doc.entries)) {
    throw new Error('error-taxonomy.yaml: missing entries[]');
  }
  const seen = new Set();
  for (const e of doc.entries) {
    if (typeof e.code !== 'string' || !e.code) {
      throw new Error('error-taxonomy.yaml: entry missing code');
    }
    if (seen.has(e.code)) {
      throw new Error(`error-taxonomy.yaml: duplicate code ${e.code}`);
    }
    seen.add(e.code);
    if (!SEVERITIES.includes(e.severity)) {
      throw new Error(`error-taxonomy.yaml: ${e.code} bad severity ${e.severity}`);
    }
    if (!RETRYABILITY.includes(e.retryable)) {
      throw new Error(`error-taxonomy.yaml: ${e.code} bad retryable ${e.retryable}`);
    }
    if (!RECOVERY.includes(e.recovery)) {
      throw new Error(`error-taxonomy.yaml: ${e.code} bad recovery ${e.recovery}`);
    }
    if (typeof e.audit_required !== 'boolean') {
      throw new Error(`error-taxonomy.yaml: ${e.code} missing audit_required`);
    }
    if (typeof e.user_message !== 'string' || !e.user_message) {
      throw new Error(`error-taxonomy.yaml: ${e.code} missing user_message`);
    }
  }
  const entries = [...doc.entries].sort((a, b) => a.code.localeCompare(b.code));
  return { schema_version: doc.schema_version ?? 1, entries };
}

function renderTs(doc) {
  const lines = [];
  lines.push('// ' + HEADER_NOTE);
  lines.push('//');
  lines.push('// Run `node scripts/codegen-error-taxonomy.mjs` to regenerate.');
  lines.push('');
  lines.push("export type ErrorTaxonomySeverity = 'info' | 'warning' | 'error' | 'critical';");
  lines.push(
    "export type ErrorTaxonomyRetryability = 'idempotent_retry' | 'manual_retry' | 'no_retry';",
  );
  lines.push('export type ErrorTaxonomyRecovery =');
  for (let i = 0; i < RECOVERY.length; i++) {
    const sep = i === RECOVERY.length - 1 ? ';' : '';
    lines.push(`  | '${RECOVERY[i]}'${sep}`);
  }
  lines.push('');
  lines.push('export interface ErrorTaxonomyCatalogEntry {');
  lines.push('  readonly code: string;');
  lines.push('  readonly severity: ErrorTaxonomySeverity;');
  lines.push('  readonly retryable: ErrorTaxonomyRetryability;');
  lines.push('  readonly recovery: ErrorTaxonomyRecovery;');
  lines.push('  readonly auditRequired: boolean;');
  lines.push('  readonly userMessage: string;');
  lines.push('}');
  lines.push('');
  lines.push(
    'export const ERROR_TAXONOMY_CATALOG: ReadonlyArray<ErrorTaxonomyCatalogEntry> = Object.freeze([',
  );
  for (const e of doc.entries) {
    lines.push('  Object.freeze({');
    lines.push(`    code: '${e.code}',`);
    lines.push(`    severity: '${e.severity}',`);
    lines.push(`    retryable: '${e.retryable}',`);
    lines.push(`    recovery: '${e.recovery}',`);
    lines.push(`    auditRequired: ${e.audit_required ? 'true' : 'false'},`);
    lines.push(`    userMessage: ${JSON.stringify(e.user_message)},`);
    lines.push('  }),');
  }
  lines.push(']);');
  lines.push('');
  lines.push(
    'export const ERROR_TAXONOMY_CATALOG_BY_CODE: ReadonlyMap<string, ErrorTaxonomyCatalogEntry> =',
  );
  lines.push('  new Map(ERROR_TAXONOMY_CATALOG.map((e) => [e.code, e]));');
  lines.push('');
  return lines.join('\n');
}

function renderRust(doc) {
  const lines = [];
  lines.push('// ' + HEADER_NOTE);
  lines.push('//');
  lines.push('// Run `node scripts/codegen-error-taxonomy.mjs` to regenerate.');
  lines.push('');
  lines.push('#![allow(dead_code)]');
  lines.push('');
  lines.push('#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]');
  lines.push('pub enum ErrorSeverity {');
  lines.push('    Info,');
  lines.push('    Warning,');
  lines.push('    Error,');
  lines.push('    Critical,');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]');
  lines.push('pub enum ErrorRetryability {');
  lines.push('    IdempotentRetry,');
  lines.push('    ManualRetry,');
  lines.push('    NoRetry,');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]');
  lines.push('pub struct ErrorTaxonomyEntry {');
  lines.push('    pub code: &\'static str,');
  lines.push('    pub severity: ErrorSeverity,');
  lines.push('    pub retryable: ErrorRetryability,');
  lines.push('    pub audit_required: bool,');
  lines.push('    pub user_message: &\'static str,');
  lines.push('}');
  lines.push('');
  const sev = {
    info: 'Info',
    warning: 'Warning',
    error: 'Error',
    critical: 'Critical',
  };
  const ret = {
    idempotent_retry: 'IdempotentRetry',
    manual_retry: 'ManualRetry',
    no_retry: 'NoRetry',
  };
  lines.push(`pub const ERROR_TAXONOMY: [ErrorTaxonomyEntry; ${doc.entries.length}] = [`);
  for (const e of doc.entries) {
    lines.push('    ErrorTaxonomyEntry {');
    lines.push(`        code: "${e.code}",`);
    lines.push(`        severity: ErrorSeverity::${sev[e.severity]},`);
    lines.push(`        retryable: ErrorRetryability::${ret[e.retryable]},`);
    lines.push(`        audit_required: ${e.audit_required ? 'true' : 'false'},`);
    lines.push(`        user_message: ${JSON.stringify(e.user_message)},`);
    lines.push('    },');
  }
  lines.push('];');
  lines.push('');
  lines.push('pub fn taxonomy_for(code: &str) -> Option<&\'static ErrorTaxonomyEntry> {');
  lines.push('    ERROR_TAXONOMY.iter().find(|e| e.code == code)');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const doc = loadCatalog();
  const targets = [
    [TS_OUT, renderTs(doc)],
    [RS_OUT, renderRust(doc)],
  ];
  let drift = false;
  for (const [outPath, content] of targets) {
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (check) {
      if (existing !== content) {
        drift = true;
        console.error(`[codegen-error-taxonomy] DRIFT: ${path.relative(ROOT, outPath)}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (existing !== content) {
      fs.writeFileSync(outPath, content);
      console.log(`[codegen-error-taxonomy] wrote ${path.relative(ROOT, outPath)}`);
    } else {
      console.log(`[codegen-error-taxonomy] ok    ${path.relative(ROOT, outPath)}`);
    }
  }
  if (check && drift) {
    console.error('[codegen-error-taxonomy] run `node scripts/codegen-error-taxonomy.mjs` and commit the result.');
    process.exit(1);
  }
}

main();
