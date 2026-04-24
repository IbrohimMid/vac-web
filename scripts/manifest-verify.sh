#!/usr/bin/env bash
# Compute sha256 for every schema + profile; compare against MANIFEST files.
# Updates manifests if VAC_WEB_UPDATE_MANIFEST=1; otherwise fails on drift.
#
# Hashing:
# - Schemas (JSON): canonical form (sorted keys, no whitespace, UTF-8).
# - Profiles (YAML): raw bytes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
import json, hashlib, os, sys
from pathlib import Path

ROOT = Path('packages/protocol/v1').resolve()
update = os.environ.get('VAC_WEB_UPDATE_MANIFEST') == '1'

def canon_json_hash(p):
    return 'sha256:' + hashlib.sha256(
        json.dumps(json.loads(p.read_text()), sort_keys=True, separators=(',',':'), ensure_ascii=False).encode()
    ).hexdigest()

def raw_hash(p):
    return 'sha256:' + hashlib.sha256(p.read_bytes()).hexdigest()

schemas = sorted([str(p.relative_to(ROOT)) for p in list(ROOT.glob('*.schema.json')) + list((ROOT/'_defs').glob('*.schema.json'))])
mp = ROOT / 'MANIFEST.json'
manifest = json.loads(mp.read_text())
drift = 0
computed = {}
for rel in schemas:
    h = canon_json_hash(ROOT / rel)
    computed[rel] = h
    stored = manifest['schemas'].get(rel)
    if not stored or stored == 'sha256:pending':
        print(f"  ?  {rel}  {h}")
        if not update: drift = 1
    elif stored != h:
        print(f"  ✗  {rel}  expected {stored}  actual {h}")
        drift = 1
    else:
        print(f"  ✓  {rel}")

if update:
    manifest['schemas'] = computed
    mp.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"Updated {mp}")

print("--- profiles ---")
pdir = ROOT / 'profiles'
ppath = pdir / 'PROFILES_MANIFEST.json'
pmani = json.loads(ppath.read_text())
pcomp = {}
for p in sorted(pdir.glob('*.yaml')):
    pid = p.stem
    h = raw_hash(p)
    pcomp[pid] = h
    stored = pmani['profiles'].get(pid)
    if not stored or stored == 'sha256:pending':
        print(f"  ?  {pid}  {h}")
        if not update: drift = 1
    elif stored != h:
        print(f"  ✗  {pid}  expected {stored}  actual {h}")
        drift = 1
    else:
        print(f"  ✓  {pid}")

if update:
    pmani['profiles'] = pcomp
    ppath.write_text(json.dumps(pmani, indent=2) + '\n')
    print(f"Updated {ppath}")

if drift and not update:
    print("\n[manifest-verify] DRIFT. Re-run with VAC_WEB_UPDATE_MANIFEST=1.", file=sys.stderr)
    sys.exit(1)

print("\n[manifest-verify] OK")
PY
