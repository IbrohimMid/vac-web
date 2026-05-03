# Module boundaries and layering (slice 37)

## Layers

```
+------------------------------------------------------------+
|                  Web cockpit (apps/web)                    |
|   components -> stores -> domain -> capabilities -> generated
+------------------------------------------------------------+
                                ^
                                | WebSocket protocol (packages/protocol/v1)
                                v
+------------------------------------------------------------+
|             Local bridge (apps/local-bridge)              |
|   ws -> session -> translator -> agent_runtime -> profile_layer
|                                          |
|                                          +-> persistence / audit / capabilities
+------------------------------------------------------------+
                                ^
                                | profile-core / bridge-core
                                v
+------------------------------------------------------------+
|         Shared crates (packages/profile-core, ...)        |
+------------------------------------------------------------+
```

## Allowed dependencies

| From | To | Notes |
| --- | --- | --- |
| `apps/web/src/components/**` | `apps/web/src/stores`, `apps/web/src/domain` | UI consumes domain; never reach into bridge. |
| `apps/web/src/domain/**` | `apps/web/src/domain/capabilities`, `apps/web/src/generated` | Domain layer composes capability classifiers and generated catalogs. |
| `apps/web/src/domain/capabilities/**` | _no app-internal imports_ | Pure functions only. May import from `packages/protocol-ts` for types. |
| `apps/local-bridge/src/translator/**` | `apps/local-bridge/src/session`, `agent_runtime`, `profile_layer`, `generated` | Translator orchestrates; it never imports `ws::handler` directly. |
| `apps/local-bridge/src/profile_layer/**` | `packages/profile-core`, `generated/command_catalog` | Pure policy. No fs / network. |
| `packages/profile-core/**` | _stdlib + serde + ts-rs_ | Pure. No tokio, no axum. |
| `tools/mock-engine/**` | `packages/protocol-rs`, `tools/codegen-shared` | Mock-engine never imports from `apps/local-bridge` runtime modules. |

## Forbidden dependencies

* UI ↛ bridge runtime (`apps/web` cannot import from `apps/local-bridge`).
* Generated code ↛ hand-written code (generated files have no imports
  from runtime modules; runtime imports them, never the other way).
* `profile-core` ↛ tokio/axum (it is a pure policy crate).
* `tools/mock-engine` ↛ `apps/local-bridge` runtime (mock-engine is a
  separate process; it speaks the same protocol).

## Fitness tests

Planned:

* `scripts/check-architecture-boundaries.mjs` — walks the import graph
  for `apps/web/src` and `apps/local-bridge/src` and refuses any edge
  not in the allow-list above.
* `apps/local-bridge/tests/architecture_boundaries.rs` — cargo-level
  test that asserts crate dependency graph using `cargo metadata`.
* `pnpm depcruise` (planned) — dependency-cruiser config in
  `.dependency-cruiser.cjs` (planned).

## When you need a new edge

1. Open an ADR explaining the new edge and why it does not weaken
   layering.
2. Update this doc with the new row.
3. Update the fitness tests to allow the new edge.
4. Land the code change in the same PR as the ADR + doc + test update.
