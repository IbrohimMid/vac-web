# Capabilities — classifier governance

This directory tracks the capability classification convention introduced in slice 1.2 + 5.1 closeout (2026-05-06).

## Convention

Every backend code class under `apps/local-bridge/src/` is mapped to a capability id in `config/capability-coverage.yaml`. The mapping is the source of truth for:

- Which subsystem owns a given module.
- Which capability profile gates the module's actions (cross-reference `packages/protocol/v1/capability_profile.schema.json`).
- Audit log `event` namespace prefix (e.g. `bridge.session.*`, `bridge.audit.*`).

## Format

```yaml
<module_path>: <capability_id>
```

- `module_path`: file path relative to repo root.
- `capability_id`: lowercase dotted identifier, e.g. `bridge.session`, `bridge.audit`.

## Adding a new backend module

1. Create the module under `apps/local-bridge/src/<your_module>/mod.rs` (or `<your_module>.rs`).
2. Add an entry in `config/capability-coverage.yaml`:
   ```yaml
   apps/local-bridge/src/your_module/mod.rs: bridge.your_module
   ```
3. Run `node scripts/check-capability-coverage.mjs` locally to confirm.
4. CI gate `capability-coverage` in `.github/workflows/ci.yml` enforces the manifest stays in sync.

## Frontend capability classifiers

UI capability classifier modules live in `apps/web/src/domain/capabilities/`. Scaffold a new one with:

```bash
node scripts/vac-capability-new.mjs <name>
```

The generated module follows the canonical exports (`classify<Name>`, `is<Name>Event`, `<NAME>_CODES`, `<NAME>_FALLBACK`) used by Topbar status chip + notify lanes.

## Exempt files

The following are intentionally not classified:

- `apps/local-bridge/src/lib.rs` — module root.
- `apps/local-bridge/src/main.rs` — binary entry.
- `apps/local-bridge/src/generated/` — codegen output.

## Related docs

- `docs/capability-profiles.md` — profile schema + evaluation rules.
- `docs/plans/wiring/27-config-capabilities-control-plane.md` — design context (slice 27, landed).
- `docs/enterprise-maturity-scorecard.md` — dimension 5.1.
