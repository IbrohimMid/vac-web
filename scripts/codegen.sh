#!/usr/bin/env bash
# Generate TypeScript + Rust types from JSON schemas via the vac-codegen Rust binary.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[codegen] building vac-codegen..."
cargo build -p codegen --quiet

echo "[codegen] generating..."
cargo run -p codegen --quiet -- \
  --schemas packages/protocol/v1 \
  --ts-out packages/protocol-ts/src/v1/generated \
  --rs-out packages/protocol-rs/src/v1/generated

echo "[codegen] formatting Rust outputs..."
cargo fmt --all --quiet

echo "[codegen] done."
