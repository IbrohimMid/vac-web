#!/usr/bin/env node
// Reconciles the declarative command manifest with:
//   - protocol command schema enum (packages/protocol/v1/command.schema.json)
//   - generated bindings (apps/local-bridge/src/generated/command_catalog.rs,
//     apps/web/src/generated/commandCatalog.ts)
//
// Fails if:
//   - a schema enum entry is missing from the catalog,
//   - a bridge-accepted catalog command (implemented or not_wired) is missing
//     from the schema enum,
//   - generated bindings are out of date with the manifest.
//
// Run via:
//   node scripts/check-command-catalog.mjs
// or as part of `pnpm vac:check:catalog`.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'config/control-plane/command-manifest.yaml');
const SCHEMA = path.join(ROOT, 'packages/protocol/v1/command.schema.json');

function loadCatalog() {
  const doc = yaml.load(fs.readFileSync(MANIFEST, 'utf8'));
  return doc.commands;
}

function loadSchemaEnum() {
  const doc = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  return doc.properties?.type?.enum ?? [];
}

function main() {
  const catalog = loadCatalog();
  const schema = new Set(loadSchemaEnum());
  const errors = [];

  // 1. Every schema enum value must be classified in the catalog.
  const catalogIds = new Set(catalog.map((c) => c.id));
  for (const id of schema) {
    if (!catalogIds.has(id)) {
      errors.push(`schema enum '${id}' is missing from command-manifest.yaml`);
    }
  }

  // 2. Every implemented or not_wired catalog command must appear in the schema enum.
  for (const c of catalog) {
    if (['implemented', 'not_wired'].includes(c.status) && !schema.has(c.id)) {
      errors.push(
        `manifest command '${c.id}' (${c.status}) must appear in command.schema.json enum`,
      );
    }
  }

  // 3. Generated bindings must be up to date.
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/codegen-command-catalog.mjs'), '--check'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    errors.push('command catalog bindings are out of date (run scripts/codegen-command-catalog.mjs)');
  }

  if (errors.length > 0) {
    console.error('[check-command-catalog] FAILED:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`[check-command-catalog] OK (catalog=${catalog.length}, schema=${schema.size})`);
}

main();
