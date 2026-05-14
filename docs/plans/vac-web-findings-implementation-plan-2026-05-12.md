# VAC-WEB Findings Implementation Plan — 2026-05-12

Source: Repo-local mirror reconstructed from the handoff prompt, repository history, and local validation results. Claude Code does not have Notion access, so this file must not claim to be a live export of the Notion page.

## Phase 6 follow-up validation — 2026-05-14

Status: Phase 6 e2e follow-up is green, committed, and ready for push.

Commit: `98115ff` — `Fix Phase 6 e2e validation wiring`

Validation:
- `df -h .` before build/test: checked; root filesystem had about 21G available.
- `pnpm -F web test -- src/markdown src/components src/app --run`: passed.
- `pnpm -F web typecheck`: passed.
- `VAC_WEB_E2E_PORT=4189 pnpm -F web test:e2e`: passed.
- `git diff --check`: passed.

UX impact:
- E2E now exercises the real production bundle against the intended mock bridge instead of accidentally reusing a wrong local preview server.
- Assessment users get stable coverage for live run progress, query failure banners, and worker-output rejection warnings inside the report detail surface.
- The `worker_output_rejected` warning remains tied to the matching run report, keeping the UI honest about broken worker envelopes without confusing it with generic retryable read failures.

Residual risk:
- The deterministic bridge override and mock session path are test/dev-only hooks scoped to explicit `window.__vacBridgeOverride` injection.
- The mock bridge ordering is intentionally deterministic for e2e; production event ordering still depends on the real bridge/runtime contract.
- Full workspace-wide validation remains required before declaring all phases complete.
