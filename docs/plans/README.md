# Implementation Plans

Forward-looking execution plans, grounded in the **current shipped codebase** (commits up to `cd1ff13`) and the **product specs** in [`../product-specs/`](../product-specs/).

The earlier plan tree (Phase 0–8 + Cockpit A–J) has been retired now that those phases shipped. The historical record lives in `git log` and in [`00-shipped.md`](./00-shipped.md). New plans below describe work that has **not yet started** or is **partially blocked**.

## Reading order

1. [`00-shipped.md`](./00-shipped.md) — what's already in `main` (state of the world).
2. [`10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md) — wire ACP / multi-runtime picker into bridge + web. Design lock at [`../agent-runtime.md`](../agent-runtime.md). Companion notes: [`stage-x-claude-acp-verification.md`](./stage-x-claude-acp-verification.md) (real-binary captures + wire-method names + X.5c.1 lock), [`stage-x5a-acp-client-design.md`](./stage-x5a-acp-client-design.md) (Rust vs Node spike + decision), and [`stage-x5c2-tool-activity-observation.md`](./stage-x5c2-tool-activity-observation.md) (X.5c.2 design — observe-only).
3. Surface plans — each declares its own Stage X dependency:
   - [`20-assess.md`](./20-assess.md) — driven by [`../product-specs/assess.md`](../product-specs/assess.md); depends on X.5 + X.7.
   - [`21-handoff.md`](./21-handoff.md) — driven by [`../product-specs/handoff.md`](../product-specs/handoff.md); depends on X.5 + X.6.
   - [`22-release.md`](./22-release.md) — driven by [`../product-specs/release.md`](../product-specs/release.md); depends on Assess gate feed + Handoff dispatch foundations.
   - [`23-build.md`](./23-build.md) — driven by [`../product-specs/build.md`](../product-specs/build.md); depends on X.4 + X.5 + X.6.
4. [`30-stage-k-vil-vwfd.md`](./30-stage-k-vil-vwfd.md) — held; upstream `vil-expr` schema + events required first.

## Plan format

Each plan uses:

- **Goal** — single sentence.
- **Depends on** — other plans / upstream PRs.
- **Stages** — sequential, each with exit criterion.
- **Risk / open questions** — explicit unknowns.
- **Out of scope** — what this plan won't touch.

Plans are deliberately qualitative. Granular task lists belong in PR descriptions, not here.

## Conventions

- Stage labels are `X.1`, `X.2`, … inside a single plan; cross-plan dependencies cite the full plan id (`Stage X.4`, `Assess A2`, etc.).
- "Shipped" means merged to `main` and reflected in `00-shipped.md`.
- A plan only ships once its exit criteria are testable and audited.
