# `vac-web` docs — index

SSOT documentation for the `vac-web` delivery cockpit. Read in this order if new to the project.

## Start here

1. **[product-prd.md](./product-prd.md)** — what we're building, why, for whom.
2. **[architecture.md](./architecture.md)** — how the pieces fit together.
3. **[protocol.md](./protocol.md)** — the wire contract between web, bridge, and engine.

## Core contracts

4. **[capability-profiles.md](./capability-profiles.md)** — assessor/executor split, profile enforcement, shell allowlist.
5. **[assessment-contract.md](./assessment-contract.md)** — AssessmentRun, Finding, Verdict, Diff, Synthesizer.
6. **[handoff-contract.md](./handoff-contract.md)** — HandoffPacket, pin, invalidation, dispatch lifecycle.
7. **[gates.md](./gates.md)** — gate catalog, overrides, two-party, sign-offs.
8. **[evidence-freshness.md](./evidence-freshness.md)** — EvidenceRef schema, freshness policies, staleness effects.
9. **[connectors.md](./connectors.md)** — adapter contract + connector catalog.
10. **[agent-runtime.md](./agent-runtime.md)** — runtime/ACP bridge behavior.

## UI / UX contracts

11. **[ux-grammar.md](./ux-grammar.md)** — severity, subsystems, notify lanes, overlays, facets, palette.
12. **[frontend-rules.md](./frontend-rules.md)** — React stack, performance budgets, rendering architecture.

## Product specs

13. **[product-specs/](./product-specs/)** — Assess, Handoff, Release, Build product specs.

## Operations and verification

14. **[acp-smoke.md](./acp-smoke.md)** — ACP smoke harness.
15. **[gemini-acp-smoke.md](./gemini-acp-smoke.md)** — Gemini ACP local smoke checklist.
16. **[multi-provider-runbook.md](./multi-provider-runbook.md)** — multi-provider local runbook.
17. **[red-team-test-plan.md](./red-team-test-plan.md)** — adversarial test matrix.
18. **[perf-test-plan.md](./perf-test-plan.md)** — performance benchmarks + CI gates.

## Active implementation plans

19. **[plans/](./plans/)** — current implementation plans only. Historical phase/stage docs were removed; use `git log` for archaeology.

---

## Reading paths by role

### New engineer
1 → 2 → 3 → 4 → 10 → 11 → 12 → 19.

### Security reviewer
4 → 17 → 6 § pin/invalidation → 7 § overrides → 9 § auth/egress.

### Designer
1 → 11 → 12 → product spec for the surface being edited.

### Product
1 → 13 → 19.

### Bridge/runtime contributor
2 → 3 → 4 → 10 → 19.
