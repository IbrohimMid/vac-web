#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/codegen/MANIFEST.json'), 'utf8'));
let failed = false;
const fail = (msg) => { console.error(`[codegen-manifest] ${msg}`); failed = true; };
const coveredFiles = new Set();
const coveredDirs = [];
for (const entry of manifest.entries ?? []) {
  if (!entry || typeof entry.output !== 'string') { fail(`entry ${entry?.id ?? '<unknown>'} missing output`); continue; }
  const out = path.join(ROOT, entry.output);
  if (!fs.existsSync(out)) { fail(`missing manifest output: ${entry.output}`); continue; }
  if (fs.statSync(out).isDirectory()) coveredDirs.push(entry.output.replace(/\/$/, '') + '/');
  else coveredFiles.add(entry.output);
}
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const prefixes = ['apps/local-bridge/src/generated/','apps/web/src/generated/','tools/mock-engine/src/generated/','packages/protocol-ts/src/v1/generated/','packages/protocol-rs/src/v1/generated/'];
for (const file of tracked) {
  if (!prefixes.some((prefix) => file.startsWith(prefix))) continue;
  const covered = coveredFiles.has(file) || coveredDirs.some((dir) => file.startsWith(dir));
  if (!covered) fail(`tracked generated file is not registered in tools/codegen/MANIFEST.json: ${file}`);
}
if (failed) process.exit(1);
console.log('[codegen-manifest] OK — manifest outputs exist and tracked generated files are registered.');
