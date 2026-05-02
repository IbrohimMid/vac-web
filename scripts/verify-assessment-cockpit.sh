#!/usr/bin/env bash
# Focused assessment regression gate for the readiness cockpit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== web typecheck ==="
pnpm --filter @vac-web/web typecheck

echo "=== web assessment tests ==="
pnpm --filter @vac-web/web test -- \
  src/components/Readiness/readinessCockpit.contract.test.ts \
  src/components/Readiness/RunDetailsCard.test.tsx \
  src/components/Readiness/AssessmentReportDetail.test.tsx \
  src/scripts/verifyAssessmentCockpit.test.ts \
  src/stores/assessment.test.ts

echo "=== all checks passed ==="
