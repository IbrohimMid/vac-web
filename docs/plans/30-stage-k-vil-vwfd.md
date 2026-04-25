# Stage K — VIL / VWFD live integration (HELD)

**Status.** Held. Do not start until upstream `vil-expr` event names + schemas land in `vastar-agentic-cli`. Current Build VIL/VWFD tabs are **placeholders only** and must not be promoted to "real" before this plan unblocks.

**Goal.** Make the VIL and VWFD tabs first-class consumers of upstream semantic events: VIL artifacts, invariants, semantic-parity results, and the downstream-impact graph.

**Depends on.**

- Upstream PR(s) defining `vil-expr` event names, payload schemas, and any new bridge commands.
- [`23-build.md`](./23-build.md) Stages B3, B4, B6 (real telemetry plumbing) — VIL/VWFD reuse the same rendering scaffolding.

**Out of scope.** Inventing VIL semantics. Allowing any external agent (Claude, OpenCode) to act as the VIL semantic core. Any feature that pretends to render a downstream graph from data we don't yet have.

---

## K1 — Upstream contract review

Read the upstream PR(s) once landed; extract the event names, payload shapes, and command list. Reconcile with [`../protocol.md`](../protocol.md). File any gaps as upstream issues before writing code.

**Exit.** A short "VIL contract" section added to `protocol.md` referencing the upstream schema.

## K2 — VIL store + tab

Real Zustand store consuming the upstream events. Render: VIL artifacts, invariants, generated artifact labels, semantic parity status.

**Exit.** A live engine session populates the VIL tab from real events; the placeholder is removed.

## K3 — VWFD store + tab

Render the downstream impact graph: impacted files, generated services, contracts, propagation chain, reassess chain. Reassess chain links into Assess.

**Exit.** A change in a tracked source produces a non-empty VWFD graph on a sample repo.

## K4 — Red-team pass

Cover at minimum: invented semantic claim → reject (Build red-team B15); upstream event with unknown shape → graceful degrade; missing reassess chain → tab shows "no downstream data" rather than fabricating one.

**Exit.** Red-team cases for VIL/VWFD added to [`../red-team-test-plan.md`](../red-team-test-plan.md) and pass.

---

## Risks / open questions

- Upstream timing: this plan unblocks only when upstream is ready. No internal workaround.
- Event volume: VWFD graphs can be large on monorepos — needs a pagination / lazy-render strategy decided once we see real payloads.
- Cross-tab coupling: VIL parity status may want to feed Assess as evidence; defer that link until both stores are stable.
