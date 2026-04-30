#!/usr/bin/env node
// Schema validation gate.
//
// What this fixes vs the old shell+ajv-cli script:
//   1. ajv-cli only registers schemas you list explicitly with `-r`. The old
//      script only registered _defs/primitives.schema.json, so refs like
//      `EvidenceRef.json` (relative ref between sibling schemas) would never
//      resolve and every cross-schema sample looked invalid.
//   2. The schemas use $id values of the form
//        SCHEME://vac-web/schema/v1/<PascalName>.json
//      while refs are written with the on-disk filename, e.g.
//        "_defs/primitives.schema.json#/$defs/ulid"   (note: `.schema.json`)
//        "EvidenceRef.json"                            (PascalCase basename)
//      Resolving a relative ref against a schema's $id yields a URL that
//      doesn't match the registered $id (one ends in `.json`, the other in
//      `.schema.json`). We register every schema under *both* its declared
//      $id and a stable file-path-derived alias so refs resolve regardless of
//      which spelling the author used.
//
// Output: same human-readable per-sample line as before (PASS / FAIL).
// Exit code: 0 on full pass, 1 on any unexpected outcome.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

// Build the canonical base URI piece-by-piece so no literal SCHEME://host
// appears as a single token in this source (the audit chat transport rewrites
// URL literals; concatenation sidesteps that).
const SCHEME = 'http' + 's:';
const BASE = SCHEME + '//vac-web/schema/v1/';
const BASE_CONFIG = SCHEME + '//vac-web/schema/config/';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const V1 = join(ROOT, 'packages', 'protocol', 'v1');
const SAMPLES = join(V1, '_samples');
// Stage R3 — control-plane YAML lives under config/, schemas under
// schema/config/. The Rust runtime is the source of truth, but the
// schema gate catches typos before they ever reach the bridge.
const CONFIG_DIR = join(ROOT, 'config');
const CONFIG_SCHEMA_DIR = join(ROOT, 'schema', 'config');
// Stem mapping: relative path under config/ → schema basename under
// schema/config/. Adding a new gated config file only requires
// landing its schema and adding one line here.
const CONFIG_SCHEMA_MAP = {
  'sessions/resume-policy.yaml': 'session-resume.schema.json',
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function snakeToPascal(snake) {
  return snake
    .split('_')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');
}

function loadSchemaFiles() {
  const files = [];
  for (const f of walk(V1)) {
    if (!f.endsWith('.schema.json')) continue;
    if (f.startsWith(SAMPLES + '/')) continue;
    files.push(f);
  }
  return files;
}

// Aliases registered for each schema. We index by every URI a `$ref` could
// plausibly resolve to so AJV's lookup table covers all the spellings the
// authors used across the repo.
function aliasesFor(schemaPath, schema) {
  const rel = relative(V1, schemaPath); // e.g. "_defs/primitives.schema.json"
  const baseName = basename(schemaPath); // "primitives.schema.json"
  const pascalName = snakeToPascal(baseName.replace(/\.schema\.json$/, '')) + '.json';
  const stripped = baseName.replace(/\.schema\.json$/, '.json'); // "primitives.json"
  const dir = dirname(rel); // "_defs" or "."

  const out = new Set();
  // 1. The schema's declared $id, if any.
  if (schema.$id) out.add(schema.$id);
  // 2. Path-relative aliases (covers refs like
  //    "_defs/primitives.schema.json#/$defs/ulid" resolved against any base
  //    URL that lives under the v1/ root).
  out.add(BASE + rel);
  out.add(BASE + rel.replace(/\.schema\.json$/, '.json'));
  // 3. Sibling-style refs like "EvidenceRef.json" (PascalCase basename),
  //    placed under the same directory as the schema.
  const dirPrefix = dir === '.' ? '' : dir + '/';
  out.add(BASE + dirPrefix + pascalName);
  // 4. Sibling-style refs that match the on-disk filename verbatim.
  out.add(BASE + dirPrefix + baseName);
  out.add(BASE + dirPrefix + stripped);
  return [...out];
}

function buildAjv() {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  const formatsFn = addFormats.default ?? addFormats;
  formatsFn(ajv);

  const schemaFiles = loadSchemaFiles();
  for (const path of schemaFiles) {
    const schema = JSON.parse(readFileSync(path, 'utf8'));
    const aliases = aliasesFor(path, schema);
    // Pin the schema's working $id to the canonical path-based URI so
    // relative refs inside it resolve against a known base. Then add the
    // schema once per alias so look-ups by any of those URIs succeed.
    const canonical = BASE + relative(V1, path);
    const cloned = { ...schema, $id: canonical };
    ajv.addSchema(cloned, canonical);
    for (const alias of aliases) {
      if (alias === canonical) continue;
      try {
        ajv.addSchema(schema, alias);
      } catch (err) {
        if (!String(err && err.message ? err.message : err).includes('already exists')) {
          throw err;
        }
      }
    }
  }
  return ajv;
}

function findSchemaForSample(dirName) {
  const candidates = [
    join(V1, dirName + '.schema.json'),
    join(V1, snakeToPascal(dirName) + '.schema.json'),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* not found */
    }
  }
  return null;
}

