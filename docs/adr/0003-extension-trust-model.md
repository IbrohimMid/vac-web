# ADR 0003 — Extension trust model: tier-based with sigstore + manifest allowlist

- **Status:** Accepted
- **Date:** 2026-05-06
- **Context:** Slice 47 (extension boundaries) landed defining what extensions can do at runtime, but did not specify *how the bridge decides whether to load a given extension*. Slice 43 (security supply chain) added SBOM + cargo-deny + audit + secret scanner but stops at the signing layer for binary releases. The remaining gap: how does the bridge decide to trust a third-party MCP server, custom agent, workflow plugin, or connector?

## Decision

VAC adopts a four-tier trust model (`bundled`, `verified`, `community`, `unsigned`) anchored by:

1. **Sigstore cosign** for binary artifacts (keyless OIDC for VAC official; key-based for community).
2. **PGP detached signatures** for declarative manifests (capability profiles, connector configs, MCP server manifests).
3. **Operator allowlist** at `config/extension-trust.yaml` listing trusted publisher keys plus pinned extension manifests.
4. **Runtime gate** `profile-core::enforce_extension_trust` that runs before any extension capability is loaded.

`unsigned` extensions are refused by default. Opting in requires `allow_unsigned: true` in the allowlist, which produces a per-load audit event.

The full design lives in `docs/extension-trust-model.md`.

## Consequences

### Positive

- Aligns VAC with the SLSA / sigstore ecosystem without coupling to a hosted control plane.
- Operator has a single YAML file to revoke trust; no hot-revoke complexity.
- Trust is orthogonal to capability — a `verified` extension still goes through profile enforcement (defense in depth).
- Phase 1 (this ADR + design doc) ships zero new runtime code, so no risk to the 2026-05-06 closeout posture (29/0/0 ✓).

### Negative

- Adds operational burden: every operator who wants community extensions must manage a publisher key list.
- Restart-scoped revocation means a malicious extension keeps running until the next bridge restart. Mitigated by audit logs + the quarantine flow in Phase 4.
- Sigstore keyless signing requires CI to be the actual signer, which means VAC's release pipeline must run with workload-identity OIDC. Operationally heavier than PGP-only.

### Neutral

- Phases 2–5 are sequenced; we only commit to Phase 1 today. Each later phase will produce its own ADR if the design diverges materially.

## Alternatives considered

1. **Capability-only trust (no signatures).** Rejected: trust would degrade to "operator manually inspects every YAML before loading", which is not feasible at scale.
2. **Hosted trust service.** Rejected: violates VAC's local-first principle (`docs/plans/wiring/00-index.md`).
3. **In-process plugin loader with sandboxing.** Rejected: violates `docs/extension-boundaries.md::Anti-patterns to refuse`.
4. **Single fingerprint pin per extension (no publisher tier).** Rejected as too rigid for community extensions; would force operators to re-pin on every minor version bump.

## References

- `docs/extension-trust-model.md` — full design.
- `docs/extension-boundaries.md` — runtime boundary doc this trust model layers onto.
- `docs/plans/wiring/47-extension-plugin-boundaries.md` — parent slice.
- `docs/plans/wiring/43-security-supply-chain.md` — supply-chain hygiene.
- [Sigstore](https://www.sigstore.dev/), [SLSA](https://slsa.dev/), [in-toto](https://in-toto.io/) — referenced ecosystems.
