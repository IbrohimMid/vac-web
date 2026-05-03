# Schema migrations

This directory holds versioned converters for durable schemas. See
`docs/data-contract-versioning.md` for the policy.

## Layout

```
schema/
  migrations/
    README.md                     # this file
    persistence/
      v0_to_v1.md                 # narrative description + checklist
      v0_to_v1.rs                 # planned converter implementation
      fixtures/
        v0__minimal.json
        v1__minimal.json
    audit/
      ...
    workflows/
      ...
```

## Authoring rules

1. One subdirectory per durable surface (persistence, audit,
   workflows, etc.).
2. Each migration documents the source version, target version, and
   any field-by-field transformation in a Markdown file next to the
   converter implementation.
3. Each migration ships:
   * A converter function with unit tests.
   * A pair of fixtures (pre + post) that round-trip through the
     converter.
   * An entry in the surface's reader test that loads each supported
     pre-version fixture and asserts the converter output equals the
     post-version fixture.
4. Once a migration ships, neither the converter nor its fixtures may
   be changed except to fix a bug; new behavior goes into the next
   migration.

## Removing migrations

A migration may be removed only after its source version has been out
of support for at least one full release cycle, and only with an ADR
that documents the removal.

## Validation gates

* `cargo test -p local-bridge --lib` runs persistence/audit migration
  round-trip tests.
* `pnpm --filter @vac-web/web test -- --run` runs schema-driven
  workflow migration tests.
