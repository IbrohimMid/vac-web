#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let failed = false;
const fail = (msg) => { console.error(`[node-types-policy] ${msg}`); failed = true; };
const allowed = (spec) => typeof spec === 'string' && /^(\^|~)?22(\.|$)/.test(spec);
const packageFiles = execFileSync('git', ['ls-files', '*package.json'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
for (const file of packageFiles) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  for (const section of ['dependencies','devDependencies','peerDependencies','optionalDependencies']) {
    const spec = pkg?.[section]?.['@types/node'];
    if (spec !== undefined && !allowed(spec)) fail(`${file} ${section}.@types/node must stay on 22.x, got ${spec}`);
  }
  const override = pkg?.pnpm?.overrides?.['@types/node'];
  if (override !== undefined && !allowed(override)) fail(`${file} pnpm.overrides.@types/node must stay on 22.x, got ${override}`);
}
const lockPath = path.join(ROOT, 'pnpm-lock.yaml');
const lock = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : '';
for (const major of ['23','24','25']) if (lock.includes(`@types/node@${major}.`)) fail(`pnpm-lock.yaml contains @types/node@${major}.x; ADR-0005 requires 22.x`);
if (failed) process.exit(1);
console.log('[node-types-policy] OK — @types/node remains pinned to 22.x.');
