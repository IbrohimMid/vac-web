# Data contracts, versioning, and migrations (slice 44)

This doc defines versioning rules for the durable data shapes in the
repo: protocol schemas, persisted session events, workflow specs, config
files, and audit entries. The goal is replay safety across versions and a
runbook for breaking changes.

## Versioned surfaces

| Surface | Location | Versioning | Migration owner |
| --- | --- | --- | --- |
| Protocol command/event schemas | `packages/protocol/v1/` | URL-style major version (`v1`, `v2`). Additive within a major. | protocol |
| Persisted session events | `apps/local-bridge/src/session/persistence/` | Per-event `schema_version` field. Reader supports `v - 1` always, `v - 2` best-effort. | bridge |
| Workflow specs | `examples/workflows/*.yaml` | `version: <int>` per spec. Breaking change → new file + ADR. | bridge + product |
| Config files | `config/`, `schema/config/` | Top-level `schema_version`. Loader rejects unknown major. | bridge + dx |
| Mock scenarios | `tools/mock-engine/scenarios/*.yaml` | Match canonical event catalog version. Legacy scenarios declare `replacement`. | tools |
| Audit log entries | `apps/local-bridge/src/audit/` | Append-only with `schema_version`. Reader retains all versions. | security |

## Compatibility rules

1. **Additive within a major version.** New optional fields — yes. New
   required fields — only with a major bump.
2. **Reader >= writer.** Persistence and audit readers must handle every
   version they ever wrote. Add a fixture for each release.
3. **Breaking change requires an ADR.** See `docs/adr/0000-template.md`.
4. **Deprecation window.** A retired field/event must remain readable
   for at least one release after writers stop emitting it.
5. **No silent drops.** A field a reader does not know about is preserved
   in raw form, never silently dropped.

## Replay safety

* Persisted session replay must be deterministic across the supported
  version window. Tests in `apps/local-bridge/tests/persistence_replay.rs`
  load a fixture per supported version and assert the replay produces
  the expected event stream.
* Audit replay must be byte-stable across the full history (audit log is
  append-only; readers may add, never modify).

## Migration runbook (template)

When authoring a breaking change:

1. Open an ADR describing the change and its migration path.
2. Add the new schema version next to the old one. Do not delete the
   old version yet.
3. Add a converter (`vN -> vN+1`) under `schema/migrations/` with tests.
4. Update writers to emit the new version behind a feature flag.
5. After one release with both versions running in production, flip the
   default writer.
6. After the deprecation window, remove the old writer (readers stay).

## Validation gates

* `pnpm --filter @vac-web/web typecheck`
* `cargo test -p local-bridge --lib`
* Persistence replay parity tests (per supported version).
* Schema parity check between protocol package and generated bindings.

## Anti-patterns to refuse

* Renaming a field in place without bumping `schema_version`.
* Adding a required field within an existing major.
* Letting mock-engine emit canonical events with shapes that differ from
  bridge writers.
