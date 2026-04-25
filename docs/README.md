# `vac-web` docs — index

SSOT documentation for the `vac-web` delivery cockpit. Read in this order if new to the project.

## Start here

1. **[product-prd.md](./product-prd.md)** — what we're building, why, for whom.
2. **[architecture.md](./architecture.md)** — how the pieces fit together.
3. **[protocol.md](./protocol.md)** — the wire contract between web, bridge, and engine.

## Core contracts (security-critical — read before coding)

4. **[capability-profiles.md](./capability-profiles.md)** — assessor/executor split, profile enforcement, shell allowlist.
5. **[assessment-contract.md](./assessment-contract.md)** — AssessmentRun, Finding, Verdict, Diff, Synthesizer.
6. **[handoff-contract.md](./handoff-contract.md)** — HandoffPacket, pin, invalidation, dispatch lifecycle.
7. **[gates.md](./gates.md)** — gate catalog, overrides, two-party, sign-offs.
8. **[evidence-freshness.md](./evidence-freshness.md)** — EvidenceRef schema, freshness policies, staleness effects.

## UI / UX contracts

9. **[ux-grammar.md](./ux-grammar.md)** — severity, subsystems, notify lanes, overlays, facets, palette.
10. **[frontend-rules.md](./frontend-rules.md)** — React stack, performance budgets, rendering architecture.

## Integration

11. **[connectors.md](./connectors.md)** — adapter contract + v1 catalog.
12. **[upstream-vac-prs.md](./upstream-vac-prs.md)** — required changes in `vastar-agentic-cli`.

## Verification

13. **[red-team-test-plan.md](./red-team-test-plan.md)** — adversarial test matrix.
14. **[perf-test-plan.md](./perf-test-plan.md)** — performance benchmarks + CI gates.

## Product specs (per-surface)

15. **[product-specs/](./product-specs/)** — Assess, Handoff, Release, Build product specs (Stage X-aware).

## Execution

16. **[roadmap.md](./roadmap.md)** — phased execution plan, milestones, dependencies.

---

## Reading paths by role

### New engineer
1 → 2 → 3 → 4 → 9 → 10 → pick a phase.

### Security reviewer
4 → 13 → 6 § pin/invalidation → 7 § overrides → 11 § auth/egress.

### Designer
1 → 9 → 10 → 5 § UI surfaces → 7 § UI surfacing.

### Product
1 → 5 overview → 6 overview → 7.

### VAC core contributor
12 → 4 § §6 two-layer enforcement → 3 § commands/events.

---

## Document lifecycle

- All docs versioned `v1` and frozen at end of Phase 5 unless explicitly revised.
- Breaking changes: new major version + migration note.
- Drift between code and docs = bug in code. File an issue.
- New docs require cross-reference updates in this README.

## Conventions

- ULIDs for all entity ids (`run_...`, `fnd_...`, `handoff_...`, etc.).
- ISO-8601 UTC for timestamps.
- snake_case for profile/gate ids; PascalCase for schema types.
- kebab-case for file names.

## Open questions (tracked across docs)

Consolidated list of unresolved items:

- [`capability-profiles.md`](./capability-profiles.md) §13 — dynamic scoped_paths, approval throttling UX, migration profile two-party, connector write exceptions, offline mode.
- [`handoff-contract.md`](./handoff-contract.md) — cross-profile chain automation UX.
- [`gates.md`](./gates.md) — per-project policy override UX.
- [`connectors.md`](./connectors.md) — `jira` adapter (v1.1).

## Related external

- Parent VAC repo: `../vastar-agentic-cli/`.
- Upstream VAC docs: `../vastar-agentic-cli/docs/`.
- Protocol schemas: `../packages/protocol/v1/`.
