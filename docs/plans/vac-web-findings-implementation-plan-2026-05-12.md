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


## Phase 7 execution — 2026-05-14

Status: Phase 7 reporting-contact cleanup is green, committed, and ready for push.

Commit: `2af7f77` — `Replace placeholder reporting contacts`

Changes:
- `SECURITY.md` now uses GitHub Security Advisories as the canonical private vulnerability reporting path and no longer advertises an unmonitored `.invalid` email.
- `.github/ISSUE_TEMPLATE/security.md` now redirects to GitHub Security Advisories only.
- `CODE_OF_CONDUCT.md` no longer lists a fake conduct inbox. It states the current limitation honestly: public GitHub issues are acceptable only for non-sensitive conduct reports, while sensitive/private reports should not be posted publicly until maintainers provide a private path or GitHub platform reporting is used.

Validation:
- `df -h .`: checked before validation; root filesystem had about 21G available.
- `git grep -n "conduct@vac-web.invalid\|security@vac-web.invalid\|security@example\|reporting@example\|@example.com" -- CODE_OF_CONDUCT.md SECURITY.md .github/ISSUE_TEMPLATE`: no matches.
- `git diff --check`: passed.

UX impact:
- Security reporters now see one real private disclosure path instead of a fake email address.
- Conduct reporters are not misled into emailing an unmonitored address; the docs make the privacy limitation explicit and steer sensitive reports away from public disclosure.

Residual risk:
- A monitored private conduct contact is still not configured in-repo. The current copy is intentionally honest rather than inventing a fake address.
- Security disclosure depends on GitHub Security Advisories being enabled/available for the repository.
