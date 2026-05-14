# Security policy

vac-web is security-tooling built around an **assessor/executor split** with
capability-profile enforcement. Vulnerabilities that break that boundary are
the highest severity we care about.

## Reporting a vulnerability

**Do not open a public issue.** Please report privately via GitHub Security Advisories:

- <https://github.com/IbrohimMid/vac-web/security/advisories/new>

No separate monitored security email is published for this repository yet. If GitHub Security Advisories are unavailable to you, open a minimal public issue that asks a maintainer to enable a private disclosure path, but do **not** include vulnerability details in that issue.

Please include:

1. A minimal reproduction — ideally a `cargo test` or `pnpm test` case.
2. The affected phase/module (e.g. "Phase 7 relay auth", "profile enforcement Layer 1").
3. Impact assessment (confidentiality / integrity / availability).
4. Suggested severity (critical / high / medium / low).

We acknowledge within **72 hours**, fix + disclose within **30 days** for
critical, **90 days** for high / medium.

## Scope

**In scope** (report these):

- Profile enforcement bypass (any command reaches the engine past a deny list).
- Pairing / JWT auth bypass.
- Relay `TeleportToken` replay or binding escape.
- Assessor session performing a connector *write*.
- XSS via markdown / diff / evidence preview sanitization.
- Pin drift acceptance during handoff dispatch.
- Two-party signoff bypass (self-sign, signer impersonation).
- Audit log tampering or redaction.

**Out of scope**:

- Denial of service from a trusted client already past auth (local-trust model — bridge is on your machine).
- Issues in upstream `vastar-agentic-cli` — report to that project.
- Theoretical attacks requiring physical access to the bridge host.
- Rate-limit bypass on the development-mode `allow_anonymous` auth path
  (explicitly dev-only; production rejects it).

## Supported versions

Until a tagged `v1.0.0` ships, only `main` is supported. Post-GA we commit
to patching the latest minor release of the current major version.

## Known limitations (v1)

Documented deferrals from the Phase 7 + 8 rollback plans:

- **E2E keypair mode (Phase 7.6)** is a canary stub that rejects all frames;
  production crypto lands with a 7.6.1 hotfix. Plain mode is the default and
  is secure under the "trust your relay operator" model documented in
  `docs/architecture.md §8`. Do **not** assume end-to-end confidentiality
  against the relay until 7.6.1 ships.
- **Bridge tunnel frame routing** is an echo scaffold pending 7.3 integration
  with the session manager; use direct-WS mode for production until that
  lands.
- **Migration dispatch path** is UI-side only (Phase 8.5) until upstream VAC
  ships `executor.migration@1.0.0`; the UI's trust predicates are already
  enforced but the bridge commands are stubs.

## Disclosure philosophy

We prefer **evidence-first disclosure**: every fix ships with a red-team
test case that would have caught the bug. If you report a vulnerability, we
will (with your permission) land the red-team test alongside the patch so
the fix is verifiable in perpetuity.
