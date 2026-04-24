# Plan 0.6-03 — TypeScript build + AJV schema validation

**Phase**: 0.6 · **Depends on**: Phase 0.4 codegen + network access for `pnpm install` · **Blocks**: 1.5 · **Est**: 0.5 day

## Goal

Prove the TypeScript half works end-to-end. Currently generated TS types exist but have never been compiled. AJV script exists but has never run. Until both are green, Phase 1.5 (web scaffold) blocks.

## Why this is hard

Small: this is plumbing. But debt here compounds — a type that doesn't compile blocks every downstream Phase 1 web work.

## Scope

### In
- `pnpm install` → commit `pnpm-lock.yaml`.
- `pnpm -r build` green (web + protocol-ts).
- `pnpm -r typecheck` strict mode green.
- AJV formats installed; `scripts/schema-validate.sh` passes for all samples.
- Web smoke test imports + uses a generated type.

### Out
- Full web UI (Phase 1.5, 1.6).
- `pnpm -r test` unit tests (trivial placeholder OK for v1).

## Stages

### S1 — `pnpm install` + lockfile (0.1 day)

Run `pnpm install` at repo root.
- Commit `pnpm-lock.yaml`.
- Verify `node_modules/` ignored.
- Test workspace resolution: `pnpm ls -r` lists all packages.

**Exit**: clean install + lockfile committed.

### S2 — protocol-ts build (0.1 day)

```bash
pnpm --filter @vac-web/protocol build
```

If errors:
- Generated types use `Record<string, unknown>` for objects — should compile with strict.
- Any `unknown` needed for discriminated union variant without per-type payload.
- Add `tsconfig.json` `outDir: "dist"` if missing; ensure `include` covers `src/v1/generated/`.

Verify output: `packages/protocol-ts/dist/` contains `.d.ts` + `.js` per module.

**Exit**: `pnpm --filter @vac-web/protocol build` exits 0.

### S3 — Web typecheck + build (0.1 day)

```bash
pnpm --filter @vac-web/web typecheck
pnpm --filter @vac-web/web build
```

Main.tsx currently: plain fetch to `/api/health`. Likely compiles. Any drift from root `tsconfig.base.json`:
- `noUncheckedIndexedAccess: true` might break some array access.
- `exactOptionalPropertyTypes: true` might break some prop spread.

Fix each as it surfaces; keep strict flags on.

**Exit**: web builds to `apps/web/dist/`.

### S4 — AJV ref resolution (0.1 day)

Current `scripts/schema-validate.sh`:
```bash
pnpm exec ajv --spec=draft2020 -s "$schema" -r "packages/protocol/v1/_defs/primitives.schema.json" -d "$sample"
```

Run it. If `$ref` resolution fails:
- Ensure AJV 8+; draft 2020-12 support requires that.
- Ensure `ajv-formats` installed for `date-time` format.
- Pass `--all-errors` to see all issues.

Fix any sample files with schema violations (should be none if Rust round-trip passed — consistency expected).

**Exit**: `bash scripts/schema-validate.sh` prints only ✓ entries.

### S5 — Web smoke test (0.1 day)

`apps/web/src/protocol-consumer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { AssessmentFinding, Command } from '@vac-web/protocol';

describe('protocol consumer', () => {
  it('narrows Command discriminated union', () => {
    const cmd: Command = {
      id: 'cmd_01J00000000000000000000001',
      session_id: 'sess_01J00000000000000000000002',
      type: 'message.submit',
      payload: { text: 'hi' },
      v: 1,
    };
    if (cmd.type === 'message.submit') {
      // narrowing: payload is unknown but accessible
      expect(cmd.payload).toBeDefined();
    }
  });

  it('accepts AssessmentFinding shape', () => {
    const f: AssessmentFinding = {
      id: '01J0000000000000000000FN99',
      run_id: '01J0000000000000000000RN99',
      family_id: 'assessor.rtd',
      category: 'devops',
      subsystem: 'secrets',
      severity: 'critical',
      confidence: 0.9,
      title: 'Test',
      description: 'Test',
      evidence: [{
        id: '01J0000000000000000000EV99',
        kind: 'file',
        uri: 'file:///x',
        observed_at: '2026-04-24T10:00:00Z',
        fresh_until: '2030-01-01T00:00:00Z',
        staleness_policy: 'immutable',
        captured_by: 'test',
      }],
      fixability: 'manual',
      identity_hash: 'sha256:abc',
      created_at: '2026-04-24T10:00:00Z',
      emitted_by: 'test',
    };
    expect(f.severity).toBe('critical');
  });
});
```

Run via vitest:
```bash
pnpm --filter @vac-web/web test
```

**Exit**: test green.

### S6 — CI job integration (0.1 day)

Update `.github/workflows/ci.yml`:
- `node` job: `pnpm install --frozen-lockfile && pnpm -r build && pnpm -r typecheck && pnpm -r test`.
- `schema` job: `pnpm install --frozen-lockfile && bash scripts/schema-validate.sh`.

Remove `--frozen-lockfile` on first run (no lock yet); add once committed.

**Exit**: CI workflow green on PR.

## Exit criteria

- [ ] `pnpm install` succeeds; lockfile committed.
- [ ] `pnpm -r build` green.
- [ ] `pnpm -r typecheck` strict green.
- [ ] Web smoke test passes.
- [ ] `schema-validate.sh` all ✓.
- [ ] CI jobs green.

## Risks

| Risk | Mitigation |
|---|---|
| AJV `$ref` edge cases across files | Load all schemas via multiple `-r` or use `addSchema` via JS test runner |
| Strict TypeScript breaks generated types | Codegen emits `?` for optional; should pass strict. If not, relax `exactOptionalPropertyTypes` temporarily + fix root cause |
| `pnpm-lock.yaml` churn in PRs | Pin `packageManager` in root `package.json`; team uses same pnpm version |

## Related

- [`docs/plans/phase-0.5/02-codegen-pipeline.md`](../phase-0.5/02-codegen-pipeline.md) — generates the types validated here.
- [`docs/plans/phase-1.5/README.md`](../phase-1.5/README.md) — first consumer of proven TS stack.