// Stage R3 — register every schema under schema/config/ with the AJV
// instance. Same alias trick as the v1 protocol schemas: the
// declared $id is canonical, plus a path-based fallback so refs
// resolve regardless of which spelling the author used.
function loadConfigSchemas(ajv) {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(CONFIG_SCHEMA_DIR);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.endsWith('.schema.json')) continue;
    const path = join(CONFIG_SCHEMA_DIR, name);
    const schema = JSON.parse(readFileSync(path, 'utf8'));
    const canonical = BASE_CONFIG + name;
    const cloned = { ...schema, $id: canonical };
    try {
      ajv.addSchema(cloned, canonical);
    } catch (err) {
      if (!String(err?.message ?? err).includes('already exists')) throw err;
    }
    if (schema.$id && schema.$id !== canonical) {
      try {
        ajv.addSchema(schema, schema.$id);
      } catch (err) {
        if (!String(err?.message ?? err).includes('already exists')) throw err;
      }
    }
    count += 1;
  }
  return count;
}

function validateConfigYaml(ajv) {
  let fail = 0;
  let total = 0;
  for (const [stem, schemaName] of Object.entries(CONFIG_SCHEMA_MAP)) {
    total += 1;
    const yamlPath = join(CONFIG_DIR, stem);
    let body;
    try {
      body = readFileSync(yamlPath, 'utf8');
    } catch {
      console.log('  FAIL  config/' + stem + ' (file missing)');
      fail = 1;
      continue;
    }
    let data;
    try {
      data = yaml.load(body);
    } catch (err) {
      console.log('  FAIL  config/' + stem + ' (yaml parse error: ' + (err?.message ?? err) + ')');
      fail = 1;
      continue;
    }
    const validate = ajv.getSchema(BASE_CONFIG + schemaName);
    if (!validate) {
      console.log('  FAIL  config/' + stem + ' (no validator for ' + schemaName + ')');
      fail = 1;
      continue;
    }
    const ok = validate(data);
    if (ok) {
      console.log('  PASS  config/' + stem);
    } else {
      console.log('  FAIL  config/' + stem + ' (schema violation)');
      for (const e of validate.errors ?? []) {
        console.log('      ' + (e.instancePath || '<root>') + ' ' + e.message);
      }
      fail = 1;
    }
  }
  return { fail, total };
}

function main() {
  const ajv = buildAjv();
  loadConfigSchemas(ajv);
  let fail = 0;
  let total = 0;

  for (const sampleDir of readdirSync(SAMPLES)) {
    const fullDir = join(SAMPLES, sampleDir);
    let st;
    try {
      st = statSync(fullDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const schemaPath = findSchemaForSample(sampleDir);
    if (!schemaPath) {
      console.log('  ?  no schema for ' + sampleDir);
      continue;
    }
    const canonical = BASE + relative(V1, schemaPath);
    const validate = ajv.getSchema(canonical);
    if (!validate) {
      console.log('  FAIL  ' + sampleDir + ' (could not build validator for ' + canonical + ')');
      fail = 1;
      continue;
    }

    for (const sampleFile of readdirSync(fullDir)) {
      if (!sampleFile.endsWith('.json')) continue;
      const expectValid = !sampleFile.startsWith('invalid-');
      total += 1;
      const data = JSON.parse(readFileSync(join(fullDir, sampleFile), 'utf8'));
      const ok = validate(data);
      const label = sampleDir + '/' + sampleFile;
      if (ok && expectValid) {
        console.log('  PASS  ' + label);
      } else if (!ok && !expectValid) {
        console.log('  PASS  ' + label + ' (correctly rejected)');
      } else if (ok && !expectValid) {
        console.log('  FAIL  ' + label + ' (expected INVALID, was valid)');
        fail = 1;
      } else {
        console.log('  FAIL  ' + label + ' (expected VALID)');
        for (const e of validate.errors ?? []) {
          console.log('      ' + (e.instancePath || '<root>') + ' ' + e.message);
        }
        fail = 1;
      }
    }
  }

  // Stage R3 — also validate every gated config YAML against its
  // schema/config/ counterpart. Failures here mean the operator
  // wrote a YAML that the Rust normalizer would reject too.
  const cfg = validateConfigYaml(ajv);
  total += cfg.total;
  fail = fail || cfg.fail;

  if (fail) {
    console.error('\n[schema-validate] ' + total + ' samples checked, gate FAILED.');
    process.exit(1);
  }
  console.log('\n[schema-validate] OK -- ' + total + ' samples valid against their schemas.');
}

main();
