# Implementation Plans

Per-epic execution plans derived from [`docs/roadmap.md`](../roadmap.md) and the blueprint docs. Each plan is:

- **Staged**: sequential stages, each with discrete tasks.
- **Qualitative**: explains *why* and *what the hard parts are*, not just *what to type*.
- **Self-contained**: prerequisites, deliverables, tests, exit criteria, risks.

## Conventions

- Plan filename: `NN-slug.md`. Numeric prefix = global ordering.
- Each plan starts with YAML-like header: Goal / Phase / Depends on / Blocks / Est.
- Stages labelled S1, S2, … Each stage has a checklist + exit criterion.
- Exit criterion is a testable statement, not "it works."

## Index

### Sub-phase overviews (iteration view)

Each sub-phase has a `README.md` documenting goal, status, day-by-day stages, and exit criteria.

**Phase 0 — Foundations**
- [**0.1** — Repo Bootstrap](./phase-0.1/README.md) ✅ done
- [**0.2** — Schema Canonical](./phase-0.2/README.md) ✅ done
- [**0.3** — Profile Catalog](./phase-0.3/README.md) ✅ done
- [**0.4** — Codegen Pipeline](./phase-0.4/README.md) ✅ done
- [**0.5** — Red-Team + Upstream VAC PRs](./phase-0.5/README.md) 🟡 profile-layer done
- [**0.6** — Integration Readiness](./phase-0.6/README.md) ✅ done

**Phase 1 — Bridge + Web MVP**
- [**1.1** — Bridge WebSocket Transport](./phase-1.1/README.md) ✅ done
- [**1.2** — Session Manager + Child Spawn](./phase-1.2/README.md) ✅ done
- [**1.3** — Translator + Profile Enforcement (Layer 1)](./phase-1.3/README.md) ✅ done
- [**1.4** — Pairing + JWT + Audit Integration](./phase-1.4/README.md) ✅ done
- [**1.5** — Web Scaffold + WebSocket Transport](./phase-1.5/README.md) ✅ done
- [**1.6** — Minimal Transcript + Composer](./phase-1.6/README.md) ✅ done
- [**1.7** — End-to-End Integration + Red-Team Expansion](./phase-1.7/README.md) ✅ done (bridge-layer red-team); Playwright E2E deferred

**Phase 2 — Build Cockpit Core** (see [overview](./phase-2/README.md))
- [**2.1** — Transcript Architecture (hot/cold + markdown)](./phase-2.1/README.md) ✅ done
- [**2.2** — Syntax Highlight (Shiki worker)](./phase-2.2/README.md) ✅ done
- [**2.3** — Command Palette + ActionSpec](./phase-2.3/README.md) ✅ done
- [**2.4** — Topbar + Notify Lanes + Activity Rail](./phase-2.4/README.md) ✅ done
- [**2.5** — Overlay Manager](./phase-2.5/README.md) ✅ done
- [**2.6** — Phase 2 Exit: Perf + Red-Team](./phase-2.6/README.md) ✅ done (vitest UI red-team; Playwright perf deferred)

The sub-phase READMEs are **iteration views** — what to work on in each ~1–2 day burst. The numbered plan files (01, 02, …) below are **granular task specs** referenced by the sub-phase READMEs.

### Phase 0.5 — Granular plan docs (task view)
- [01 — JSON Schema canonical authoring](./phase-0.5/01-json-schema-canonical.md)
- [02 — Codegen pipeline (TS + Rust)](./phase-0.5/02-codegen-pipeline.md)
- [03 — Profile YAML catalog](./phase-0.5/03-profile-yaml-catalog.md)
- [04 — Red-team harness skeleton](./phase-0.5/04-red-team-harness.md)
- [05 — Repo scaffold](./phase-0.5/05-repo-scaffold.md)
- [06 — Upstream VAC PRs coordination](./phase-0.5/06-upstream-vac-prs.md)

### Phase 1 — Bridge + `vac serve` + web MVP
- [07 — Bridge axum server + WebSocket](./phase-1/07-bridge-axum-ws.md)
- [08 — Bridge session manager + child spawn](./phase-1/08-bridge-session-manager.md)
- [09 — Bridge translator (protocol ↔ JSON-RPC)](./phase-1/09-bridge-translator.md)
- [10 — Bridge profile enforcement (Layer 1)](./phase-1/10-bridge-profile-enforcement.md)
- [11 — Bridge pairing + JWT + audit log](./phase-1/11-bridge-pairing-audit.md)
- [12 — Web scaffold + WS transport + RAF drain](./phase-1/12-web-scaffold-transport.md)
- [13 — Web minimal transcript + composer](./phase-1/13-web-transcript-composer-mvp.md)

### Phase 2 — Build cockpit core
- [14 — Transcript hot window + cold freeze](./phase-2/14-transcript-hot-cold.md)
- [15 — Markdown streaming strategy + worker](./phase-2/15-markdown-streaming.md)
- [16 — Shiki worker + lazy highlight](./phase-2/16-shiki-worker.md)
- [17 — Command palette + ActionSpec](./phase-2/17-command-palette.md)
- [18 — Topbar system pulse + notify lanes](./phase-2/18-topbar-notify.md)
- [19 — Overlay manager](./phase-2/19-overlay-manager.md)

### Phase 3 — Execution surfaces
- [20 — Approvals tab](./phase-3/20-approvals-tab.md)
- [21 — Review tab + diff worker](./phase-3/21-review-diff.md)
- [22 — Sessions + Runtime tabs](./phase-3/22-sessions-runtime.md)
- [23 — Shell drawer (xterm.js)](./phase-3/23-shell-drawer.md)
- [24 — Connector manager + OAuth](./phase-3/24-connector-manager.md)
- [25 — Mention search + context attach](./phase-3/25-mention-search.md)

### Phase 4 — Assessment MVP (RTD + PM)
- [26 — Assessment run manager (bridge)](./phase-4/26-assessment-run-manager.md)
- [27 — Finding emit + identity hash + evidence](./phase-4/27-finding-evidence.md)
- [28 — Freshness policy enforcement](./phase-4/28-freshness-enforcement.md)
- [29 — Readiness Hub + AssessmentReport UI](./phase-4/29-readiness-hub-ui.md)
- [30 — Gate evaluation + ribbon + override](./phase-4/30-gate-system.md)
- [31 — RTD + PM swarms](./phase-4/31-rtd-pm-swarms.md)

### Phase 5 — Handoff + Reassess loop
- [32 — Handoff packet lifecycle + pin](./phase-5/32-handoff-lifecycle-pin.md)
- [33 — Handoff builder UI + two-party approval](./phase-5/33-handoff-builder-ui.md)
- [34 — Handoff dispatch + executor binding](./phase-5/34-handoff-dispatch.md)
- [35 — AssessmentDiff + convergence guard](./phase-5/35-assessment-diff.md)

### Phase 6–8 — Expansion
- [36 — Remaining assessor families playbook](./phase-6-8/36-assessor-families-playbook.md)
- [37 — Release plane](./phase-6-8/37-release-plane.md)
- [38 — Hosted dispatch + relay](./phase-6-8/38-hosted-dispatch.md)
- [39 — Continuous readiness + migration profile](./phase-6-8/39-continuous-readiness.md)

## How to use a plan

1. Read its header: confirm prereqs done.
2. Follow stages in order; don't skip.
3. At each stage's exit criterion, write a small proof (test passing, PR merged, demo GIF).
4. Mark complete in a project tracker (GitHub issue / Linear ticket).
5. If a stage blows up, edit the plan: plans are living docs, not immutable specs.
