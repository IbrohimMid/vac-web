#!/usr/bin/env bash
# Validate every sample under packages/protocol/v1/_samples/ against its schema.
# valid-*.json must pass; invalid-*.json must fail.
#
# Implementation note: ajv-cli only registers schemas you list explicitly with
# `-r` and does not resolve relative cross-schema refs the way our $id/$ref
# layout requires (see scripts/schema-validate.mjs for the long form).
# We therefore drive AJV programmatically from Node so we can register every
# schema under multiple aliases and resolve `EvidenceRef.json`-style refs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

exec node scripts/schema-validate.mjs "$@"
