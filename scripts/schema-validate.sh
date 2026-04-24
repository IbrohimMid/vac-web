#!/usr/bin/env bash
# Validate every sample under packages/protocol/v1/_samples/ against its schema.
# valid-*.json must pass; invalid-*.json must fail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

AJV="pnpm exec ajv"

fail=0
for dir in packages/protocol/v1/_samples/*/; do
  name="${dir##packages/protocol/v1/_samples/}"
  name="${name%/}"
  schema="packages/protocol/v1/${name}.schema.json"
  if [[ ! -f "$schema" ]]; then
    # Map snake_case dir to PascalCase filename if needed.
    alt="packages/protocol/v1/$(echo "$name" | awk -F_ '{for(i=1;i<=NF;i++){$i=toupper(substr($i,1,1)) substr($i,2)}; OFS=""; print}').schema.json"
    if [[ -f "$alt" ]]; then schema="$alt"; else
      echo "  ? no schema for $name (looked for $schema)"
      continue
    fi
  fi

  for sample in "$dir"*.json; do
    [[ -f "$sample" ]] || continue
    base="$(basename "$sample")"
    expect_valid=1
    [[ "$base" == invalid-* ]] && expect_valid=0

    if $AJV --spec=draft2020 -s "$schema" -r "packages/protocol/v1/_defs/primitives.schema.json" -d "$sample" --strict=false --all-errors > /tmp/ajv.log 2>&1; then
      if [[ "$expect_valid" -eq 1 ]]; then
        echo "  ✓ $name/$base"
      else
        echo "  ✗ $name/$base (expected INVALID, was valid)"
        fail=1
      fi
    else
      if [[ "$expect_valid" -eq 0 ]]; then
        echo "  ✓ $name/$base (correctly rejected)"
      else
        echo "  ✗ $name/$base (expected VALID)"
        cat /tmp/ajv.log
        fail=1
      fi
    fi
  done
done

if [[ "$fail" -ne 0 ]]; then exit 1; fi
echo "[schema-validate] OK"
