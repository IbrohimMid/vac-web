#!/usr/bin/env bash
# Run codegen and fail if committed output drifted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash scripts/codegen.sh

if ! git diff --exit-code --quiet -- packages/protocol-ts/src/v1/generated packages/protocol-rs/src/v1/generated; then
  echo
  echo "[verify-codegen] Generated code drifted from committed content."
  echo "[verify-codegen] Run 'scripts/codegen.sh' locally and commit the result."
  echo
  git diff -- packages/protocol-ts/src/v1/generated packages/protocol-rs/src/v1/generated || true
  exit 1
fi

echo "[verify-codegen] OK — generated code matches committed."
