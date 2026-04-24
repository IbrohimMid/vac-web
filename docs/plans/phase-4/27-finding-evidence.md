# Plan 27 — Finding emit + identity hash + evidence

**Phase**: 4 · **Depends on**: Plans 24, 26, upstream PR #6 · **Blocks**: 28, 29 · **Est**: 2 days

## Goal

Implement the evidence capture pipeline + the finding emit contract on the bridge side, hooking agent-side tools (via PR #6). Every finding gets validated evidence with computed freshness; serializer rejects violations.

## Why this is hard

Evidence crosses multiple layers: the agent decides what to reference → bridge fetches + hashes + stores → finding references by id. Must be:
- Fast (agents emit many evidence per run).
- Deduped (same URI + content = same ref).
- Policy-aware (freshness + kind-specific rules).
- Secret-safe (detector intercepts).

## Scope

### In
- `evidence.capture` tool invocation from agent → bridge handler.
- Per-kind fetchers (file, commit, pr, doc, connector, screenshot, metric, log).
- Content hashing.
- Freshness timestamp + policy assignment.
- Cache (keyed by digest).
- Secret detection.
- Missing-evidence fallback.
- Finding emit serializer with validation.

### Out
- Freshness staleness effects at finding load time (Plan 28).
- Connector write capability (out of scope; write methods not called by assessors).

## Deliverables

```
apps/local-bridge/src/assessment/evidence/
├── mod.rs
├── capture.rs              # dispatch to per-kind fetcher
├── fetchers/
│   ├── file.rs
│   ├── commit.rs
│   ├── pr.rs
│   ├── doc.rs
│   ├── connector.rs
│   ├── screenshot.rs
│   ├── metric.rs
│   └── log.rs
├── cache.rs
├── freshness.rs            # policy assignment (not enforcement)
├── snapshot_link.rs        # link to connector snapshot
└── secret_guard.rs
```

## Stages

### S1 — Cache + hashing (0.2 day)

```rust
pub struct EvidenceCache {
    root: PathBuf,   // ~/.cache/vac-web/evidence/
}
impl EvidenceCache {
    pub async fn put(&self, payload: &[u8], meta: &EvidenceMeta) -> Result<CacheHandle>;
    pub async fn get_by_digest(&self, digest: &str) -> Result<Option<Vec<u8>>>;
    pub async fn exists(&self, digest: &str) -> bool;
}
```

Layout:
```
~/.cache/vac-web/evidence/
├── by-digest/
│   ├── ab/
│   │   └── abcd...json   # metadata
│   │   └── abcd...blob   # payload (binary)
└── by-evidence-id/<id> → symlink to by-digest/...
```

Sharded by first 2 hex chars to avoid fs listing blowup.

**Exit**: put + get round-trip; hash deterministic.

### S2 — Capture dispatcher (0.2 day)

```rust
pub async fn capture(
    kind: &str,
    uri: &str,
    locator: Option<&Value>,
    session_ctx: &SessionContext,
) -> Result<EvidenceRef> {
    // Enforce profile + egress before fetch.
    session_ctx.enforce_tool("evidence.capture")?;
    let payload = match kind {
        "file" => file::fetch(uri, locator, session_ctx).await?,
        "commit" => commit::fetch(uri, session_ctx).await?,
        "connector" => connector::fetch(uri, session_ctx).await?,
        // ...
    };
    secret_guard::scan_and_gate(&payload, kind, uri)?;
    let digest = sha256(&payload);
    let meta = EvidenceMeta { ... observed_at: now(), fresh_until: compute_fresh_until(kind), policy: default_policy(kind), ... };
    cache.put(&payload, &meta).await?;
    Ok(meta.into_ref())
}
```

**Exit**: capture RFC test cases (file, PR, Notion doc) succeed.

### S3 — Per-kind fetchers (0.6 day)

#### `file`
- Read from filesystem, respecting profile fs scope.
- Include file sha (for immutable pinning to `baseCommitSha`).

#### `commit`
- `git show <sha>` via git CLI or `gitoxide`.
- Already immutable.

#### `pr`
- URI: `github://pr/<repo>/<number>`.
- Uses GitHub adapter (Plan 24).
- Fetches: PR metadata, review comments, changed files.

#### `doc` (external URL)
- HTTP GET to allowlisted hosts only.
- `Accept: text/html` or similar; sanitize on render.

#### `connector`
- URI format: `<kind>://<id>/<entity_path>`.
- Routes to adapter's `read` method.

#### `screenshot`
- Client side capture; payload uploaded via separate endpoint.
- Bridge stores raw image; metadata with dimensions.
- Strips EXIF.

#### `metric` / `log`
- Connector-backed (Datadog, Grafana, Sentry).
- Payload is query result snapshot.

Per-kind fetcher unit-tested with fixtures.

**Exit**: all 8 kinds implemented with happy-path tests.

### S4 — Freshness policy assignment (0.2 day)

Per `evidence-freshness.md §3`:
```rust
pub fn default_policy(kind: &str) -> StalenessPolicy {
    match kind {
        "file" | "commit" | "pr" => StalenessPolicy::Immutable,
        "connector:github" => StalenessPolicy::WarnOnly { fresh_for: Duration::from_secs(3600) },
        "connector:sentry" | "connector:datadog" => StalenessPolicy::HardExpire { fresh_for: Duration::from_secs(900) },
        ...
    }
}
```

Family override: check family config (`assessor.rtd.yaml` might tighten Sentry to 5m for production-adjacent runs).

`fresh_until = observed_at + fresh_for`.

**Exit**: policies assigned correctly per kind + override.

### S5 — Snapshot link (0.2 day)

If connector snapshot already exists (from a prior run), and entity matches snapshot's `content_index`: reuse snapshot_id + content digest. Saves re-fetch.

Bridge API: `connector.capture_snapshot` callable before run start; manager pre-captures common entities.

Evidence references `captured_snapshot_id` if applicable, so handoff pin can verify continuity.

**Exit**: snapshot-linked evidence fresh without new fetch.

### S6 — Secret guard (0.1 day)

```rust
pub fn scan_and_gate(payload: &[u8], kind: &str, uri: &str) -> Result<()> {
    let text = std::str::from_utf8(payload).ok();
    if let Some(t) = text {
        if let Some(secret_kind) = looks_like_secret(t) {
            // Do NOT store payload.
            bridge.emit(Event::NotifyEvent {
                severity: Severity::Error,
                subsystem: format!("evidence.secret_detected"),
                message: format!("Refused to store evidence containing {secret_kind} from {uri}"),
                ...
            });
            bail!("Secret detected; evidence rejected");
        }
    }
    Ok(())
}
```

Also: emit a synthetic critical security finding — the agent can know about the secret even though we won't cache its content.

**Exit**: fixture with embedded GitHub token → refused + Security finding.

### S7 — Finding emit serializer (0.2 day)

On engine event `finding.emit { finding }`:
```rust
pub fn validate_finding(f: &AssessmentFinding, ctx: &RunContext) -> Result<()> {
    ensure!(!f.evidence.is_empty(), "evidence required");
    for ev in &f.evidence {
        ensure!(ctx.evidence_cache.exists(&ev.digest).await?, "evidence {} not found", ev.id);
    }
    if f.severity == Severity::Critical {
        ensure!(f.confidence >= 0.7, "critical requires confidence >= 0.7");
    }
    ensure!(f.title.len() <= 120, "title too long");
    ensure!(f.identity_hash == compute_identity_hash(f), "identity hash mismatch");
    Ok(())
}
```

Rejection emits error event to engine (agent can adjust); does not crash run.

**Exit**: invalid findings rejected with clear reasons.

### S8 — Missing evidence fallback (0.1 day)

If evidence URI unresolvable (deleted PR, 404 doc):
- Evidence ref marked `kind: "missing"` with original URI + `captured_at`.
- Finding retained with reduced confidence (× 0.3).
- Badge "⟳ evidence missing" in UI (Plan 29).

**Exit**: URI to non-existent resource → finding emitted with missing evidence, reduced confidence.

### S9 — Perf (0.1 day)

Benchmarks:
- File evidence capture: ≤ 5ms.
- Connector capture with cache hit: ≤ 2ms.
- Full run with 100 evidence captures: ≤ 30s (dominated by network).

**Exit**: meets budgets.

## Testing

- Per-fetcher unit tests with fixtures.
- Secret detection harness (GitHub tokens, AWS keys, etc.).
- Finding validation: positive + negative.
- Missing evidence fallback.

## Exit criteria

- [ ] `evidence.capture` tool (agent side) works end-to-end.
- [ ] All 8 kinds capturable.
- [ ] Deduplication via digest + snapshot.
- [ ] Secret detection gates payloads.
- [ ] Finding validation rejects bad shapes.

## Risks

| Risk | Mitigation |
|---|---|
| Cache fills disk | Retention policy + `evidence.cleanup` command; monitor size |
| Secret detection false positives | Allowlist exceptions documented; tunable thresholds |
| Connector capture slow on cold cache | Pre-warm common entities at run start |
| Missing evidence masks real issues | Low confidence surfaces visually (Plan 29) |

## Related

- [`evidence-freshness.md`](../../evidence-freshness.md)
- Plan 24 — connectors (read backends)
- Plan 26 — run manager (consumer)
- Plan 28 — freshness runtime enforcement
