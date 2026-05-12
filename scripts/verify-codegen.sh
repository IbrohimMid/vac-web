#!/usr/bin/env bash
# Run codegen and fail if committed output drifted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GENERATED_PATHS=(
  packages/protocol-ts/src/v1/generated
  packages/protocol-rs/src/v1/generated
  apps/local-bridge/src/generated/command_catalog.rs
  apps/local-bridge/src/generated/event_catalog.rs
  apps/local-bridge/src/generated/error_taxonomy_catalog.rs
  apps/web/src/generated/commandCatalog.ts
  apps/web/src/generated/eventCatalog.ts
  apps/web/src/generated/errorTaxonomyCatalog.ts
  tools/mock-engine/src/generated/scenario_catalog.rs
)

before_diff="$(mktemp)"
after_diff="$(mktemp)"
trap 'rm -f "$before_diff" "$after_diff"' EXIT

git diff -- "${GENERATED_PATHS[@]}" > "$before_diff"

bash scripts/codegen.sh
node scripts/codegen-command-catalog.mjs --check
node scripts/codegen-event-catalog.mjs --check
node scripts/codegen-error-taxonomy.mjs --check
node scripts/codegen-mock-scenarios.mjs --check
node scripts/check-codegen-manifest.mjs
node scripts/check-node-types-policy.mjs

git diff -- "${GENERATED_PATHS[@]}" > "$after_diff"

if ! cmp -s "$before_diff" "$after_diff"; then
  echo
  echo "[verify-codegen] Generated code drifted after regeneration."
  echo "[verify-codegen] Run 'pnpm codegen' locally and commit the result."
  echo
  diff -u "$before_diff" "$after_diff" || true
  exit 1
fi

echo "[verify-codegen] OK — generated code is stable after regeneration."
