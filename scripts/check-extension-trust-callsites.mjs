#!/usr/bin/env node
// Drift gate: verifies that the bridge has callsites referencing
// `profile_core::extension_trust` types. Catches the regression where
// extensions handlers silently lose their trust enforcement wiring.
//
// Distinct from `check-extension-trust.mjs` (structural YAML validator).

import { execSync } from 'node:child_process';

const REQUIRED = [
  { pattern: 'enforce_extension_trust', minMatches: 1, dirs: ['apps/local-bridge/src/extensions/'] },
  { pattern: 'ExtensionTrustConfig', minMatches: 1, dirs: ['apps/local-bridge/src/extensions/'] },
];

let failed = false;
for (const { pattern, minMatches, dirs } of REQUIRED) {
  let count = 0;
  for (const dir of dirs) {
    try {
      const out = execSync(`grep -rln "${pattern}" ${dir}`, { encoding: 'utf8' });
      count += out.split('\n').filter(Boolean).length;
    } catch {
      // grep exits 1 when no match; treat as zero.
    }
  }
  if (count < minMatches) {
    console.error(`[check-extension-trust-callsites] FAIL: ${pattern} not found (need >=${minMatches}, found ${count})`);
    failed = true;
  } else {
    console.log(`[check-extension-trust-callsites] OK: ${pattern} found in ${count} file(s)`);
  }
}

if (failed) process.exit(1);
console.log('[check-extension-trust-callsites] all checks passed');
