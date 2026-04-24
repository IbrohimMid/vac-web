#!/usr/bin/env bash
# Run bridge + web concurrently for local dev.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${VAC_WEB_BRIDGE_PORT:=7777}"
export VAC_WEB_PORT="$VAC_WEB_BRIDGE_PORT"
export VAC_BRIDGE_URL="http://127.0.0.1:${VAC_WEB_BRIDGE_PORT}"

echo "[dev] bridge -> $VAC_BRIDGE_URL"
echo "[dev] web   -> http://localhost:5173 (proxied /api -> bridge)"

cleanup() {
  trap - EXIT
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

( cargo run -p local-bridge --quiet 2>&1 | sed 's/^/[bridge] /' ) &
( pnpm --filter @vac-web/web dev 2>&1 | sed 's/^/[web]    /' ) &

wait
