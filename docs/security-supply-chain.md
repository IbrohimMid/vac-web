# Security and supply-chain maturity (slice 43)

This doc captures the security posture beyond profile enforcement: it
covers dependencies, secrets, generated code, CI gates, and release
hygiene.

## Scope

* Local-bridge process (Rust): all crates, generated code, transitive
  dependency policy.
* Web cockpit (TypeScript): all packages, build pipeline, generated TS.
* Repo: lockfiles, CI workflows, ADR governance for security-sensitive
  decisions.

## Dependency policy

* **Rust:** `deny.toml` enforces:
  * Allowed licenses only (MIT, Apache-2.0, BSD-3-Clause; explicit
    allowlist for anything else).
  * No unmaintained or yanked crates.
  * `cargo-deny` runs in CI on every PR.
* **TypeScript:** `pnpm audit` runs in CI on every PR. New direct
  dependencies require an ADR if they introduce native code or run at
  build time with elevated privileges (e.g. postinstall).

## Secret hygiene

* No secret may be committed. CI runs a secret scanner.
* Local secrets live under `~/.config/vac/secrets.json` (or the OS
  keychain when wired). Never under `~/.config/vac/config.yaml`.
* The `auth` subsystem is the only consumer of secrets; UI code never
  touches secret material.

## Generated code

* See `docs/generated-code.md` (slice 45). Generated code is verified
  for drift on every PR.
* Generators must reject schema inputs that grant runtime power beyond
  what Rust/TS enforces (slice 31 acceptance #3).

## CI gates (security-relevant)

* `cargo deny check` (advisories, licenses, sources, bans).
* `cargo audit` (RUSTSEC).
* `pnpm audit --prod` (npm advisories on prod deps).
* Secret scan (planned: `gitleaks` or equivalent).
* SBOM generation per release (planned, slice 43 step_04).
* Drift check on generated code (`scripts/verify-codegen.sh`).

## Release hygiene

* Tagged releases include:
  * Signed git tag (where keys exist).
  * SBOM (planned).
  * Hash list of binaries.
* Release notes link to ADRs that landed in the release.

## Threat model summary

* **Untrusted UI input** — the UI is treated as untrusted by the bridge.
  All commands flow through `profile_layer` and are checked against the
  generated catalog.
* **Untrusted MCP/registry config** — schemas validate config; profile
  policy gates which tools each agent can call.
* **Untrusted persisted data** — persistence reader applies redaction
  before replay; readers must not crash on malformed input.
* **Local filesystem access** — every fs path goes through profile
  policy with project-root scoping (slice 16).

## Validation gates

```
cargo deny check
cargo audit
pnpm audit --prod
bash scripts/verify-codegen.sh
```

These must remain green on every PR.

## Open follow-ups

1. Add `cargo deny check` to the GitHub Actions workflow (if missing).
2. Add SBOM generation step to release pipeline.
3. Add a secret scanner pre-commit hook.
4. Document the keychain integration when it lands.
