#!/usr/bin/env bash
# X.5c.2 cockpit smoke verification. Run from repo root.
set -euo pipefail

echo "=== typecheck ==="
pnpm --filter @vac-web/web typecheck

echo "=== tests ==="
pnpm --filter @vac-web/web test

echo "=== build ==="
pnpm --filter @vac-web/web build

echo "=== backend tests ==="
cargo test -p local-bridge --test acp_driver x5c2 2>&1 | tail -20

echo "=== capability guard ==="
if rg "read_text_file: true|write_text_file: true|terminal: true" apps/local-bridge/src 2>/dev/null | grep -v "test\|doc\|//" ; then
  echo "FAIL: capability guard violated" && exit 1
fi
echo "capability guard: PASS"

echo "=== all checks passed ==="
