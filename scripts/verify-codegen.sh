#!/usr/bin/env bash
# Run codegen and fail if committed output drifted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash scripts/codegen.sh
node scripts/codegen-command-catalog.mjs --check
node scripts/codegen-event-catalog.mjs --check
node scripts/codegen-error-taxonomy.mjs --check
node scripts/codegen-mock-scenarios.mjs --check

if ! git diff --exit-code --quiet -- \
  packages/protocol-ts/src/v1/generated \
  packages/protocol-rs/src/v1/generated \
  apps/local-bridge/src/generated/command_catalog.rs \
  apps/local-bridge/src/generated/event_catalog.rs \
  apps/local-bridge/src/generated/error_taxonomy_catalog.rs \
  apps/web/src/generated/commandCatalog.ts \
  apps/web/src/generated/eventCatalog.ts \
  apps/web/src/generated/errorTaxonomyCatalog.ts \
  tools/mock-engine/src/generated/scenario_catalog.rs; then
  echo
  echo "[verify-codegen] Generated code drifted from committed content."
  echo "[verify-codegen] Run 'pnpm codegen' locally and commit the result."
  echo
  git diff -- \
    packages/protocol-ts/src/v1/generated \
    packages/protocol-rs/src/v1/generated \
    apps/local-bridge/src/generated/command_catalog.rs \
    apps/local-bridge/src/generated/event_catalog.rs \
    apps/local-bridge/src/generated/error_taxonomy_catalog.rs \
    apps/web/src/generated/commandCatalog.ts \
    apps/web/src/generated/eventCatalog.ts \
    apps/web/src/generated/errorTaxonomyCatalog.ts || true
  exit 1
fi

echo "[verify-codegen] OK — generated code matches committed."
