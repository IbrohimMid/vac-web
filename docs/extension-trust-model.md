# Extension trust and signing model (slice 47 follow-up, 2026-05-06)

> **Status:** design pass. No runtime code in this pass — runtime gates land when the first dynamic loader actually ships.
> **Supersedes:** none. Extends `docs/extension-boundaries.md` with explicit trust tiers, signing pipeline, allowlist source-of-truth, and runtime-gate sketch.
> **Cross-links:** slice 26 (agent-registry-mcp), slice 13 (connectors), slice 43 (security-supply-chain), slice 47 (extension-plugin-boundaries), [ADR 0003](./adr/0003-extension-trust-model.md).

## 1. Trust tiers

VAC distinguishes four trust tiers for any extension surface (MCP server, custom agent, workflow plugin, connector, capability classifier override).

| Tier | Definition | Default policy | Override |
| --- | --- | --- | --- |
| `bundled` | Ships in this repo under `apps/`, `packages/`, `tools/`, `config/`. Signed by the build pipeline. | Always allowed; gated by ordinary code review. | n/a |
| `verified` | Out-of-repo extension signed by the official VAC release key. | Allowed if signature verifies and the manifest is in the workspace allowlist. | Operator can revoke via allowlist. |
| `community` | Signed by a non-VAC key declared in the allowlist. | Allowed only if (a) operator has explicitly added the publisher's key to `config/extension-trust.yaml::publishers`, and (b) the manifest signature verifies. | Operator can revoke. |
| `unsigned` | No verifiable signature. | **Refused by default.** Loading attempts produce `extension.refused_unsigned` audit event. | Operator can opt-in via `config/extension-trust.yaml::allow_unsigned: true` (logged + audited; not recommended outside dev). |

## 2. Signing pipeline

### 2.1 Binary artifacts (custom MCP servers, executor binaries)

