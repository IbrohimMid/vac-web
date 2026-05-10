# ADR-0005: Pin `@types/node` at 22.x until the runtime target moves past Node 22

- Status: proposed
- Date: 2026-05-09
- Owners: web, tools
- Related slice(s): F4, wave-5-6 dependency closeout

## Context

The repository still targets Node 20/22 for development and CI:

- `.nvmrc` is `20.10.0`.
- Root `package.json` `engines.node` is `>=20.10.0`.
- Main CI Node jobs run on `22.x`; perf, codegen, and security jobs still run on `20` / `20.10.0`.
- `packages/protocol-ts/package.json` currently declares `@types/node ^22.0.0`.

`@types/node` 25.x exists, but widening the dev types before the runtime floor moves would let APIs typecheck that are not guaranteed to exist on Node 20/22.

## Decision

Keep `@types/node` pinned at the 22.x line across the workspace until the runtime target moves past Node 22. Do not widen the shared type baseline ahead of the runtime.

## Consequences

- Positive: typechecking stays aligned with the actual runtime surface, so we do not mask Node 20/22 incompatibilities.
- Positive: package and CI drift stay smaller, which keeps the closeout wave easier to reason about.
- Negative: the workspace cannot adopt newer Node library types until the runtime floor is raised.
- Negative: some newer editor hints from `@types/node` 25.x remain unavailable for now.

## Un-defer triggers

Revisit this decision when one of the following is true:

- The runtime target moves to Node 24 LTS or later.
- The minimum `engines.node` floor moves to `>=22`.
- `@types/node` 22.x stops shipping or is no longer supported in the workspace tooling baseline.

## Cross-references

- `docs/plans/README.md`
- `packages/protocol-ts/package.json`
- `README.md`
- `CHANGELOG.md`
