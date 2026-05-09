# ADR-0002: Observability namespace prefix extension (`approval.`, `agent.`, `session.`)

- Status: accepted
- Date: 2026-05-03
- Owners: bridge, observability, protocol
- Related slice(s): wiring.observability_slos (41), wiring.audit_red_team_observability (29), wiring.approval_lifecycle (06)
- Supersedes: none

## Context

`ALLOWED_NAMESPACE_PREFIXES` di `apps/local-bridge/src/observability.rs` + `schema/observability-events.yaml` membatasi struktur fields pada structured-log entries via paved-path emitter `StructuredLogBuilder`. Daftar awal:

```
audit. persistence. workflow. shell. mcp. registry. profile. release. handoff. pairing. ws.
```

Komentar di kedua tempat menyatakan eksplisit: *"Adding to this list requires an ADR"*.

Selama Slice 41 (Pass #17 → #21), 37 emit sites di `translator/mod.rs` dimigrasi dari raw `state.audit.log(...)` ke `StructuredLogBuilder`. Banyak event domain (session create/resume, agent enforcement, dst.) bertanya dimana fields seperti `agent_id`, `mode`, `resume_mode`, `policy`, `replayed` harus diletakkan.

Solusi sementara Pass #18-#21: route fields domain `session.*` / `agent.*` ke `profile.*` namespace (mis. `profile.agent_id`, `profile.mode`, `profile.policy`). Decision didokumentasi sebagai *"profile policy decisions belong to profile authority"* di Pass #19 (lihat git log).

## Problem

Pass #21 sampai 2 site approval domain (`approval.resolved` + `approval.resolve_failed`):

- Fields: `approval_id`, `option_id`, `outcome`, `agent_id`, `agent_kind`, `toolCallId`, `kind`, `locations`, `args_hash`, `code`, `reason`.
- Forcing `profile.tool_call_id` atau `profile.outcome` rusak telemetry mental model untuk operators yang query audit logs by domain ("give me all approval lifecycle events", "correlate agent_kind across sessions").
- Fields `approval.*` secara semantik IS approval domain, bukan profile authority decision.

Sama applies untuk fields yang Pass #18-#21 paksa ke `profile.*` (e.g. `profile.replayed`, `profile.mode`) yang sebenarnya adalah session-domain bespoke fields.

## Decision

Extend `ALLOWED_NAMESPACE_PREFIXES` dengan **3 entries**:

- **`approval.`** — untuk approval lifecycle events (resolved, resolve_failed, dst.) dan their bespoke fields. Used by Slice 06 (approval-lifecycle) + future approval extension events.
- **`agent.`** — untuk agent runtime metadata (id, kind, capabilities) yang muncul as context fields di banyak event domain (approval, handoff, workflow).
- **`session.`** — untuk session-domain bespoke fields (mode, resume_mode, dst.). Pass #18-#21 telah paksa ke `profile.*`; new sites Pass #22+ boleh pakai `session.*` directly. Tidak retrofitting old sites (no behavior change for existing).

Final allowed list:

```
audit. persistence. workflow. shell. mcp. registry. profile. release. handoff. pairing. ws. approval. agent. session.
```

### Rejected alternatives

1. **Keep using `profile.*` for all foreign domains** — rejected. Causes semantic confusion in audit log queries; operators searching for `approval.outcome` won't find it under `profile.outcome`.
2. **Add only `approval.`** — rejected. Same problem repeats for `agent.*`/`session.*` future sites; pre-emptive triple-add prevents repeat-work.
3. **Block on full ADR before any extension** — rejected. Pass #22 mini-ADR formalized in this ADR + schema/code parity test (event_catalog_parity) enough for safe rollout.
4. **Allow arbitrary prefixes** — rejected. Removes the namespace gate that catches typos and unauthorized field expansion.

## Consequences

### Positive

- Slice 41 closeout achievable (39/39 translator sites covered without semantic compromise).
- Future approval/agent/session events have a natural namespace home.
- Audit log queries can filter by domain prefix cleanly.
- Schema + code kept in lockstep via `event_catalog_parity` test.

### Negative

- Past sites Pass #18-#21 yang route via `profile.*` tetap di sana (no retrofit). Heterogeneous field naming antara old + new sites untuk session-domain. Mitigation: documented in commit history; future cleanup as needed.
- Adds 3 prefixes to the validator hot-path namespace-check loop; negligible perf impact (linear scan of ~14 strings per `.namespaced()` call).

### Neutral

- Comment di `observability.rs` + schema mengarah ke ADR ini sebagai authoritative reference.
- Pass #22 mini-ADR captured in this ADR; superseding the prior interim documentation.

## Implementation

```rust
// apps/local-bridge/src/observability.rs
const ALLOWED_NAMESPACE_PREFIXES: &[&str] = &[
    "audit.", "persistence.", "workflow.", "shell.", "mcp.",
    "registry.", "profile.", "release.", "handoff.", "pairing.", "ws.",
    "approval.", "agent.", "session.",  // ADR-0002
];
```

```yaml
# schema/observability-events.yaml
allowed_namespace_prefixes:
  - audit.
  - persistence.
  - workflow.
  - shell.
  - mcp.
  - registry.
  - profile.
  - release.
  - handoff.
  - pairing.
  - ws.
  - approval.   # ADR-0002
  - agent.      # ADR-0002
  - session.    # ADR-0002
```

## Validation

- `cargo test event_catalog_parity --workspace` enforces code/schema parity.
- `cargo test -p local-bridge --lib` 351/0 with extension applied (Pass #22).
- Full workspace gates green at Pass #22 wave-end (verified by Pass #25-#27 slice audits).

## Migration / rollout

No migration needed. Old code paths route via `profile.*` continue working. New sites Pass #22+ can use the new prefixes directly. The 2 approval sites in `translator/mod.rs` (line ~3459 + ~3496) are the first consumers of `approval.*` + `agent.*`.

## References

- Slice 41 progress: `docs/plans/wiring/41-observability-slos.md`
- Schema: `schema/observability-events.yaml`
- Code: `apps/local-bridge/src/observability.rs`
