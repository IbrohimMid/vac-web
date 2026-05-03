# Documentation information architecture (slice 46)

## Goals

* Documentation is durable, role-based, searchable.
* Implementation notes are clearly separated from product / architecture
  / governance docs.
* Every doc has an owner and a last-reviewed date.

## Folder map

```
docs/
  README.md                       # entry point, links to roles below
  architecture.md                 # high-level system architecture
  capability-profiles.md          # profile policy contract
  product-prd.md                  # product brief
  ux-grammar.md                   # UX rules of engagement
  perf-test-plan.md               # perf strategy
  red-team-test-plan.md           # red-team strategy
  testing-pyramid.md              # slice 42
  observability.md                # slice 41
  security-supply-chain.md        # slice 43
  data-contract-versioning.md     # slice 44
  generated-code.md               # slice 45
  module-boundaries.md            # slice 37
  workflow-authoring.md           # slice 35
  enterprise-maturity-scorecard.md# slice 36
  adr/
    README.md
    0000-template.md
    0001-declarative-control-plane.md
  plans/
    wiring/                       # implementation slices
  product-specs/                  # product UX specs (planned)
  runbooks/                       # operational runbooks (planned)
```

## Doc roles

| Role | Reads first |
| --- | --- |
| New contributor | `README.md`, `architecture.md`, `module-boundaries.md`, `testing-pyramid.md`. |
| Bridge engineer | `architecture.md`, `module-boundaries.md`, `data-contract-versioning.md`, `observability.md`, relevant `plans/wiring/*.md`. |
| Web engineer | `architecture.md`, `ux-grammar.md`, `module-boundaries.md`, capability classifier modules, relevant `plans/wiring/*.md`. |
| Security reviewer | `security-supply-chain.md`, `capability-profiles.md`, ADRs tagged security. |
| Product / ops | `product-prd.md`, `enterprise-maturity-scorecard.md`, runbooks. |

## Doc lifecycle

* **Owner** — every doc lists an owner team in its first lines (or in
  this index).
* **Last reviewed** — add a `Last reviewed: YYYY-MM-DD` line at the top.
  Re-review on every minor release.
* **Implementation notes** belong under `docs/plans/wiring/` (sliced) or
  in PR descriptions, not in long-lived top-level docs.
* **ADRs** capture decisions; once accepted they are immutable except
  for status changes.

## Validation gates (planned)

* CI checks for broken intra-repo links.
* CI fails when `Last reviewed` is older than 6 months on any P0 doc.
* `pnpm docs:check` (planned) runs both.

## Anti-patterns to refuse

* Top-level docs that mix product, architecture, and implementation.
* Slice plans that overrun their scope and become permanent docs
  without an ADR.
* Multiple sources of truth for the same concept (commands, events,
  profiles, taxonomy).
