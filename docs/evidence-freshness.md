# Evidence Freshness

**Status**: v1 (locked for Phase 0.5)
**Scope**: `EvidenceRef` schema, freshness policies, capture pipeline, staleness handling, UI semantics.

---

## 1. Why this exists

Findings derive their credibility from evidence. Evidence from connectors (Notion, Sentry, Analytics, CI) has a shelf life — a Sentry error count observed last week may no longer apply; a Notion PRD edited yesterday invalidates a prior product review. Without freshness tracking, assessment reports become authoritative-looking but quietly wrong.

---

## 2. EvidenceRef schema

```jsonc
{
  "id":   "ev_<ulid>",
  "kind": "file | commit | pr | doc | connector | screenshot | metric | log",

  "uri":  "file:///src/a.ts | github://pr/123 | notion://page/... | https://...",
  "locator": {                                 // kind-specific pointer
    "lineRange": [10, 42],                     // file
    "cell":      "H12",                        // table
    "timestamp": "2026-04-24T...",             // log/metric
    "selector":  "h2#intro"                    // doc anchor
  },

  "connectorId":   "github:vastar/x?",         // when kind=connector
  "snapshotId":    "snap_...?",                 // cached bridge-side

  "digest":       "sha256:...?",               // content hash for immutable sources
  "sourceEtag":   "string?",                   // when server provides etag/version

  "observedAt":  "ISO8601",
  "freshUntil":  "ISO8601",
  "stalenessPolicy": "hard_expire | warn_only | immutable",

  "capturedBy":  "agent_id | bridge",
  "capturedSnapshotId": "connector_snapshot_id?",  // aggregate snapshot (for pin reuse)

  "size":        1234,                          // bytes
  "mimeType":    "text/markdown | image/png | application/json | ..."
}
```

### Required fields
- `id`, `kind`, `uri`, `observedAt`, `freshUntil`, `stalenessPolicy`, `capturedBy`.
- `digest` required for `file`, `commit`, `pr` kinds.

---

## 3. Default freshness policy per kind

| Kind | Default `freshUntil` | Default policy | Rationale |
|---|---|---|---|
| `file` | bound to `baseCommitSha` | `immutable` | File content at sha never changes |
| `commit` | forever | `immutable` | SHA-anchored |
| `pr` | forever at given snapshotId | `immutable` | Snapshot-anchored |
| `connector:github`* | `observedAt + 1h` | `warn_only` | Repos change but slowly |
| `connector:notion` | `observedAt + 24h` | `warn_only` | Docs edited occasionally |
| `connector:linear` / `jira` | `observedAt + 6h` | `warn_only` | Tickets move often |
| `connector:figma` | `observedAt + 24h` | `warn_only` | Designs iterate |
| `connector:sentry` | `observedAt + 15m` | `hard_expire` | Error state is dynamic |
| `connector:datadog` / `grafana` / metrics | `observedAt + 15m` | `hard_expire` | Live telemetry |
| `connector:posthog` / `ga4` / `mixpanel` | `observedAt + 1h` | `warn_only` | Aggregated metrics |
| `connector:ci` (Actions/GitLab/Circle) | `observedAt + 30m` | `hard_expire` | Build state changes |
| `connector:vercel` / `cloudflare` / `pagerduty` | `observedAt + 30m` | `hard_expire` | Deploy / incident state |
| `log` | `observedAt + 15m` | `hard_expire` | Log windows shift |
| `screenshot` | `observedAt + 7d` | `warn_only` | UI changes slowly |
| `doc` (external URL) | `observedAt + 7d` | `warn_only` | Treated like `notion` by default |

*github treated as hybrid: static artifacts (commit/pr by sha) are `immutable`; dynamic views (issue list, workflow state) are `warn_only` 1h.

Policies are defaults; per-check override is allowed by family:
```yaml
# in family check definition
evidence_overrides:
  - kind: connector:sentry
    fresh_for: "5m"
    policy: hard_expire
```

---

## 4. Freshness states

At any moment, an `EvidenceRef` is in one of:

| State | Condition | Effect on finding |
|---|---|---|
| `fresh` | `now ≤ freshUntil` | Full confidence |
| `aging` | `now > freshUntil - 0.2 * (freshUntil - observedAt)` | UI hint: "refresh soon" |
| `stale (warn)` | `now > freshUntil` AND policy `warn_only` | Badge shown; confidence unchanged |
| `stale (hard)` | `now > freshUntil` AND policy `hard_expire` | Confidence × 0.5; badge "⟳ stale evidence"; restrictions (§6) |
| `immutable` | policy `immutable` | Always fresh |

---

## 5. Capture pipeline

