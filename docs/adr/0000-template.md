# ADR-0000: <Short title>

- Status: proposed | accepted | superseded by ADR-NNNN | deprecated
- Date: YYYY-MM-DD
- Owners: <team(s)>
- Related slice(s): <wiring.* IDs>

## Context

What problem are we solving? What constraints / prior art apply? Reference
wiring slices, schemas, or runtime modules that motivated this decision.

## Decision

State the decision in one paragraph. Be specific. Name the layer that owns
runtime authority (Rust / TS) and the layer that carries control-plane
intent (YAML / JSON schema).

## Alternatives considered

- Option A — <why rejected>
- Option B — <why rejected>

## Consequences

- Positive: …
- Negative: …
- Migrations required: …

## Migration plan

List the concrete code/config moves, who owns each step, and the
validation gates that must remain green during the transition.

## Required scope

An ADR is required for any of the following changes:

1. New runtime subsystem in `apps/local-bridge/src/`.
2. New command family in `config/control-plane/command-manifest.yaml`.
3. Public schema change under `packages/protocol/v1/` or `schema/`.
4. Security boundary change (auth, profile policy, secrets).
5. Cross-cutting UX taxonomy change (notify class, attention level, error
   bucket).

Smaller in-place edits do not require an ADR.
