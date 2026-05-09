# Dependency Audit - 2026-05-09

Status: complete. Audit captured `pnpm audit`, `cargo audit`, `pnpm outdated`, and `cargo outdated`.

## Pre-fix advisory count

- `pnpm audit`: 5 advisories
- `cargo audit`: 0 advisories

All five npm advisories are in dev tooling/transitive chains. No production runtime package was upgraded as part of this pass.

## Fixes applied

- None.

No manifest, lockfile, or Rust crate changes were made. The direct package versions already at the workspace root were the latest published versions checked during this pass:

- `ajv` 8.20.0
- `ajv-cli` 5.0.0
- `size-limit` 12.1.0
- `@size-limit/preset-big-lib` 12.1.0

## Advisory breakdown

| ID | Package | Severity | Path | Patched in | Status |
| --- | --- | --- | --- | --- | --- |
| 1096610 | `fast-json-patch` | high | `ajv-cli@5.0.0 > fast-json-patch@2.2.1` | `>=3.1.1` | Deferred |
| 1117683 | `ip-address` | moderate | `apps/web > @size-limit/preset-big-lib@12.1.0 > ... > ip-address@10.1.0` | `>=10.1.1` | Deferred |
| 1117870 | `fast-uri` | high | `ajv@8.20.0 > fast-uri@3.1.0` and `apps/web > @size-limit/preset-big-lib@12.1.0 > ... > fast-uri@3.1.0` | `>=3.1.1` | Deferred |
| 1117884 | `fast-uri` | high | same transitive chains as above | `>=3.1.2` | Deferred |
| 1117910 | `basic-ftp` | high | `apps/web > @size-limit/preset-big-lib@12.1.0 > ... > basic-ftp@5.3.0` | `>=5.3.1` | Deferred |

## Deferred fixes

### Breaking change or unavailable upstream

- `fast-json-patch` via `ajv-cli`: the current published `ajv-cli` line is already `5.0.0`, so there is no same-line patch bump to apply.
- `fast-uri` via `ajv` and `ajv-formats`: the current published `ajv` line is already `8.20.0`, so there is no same-line bump to a patched `fast-uri` release available from this workspace.
- `ip-address` and `basic-ftp` via `@size-limit/preset-big-lib`: the published `size-limit` and preset versions checked during this pass were already `12.1.0`, so there is no same-line package bump to land here.

### F4 lock

- None. The F4 date-lock is documented separately, but it does not block any dependency bump in this audit because no safe bump was available.

### Runtime mismatch

- None. This audit did not identify a Node runtime-floor mismatch that required a dependency move.

## Outdated packages summary

### pnpm outdated

No output.

### cargo outdated

```text
All dependencies are up to date, yay!
```

## Recommended next actions

1. Re-run `pnpm audit` after a future release of `ajv`, `ajv-cli`, or `size-limit` lands on a patched line.
2. Keep the F4 strict flip date-locked until 2026-05-21.
3. Re-run dependency audits in the next maintenance sweep, even if `pnpm outdated` remains empty, because security advisories can lag version publication.

## UX impact

None. This is maintenance and security documentation only; no end-user surface changed.