1. Agent invokes `evidence.capture { kind, uri, locator? }`.
2. Bridge:
   - Resolves URI → fetches content (via connector adapter for connector URIs; via fs for file URIs).
   - Computes `digest` when applicable.
   - Assigns `observedAt = now()`.
   - Computes `freshUntil` based on kind + family override.
   - Selects `stalenessPolicy`.
   - Persists to `~/.cache/vac-web/evidence/<digest | evId>.{payload,meta}`.
   - Returns `EvidenceRef` to agent.
3. Agent attaches ref id in subsequent `finding.emit`.

Capture is **idempotent on identical inputs** within a short window (5 min): same URI + same body digest → same `EvidenceRef`.

---

## 6. Stale-hard effects

When a finding has ≥ 1 evidence with `stalenessPolicy = hard_expire` past `freshUntil`:

- Finding shown with ⟳ badge + tooltip ("evidence stale").
- Finding `confidence *= 0.5` (one-time, idempotent on load).
- Creating a `HandoffPacket` including this finding: bridge rejects with `evidence.stale_hard_expire` unless user explicitly `assessment.replay` first.
- Gate evaluation using this finding as criterion evidence: criterion marked `stale`, listed in warnings (not blockers, unless policy `stalenessBlocksGate = true` for that criterion).

Warn-only stale: visible badge only; no confidence change, no restrictions.

---

## 7. Refresh

- `assessment.replay { runId }` → re-captures all evidence from scratch (new `observedAt`, new `freshUntil`).
- `evidence.refresh { evidenceId }` (rare; agent-driven) → re-fetches one ref.
- UI "Refresh assessment" button appears when any `hard_expire` evidence goes stale.

---

## 8. Connector snapshots

For pin stability (handoff pin, assessment replay baseline), evidence can reference an **aggregated connector snapshot**:

```jsonc
{
  "snapshotId":      "snap_<ulid>",
  "connectorId":     "github:vastar/x",
  "kind":            "github",
  "capturedAt":      "ISO8601",
  "etag":            "W/...",
  "contentIndex":    { "pr/123": "digest_a", "issues/open": "digest_b" }
}
```

Stored at `~/.cache/vac-web/connector-snapshots/<snapshotId>.json`.

Handoff pin references `connectorSnapshots[]` = snapshots that were current at assessment time. On dispatch, bridge verifies these snapshots still accessible and, for `hard_expire` kinds, still fresh.

---

## 9. Privacy & storage

- Evidence cached locally only; never uploaded off-device unless user explicitly exports.
- Screenshot evidence: sanitized of OS-level metadata before caching.
- Secrets detection: capture pipeline refuses payloads matching common secret patterns (AWS keys, GitHub tokens, OpenAI keys, etc.). Finding auto-emitted as security critical instead of evidence stored.
- Evidence payloads redacted in audit logs by default (`log_tool_args: redacted`); full replay requires explicit user action.

---

## 10. Retention

- Default: 180 days.
- Evidence referenced by active (non-terminal) handoff or pinned runs: retained beyond 180d.
- User command `evidence.cleanup { olderThan }` removes cache entries for terminal/archived runs.

---

## 11. UI semantics

### Finding card
- Evidence chips sorted by relevance (primary first).
- Fresh: neutral chip.
- Aging: subtle dot indicator (⋯).
- Stale warn: yellow outline + `⟳` icon.
- Stale hard: red outline + `⟳` icon + tooltip "evidence expired — refresh assessment".
- Immutable: no freshness badge.

### Assessment report header
- Aggregate freshness meter: % of evidence fresh vs stale.
- "Refresh" CTA when hard-stale present.

### Gate detail
- Criteria with stale evidence: yellow "stale" badge.
- Tooltip: "evidence from {connectorId} observed {observedAt}, expired {freshUntil}".

---

## 12. Failure modes

| Failure | Behaviour |
|---|---|
| Connector offline during capture | `evidence.capture` fails; agent may retry or emit finding with lower confidence marker |
| Connector offline during verification (pin) | Bridge emits `handoff.invalidated { reason: connector_unreachable }` only if kind is `hard_expire`; `warn_only` kinds skipped |
| Cached payload corrupted | Bridge returns `evidence.cache_miss`; forces re-capture |
| URI unresolvable (deleted doc, deleted PR) | Finding retained but evidence marked `missing`; badge shown; confidence × 0.3 |

---

## 13. Related

- [`assessment-contract.md`](./assessment-contract.md) §8 — Evidence pipeline integration.
- [`handoff-contract.md`](./handoff-contract.md) §3–4 — Pin + invalidation using connector snapshots.
- [`gates.md`](./gates.md) §11 — Staleness effects on gate evaluation.
- [`connectors.md`](./connectors.md) — Adapter-level snapshotting contracts.
- [`capability-profiles.md`](./capability-profiles.md) §9 — Connector read/write scoping.
