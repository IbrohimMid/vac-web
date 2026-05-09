# Wave 5-6 dependency closeout — 2026-05-09

Status: closed out. No further dependency upgrades planned in this wave.

## What landed (PR #23-#29)

- PR #23 — patch/minor dependency drift refresh.
- PR #24 — migrate deprecated `xterm` / `xterm-addon-fit` to scoped `@xterm/*`.
- PR #25 — size-limit tooling upgraded to v12.
- PR #26 — ESLint upgraded to v10.
- PR #27 — `@xterm/xterm` 6 + `@xterm/addon-fit` 0.11. Initial 127.85 kB, tanstack 5.03 kB, xterm lazy 85.39 kB (under 90 kB budget).
- PR #28 — Tailwind CSS 4 (no code/config changes required).
- PR #29 — `@noble/*` v2 crypto upgrade. Adjusted ESM `.js` subpath imports in `apps/web/src/transport/e2e-impl.ts` and switched `x25519.utils.randomPrivateKey()` to `randomSecretKey()`.

All merges validated with `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r test`, and `pnpm -C apps/web size`. Bundle budgets remained green throughout.

## Deferred intentionally

### `@types/node` 22 -> 25

Deferred. The runtime target is still Node 20/22:

- `.nvmrc` is `20.10.0`.
- Root `package.json` `engines.node` is `>=20.10.0`.
- CI main Node jobs run on `22.x`; perf/codegen/security jobs run on `20` / `20.10.0`.
- `packages/protocol-ts/package.json` declares `@types/node ^22.0.0`.

Widening dev types to Node 25 ahead of the runtime would let APIs that do not exist on Node 20/22 typecheck cleanly, hiding real incompatibilities. Re-evaluate only when the runtime target moves past Node 22.

### F4 strict baseline alarm flip

Deferred until 2026-05-21 per `docs/plans/f4-baseline-alarm-date-lock-2026-05-09.md`. Today is 2026-05-09; baseline history is not old enough for a reliable 14-day alarm.

## UX impact

No behavior change for end users. Deferring `@types/node` 25 avoids premature runtime-type widening that would mask real Node 20/22 incompatibilities at typecheck time. Holding the F4 flip avoids noisy perf alarms before there is enough baseline history, which keeps the topbar perf badge meaningful instead of training users to ignore it.

## Next checkpoints

- Re-check `@types/node` only after the runtime target moves beyond Node 22.
- Re-check the F4 strict flip on or after 2026-05-21, inspecting baseline history before changing the perf workflow from measurement-only to strict.
