# Architecture Decision Records (ADRs)

This directory holds ADRs for VAC Web. Each ADR captures a decision that
affects runtime boundaries, command/event taxonomy, schemas, or security
posture.

## Process

1. Copy `0000-template.md` to `NNNN-short-title.md`.
2. Increment `NNNN` to the next free number.
3. Open a PR. Get approval from at least one owner of each affected
   layer (`bridge`, `web`, `protocol`, `security`, etc.).
4. Once accepted, mark `Status: accepted` and never edit history; supersede
   with a new ADR if the decision changes.

## When to write an ADR

See `0000-template.md` § "Required scope". Smaller refactors do not need an
ADR; they should still reference the relevant wiring slice in the PR.

## Index

- [ADR-0001: Declarative control plane, runtime authority in Rust + TypeScript](0001-declarative-control-plane.md)
- [ADR-0002: Observability namespace extension](0002-observability-namespace-extension.md)
- [ADR-0003: Extension trust model — tier-based with sigstore + manifest allowlist](0003-extension-trust-model.md)
- [ADR-0004: Extension trust mutation controls — session-bound admin gate + two-party promotion approval](0004-extension-trust-mutation-controls.md)