- Signed via [Sigstore cosign](https://github.com/sigstore/cosign) (keyless OIDC mode preferred for VAC release pipeline; key-based mode supported for community publishers).
- Signature stored alongside the binary as `<artifact>.sig` plus a transparency-log entry in Rekor.
- Verification runs at extension load time inside `bridge-core::extension_loader` (proposed module; not yet implemented).

### 2.2 Declarative extensions (YAML manifests, capability profiles, connector configs)

- PGP detached signature (`<file>.asc`) or in-band signature block at end of YAML.
- Verifier reuses the same public-key allowlist as binary artifacts.
- Manifest signature scope is the canonical YAML byte stream after de-anchor + sort-keys normalization to avoid superficial-diff signature breakage.

### 2.3 Trust root

- VAC release key fingerprint: _TBD until v1.0 release_ (placeholder; will be set when the first signed release ships).
- Community publisher keys: declared in `config/extension-trust.yaml::publishers[].fingerprint`.

## 3. Allowlist source of truth

`config/extension-trust.yaml` (proposed shape; not yet runtime-enforced):

```yaml
version: 1
allow_unsigned: false   # operator opt-in for unsigned extensions; default false
publishers:
  - id: vac-official
    fingerprint: "TBD-WHEN-V1-LANDS"
    tier: verified
    valid_until: "2030-01-01"  # optional; rotation grace
  # - id: example-third-party
  #   fingerprint: "ABCD1234..."
  #   tier: community
extensions:
  # - kind: mcp_server
  #   manifest: extensions/mcp/example/manifest.yaml
  #   publisher: example-third-party
  #   pinned_version: "1.2.0"
  #   pinned_signature_sha256: "..."
```

Drift gate: a planned `scripts/check-extension-trust.mjs` (slice 47 Phase 2) will verify that every extension referenced from runtime configs is listed here and that no orphan publisher keys exist.

## 4. Runtime gate sketch

The runtime gate lives in `packages/profile-core::enforce_extension_trust` (proposed; not yet implemented). API mirrors existing `enforce_*` helpers:

```rust
pub fn enforce_extension_trust(
    ext_kind: ExtensionKind,
    manifest: &ExtensionManifest,
    allowlist: &ExtensionTrustAllowlist,
) -> Result<TrustDecision, ExtensionTrustError>
```

Validation order:

1. `manifest.signature` present? If not, fall through to `allow_unsigned` gate.
2. Signature verifies against a publisher key in the allowlist?
3. Publisher tier compatible with the extension's declared tier?
4. Extension entry in `config/extension-trust.yaml::extensions` matches manifest hash + version?
5. Capability scope of the extension is a subset of what the active capability profile permits.

Failures emit `extension.refused` audit events with structured diagnostic.

## 5. Disable / quarantine flow

Operator UX (cockpit-side, slice 47 Phase 4):

- **List view** shows all loaded extensions with their current trust tier, publisher, and signature status chip.
- **Revoke** removes the publisher key from `config/extension-trust.yaml::publishers`; takes effect at next bridge restart (no hot-revoke in v1; trust changes are restart-scoped to keep audit semantics simple).
- **Quarantine** moves an extension to `quarantined: true` in the allowlist; bridge refuses to load it but preserves the entry so audit history stays linked.

## 6. Adoption phases

| Phase | Scope | Status | Tracker |
| --- | --- | --- | --- |
| 1 | Design doc (this file) + ADR 0003 | landed 2026-05-06 | Current durable source: this file + `docs/adr/0003-extension-trust-model.md` |
| 2 | `config/extension-trust.yaml` shape + drift gate | planned | follow-up |
| 3 | `enforce_extension_trust` runtime gate | planned | follow-up |
| 4 | Cockpit UX (list, revoke, quarantine) | planned | follow-up |
| 5 | First signed VAC release artifact | planned | tied to v1.0 release-cycle |

## 7. Non-goals

- Hot-revoke without restart (Phase 5+ if it becomes necessary).
- Cross-organization key federation beyond the publisher allowlist.
- In-process plugin loaders (explicitly rejected by `docs/extension-boundaries.md`).
- Replacing capability profiles — trust is orthogonal: a verified extension still goes through the capability profile enforcement layer.

## 8. Open questions

1. Should manifest signatures cover the full transitive dependency closure, or only the manifest itself? (Initial design: manifest only; bring-your-own deps signed separately.)
2. How are publisher key rotations handled? (Initial design: add new fingerprint, leave old as `tier: verified` until `valid_until` expires.)
3. Should there be an operator "panic-revoke-all-community" command? (Probably yes; tracked as Phase 4 follow-up.)

## 9. Runtime API

Phase 3 (audit hardening 2026-05-06) wires the runtime gate behind two sessionless commands handled at `apps/local-bridge/src/extensions/handlers.rs`. See `docs/protocol.md` §3.17 / §4.14 for the wire shapes.

### `extensions.list`

Read-only. Loads `config/extension-trust.yaml`, computes `enforce_extension_trust` for each entry, and emits `extensions.list_response` with the live decision per entry. Cockpit Settings → Extensions consumes this to render the list view described in §5.

### `extensions.update_trust`

State-mutating. Updates a single entry's `tier` in `config/extension-trust.yaml`. Defense-in-depth invariants enforced at the handler layer:

- **Admin gate** (`apps/local-bridge/src/extensions/admin_gate.rs`): the bridge env var `VAC_EXTENSIONS_ADMIN` must be set to a non-empty secret; the command payload must echo it as `admin_token`. Default-deny — leaving the env unset disables the command for all callers. This is the substitute for session-bound profile-class gating until `extensions.update_trust` becomes session-bound (tracked as a future slice).
- **No auto-insert.** Unknown `extension_id` values surface as `extensions.unknown_id`; the YAML is left untouched. Operators must add new extensions to the config file out-of-band.
- **Restricted transitions.** `revoked` → `allowed_bundled` / `revoked` → `allowed_signed` are rejected with `extensions.permission_denied`. Promoting a revoked extension requires a manual config edit (and, in a future slice, two-party approval). The lateral `revoked` → `quarantined` transition is permitted as a cleanup path.
- **Structured audit.** Every call (accepted or denied) writes a record to subsystem `extensions` with the fields `actor` / `extension_id` / `prev_tier` / `next_tier` / `decision` / `ts` / `cmd_id`. Denials use `AuditSeverity::Warn`; persistence failures use `Error`; success uses `Info`.

The pure decision logic lives in `apply_update_trust` (no I/O, no env access) so red-team and unit tests can exercise it without booting the bridge. Acceptance tests cover all four invariants (`extensions_update_trust_rejects_unknown_id_in_strict_mode`, `extensions_update_trust_rejects_unauthorized_profile`, `extensions_update_trust_emits_audit_record`, `extensions_update_trust_revoked_to_allowed_requires_approval`).

Follow-up work tracked under §6 Phase 4 (Cockpit UX): replace the env-var admin gate with proper session-bound profile-class enforcement once `extensions.update_trust` is migrated to a session-bound command, and add the two-party approval flow for `revoked` → `allowed_*` promotions.

## References

- `docs/extension-boundaries.md` — runtime boundaries this trust model layers on top of.
- `apps/local-bridge/src/extensions/handlers.rs` — runtime handlers for `extensions.list` / `extensions.update_trust`.
- `apps/local-bridge/src/extensions/admin_gate.rs` — admin-token gate for sessionless mutations.
- `docs/plans/wiring/47-extension-plugin-boundaries.md` — the parent slice.
- `docs/plans/wiring/43-security-supply-chain.md` — supply-chain hygiene that signing inherits from.
- `docs/plans/wiring/26-agent-registry-mcp.md` — first concrete consumer (MCP server registry).
- `docs/plans/wiring/13-connectors.md` — second concrete consumer (connector registry).
- ADR `docs/adr/0003-extension-trust-model.md` — the design decision record.
- [Sigstore](https://www.sigstore.dev/) — signing infrastructure reference.
- [SLSA](https://slsa.dev/) — supply-chain levels VAC maps onto.
