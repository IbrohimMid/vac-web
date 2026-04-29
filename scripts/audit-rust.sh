#!/usr/bin/env bash
# Local-only convenience wrapper around cargo-audit and cargo-deny.
#
# CI runs the canonical versions of these checks via `.github/workflows/
# security.yml`. This script lets a developer reproduce them locally without
# remembering the exact flag set, and it degrades gracefully when the tools
# aren't installed (the audit pass-2 finding called out that `cargo audit`
# was unavailable on the maintainer's machine).
#
# Exit code semantics:
#   0  = both tools available and clean (or only one installed and clean)
#   1  = a tool reported a finding
#   2  = neither tool is installed (advisory — user can ignore for local
#         work, CI still enforces the real gate)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

have_audit=0
have_deny=0
command -v cargo-audit >/dev/null 2>&1 && have_audit=1
command -v cargo-deny >/dev/null 2>&1 && have_deny=1

if [[ $have_audit -eq 0 && $have_deny -eq 0 ]]; then
  cat <<EOF >&2
[audit-rust] neither cargo-audit nor cargo-deny is installed locally.
  Install with:
    cargo install cargo-audit
    cargo install cargo-deny
  CI still enforces these via .github/workflows/security.yml.
EOF
  exit 2
fi

status=0

if [[ $have_audit -eq 1 ]]; then
  echo "[audit-rust] cargo audit"
  if ! cargo audit --quiet; then
    status=1
  fi
else
  echo "[audit-rust] cargo-audit not installed (skipped)"
fi

if [[ $have_deny -eq 1 ]]; then
  echo "[audit-rust] cargo deny check"
  if ! cargo deny check; then
    status=1
  fi
else
  echo "[audit-rust] cargo-deny not installed (skipped)"
fi

exit $status
