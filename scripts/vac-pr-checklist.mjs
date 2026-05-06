#!/usr/bin/env node
// vac-pr-checklist.mjs — generate a markdown TODO checklist for a PR body.
//
// Slice 39 step_03 (PR-body TODO checklist generator).
//
// Usage:
//   pnpm pr:checklist                           # diff against origin/main
//   pnpm pr:checklist -- --base HEAD~1          # custom base ref
//   pnpm pr:checklist -- --help
//
// Behavior:
//   1. Compute changed files vs base.
//   2. Map each changed file to its owning wiring slice via slice frontmatter
//      `sources:` prefix matching.
//   3. Emit a markdown checklist of:
//      - Global validation gates (unconditional)
//      - Per-touched-slice acceptance bullets
//
// Output goes to stdout. Paste into your PR description.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLANS_DIR = path.join(ROOT, 'docs/plans/wiring');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`vac-pr-checklist — emit a PR-body TODO checklist.

Usage:
  pnpm pr:checklist                # diff against origin/main
  pnpm pr:checklist -- --base HEAD~1
  pnpm pr:checklist -- --help

Output: markdown checklist on stdout. Paste into your PR description.`);
  process.exit(0);
}

const baseIdx = args.indexOf('--base');
const base = baseIdx !== -1 ? args[baseIdx + 1] : 'origin/main';

function changedFiles(baseRef) {
  try {
    const out = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    try {
      const out = execSync('git diff --name-only HEAD~1...HEAD', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
}

function loadSlices() {
  const entries = fs.readdirSync(PLANS_DIR).filter((f) => /^\d{2}-.+\.md$/.test(f));
  const slices = [];
  for (const f of entries) {
    const full = path.join(PLANS_DIR, f);
    const raw = fs.readFileSync(full, 'utf8');
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    let fm;
    try {
      fm = yaml.load(fmMatch[1]);
    } catch {
      continue;
    }
    const yamlBlockMatch = raw.match(/```yaml\n([\s\S]*?)\n```/);
    let sources = [];
    let acceptance = [];
    if (yamlBlockMatch) {
      try {
        const block = yaml.load(yamlBlockMatch[1]);
        if (block && Array.isArray(block.sources)) sources = block.sources;
        if (block && Array.isArray(block.acceptance)) acceptance = block.acceptance;
      } catch {
        // ignore malformed inner block
      }
    }
    slices.push({
      id: (fm && fm.id) || f.replace(/\.md$/, ''),
      title: (fm && fm.title) || f,
      file: f,
      sources,
      acceptance,
    });
  }
  return slices;
}

function matchSlices(files, slices) {
  const matched = new Map();
  for (const file of files) {
    for (const s of slices) {
      for (const src of s.sources) {
        const norm = src.replace(/\/$/, '');
        if (file === norm || file.startsWith(norm + '/')) {
          matched.set(s.id, s);
          break;
        }
      }
    }
  }
  return [...matched.values()];
}

function render(files, touched) {
  const lines = [];
  lines.push('## PR validation checklist');
  lines.push('');
  lines.push('### Global gates (always run)');
  lines.push('');
  lines.push('- [ ] `pnpm typecheck` clean');
  lines.push('- [ ] `pnpm test` baseline preserved');
  lines.push('- [ ] `pnpm lint` 0 errors / ≤3 warnings');
  lines.push('- [ ] `cargo test -p local-bridge --lib` baseline preserved');
  lines.push('- [ ] `cargo test -p mock-engine` baseline preserved');
  lines.push('- [ ] `bash scripts/verify-codegen.sh` OK');
  lines.push('- [ ] `node scripts/check-architecture-boundaries.mjs` ok');
  lines.push('- [ ] `node scripts/check-capability-coverage.mjs` 16 backend modules tagged');
  lines.push('- [ ] `node scripts/check-slo-budgets.mjs` 5 entries validated');
  lines.push('- [ ] `cargo fmt --all -- --check` clean');
  lines.push('- [ ] No writes to `.env*` / `**/secrets/**`');
  lines.push('- [ ] No `git push` / `git tag` / `.git/config`');
  lines.push('');
  lines.push(`### Changed files (${files.length})`);
  lines.push('');
  if (files.length === 0) {
    lines.push('_none detected against base ref_');
  } else {
    for (const f of files.slice(0, 30)) lines.push(`- \`${f}\``);
    if (files.length > 30) lines.push(`- _… and ${files.length - 30} more_`);
  }
  lines.push('');
  lines.push(`### Touched wiring slices (${touched.length})`);
  lines.push('');
  if (touched.length === 0) {
    lines.push('_no slice acceptance bullets matched the changed file set_');
  } else {
    for (const s of touched) {
      lines.push(`#### ${s.title} — \`${s.file}\``);
      lines.push('');
      if (s.acceptance.length === 0) {
        lines.push('_no acceptance bullets in slice control-plane block_');
      } else {
        for (const a of s.acceptance) lines.push(`- [ ] ${a}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function main() {
  const files = changedFiles(base);
  const slices = loadSlices();
  const touched = matchSlices(files, slices);
  process.stdout.write(render(files, touched) + '\n');
}

main();
