# Plan 32 — Handoff packet lifecycle + pin

**Phase**: 5 · **Depends on**: Plans 08, 26, 28, upstream PR #8 · **Blocks**: 33, 34 · **Est**: 2 days

## Goal

Implement the bridge-side `HandoffPacket` lifecycle state machine per `handoff-contract.md §5`, plus pin capture + verify (worktree digest + base SHA + connector snapshot bindings).

## Why this is hard

Pin is the central novel concept. It anchors assessment-time state so executor can't act against a different state silently. Computing worktree digest fast + deterministically on large repos is non-trivial. Invalidation detection must be precise (strict vs lenient policies) to avoid both false invalidations (annoying) and false approvals (dangerous).

## Scope

### In
- `HandoffPacket` storage.
- Pin capture: base commit, worktree digest, connector snapshot links.
- Pin verification (at approval time, at dispatch time).
- Lifecycle state machine with audit.
- Commands: `handoff.create`, `handoff.fetch`, `handoff.cancel`.

### Out
- Approval UI (Plan 33).
- Dispatch to executor (Plan 34).
- Diff-aware reassess (Plan 35).

## Deliverables

```
apps/local-bridge/src/handoff/
├── mod.rs
├── packet.rs              # entity + state machine
├── pin/
│   ├── mod.rs
│   ├── worktree_digest.rs
│   ├── verify.rs
│   └── scope.rs           # invalidation policy
├── store.rs
├── lifecycle.rs
└── audit.rs
```

## Stages

### S1 — Storage (0.2 day)

Parallel to RunStore; atomic writes.

```rust
pub struct HandoffStore {
    root: PathBuf,   // ~/.local/share/vac-web/handoffs/
}
impl HandoffStore {
    pub async fn save(&self, packet: &HandoffPacket) -> Result<()>;
    pub async fn load(&self, id: &HandoffId) -> Result<HandoffPacket>;
    pub async fn list(&self, filter: Option<HandoffFilter>) -> Result<Vec<HandoffSummary>>;
}
```

**Exit**: round-trip.

### S2 — Pin capture (0.3 day)

On `handoff.create`:
1. Resolve repo ref → base commit SHA.
2. Compute worktree digest (next stage).
3. Gather connector snapshots referenced by accepted findings (via evidence `captured_snapshot_id`).
4. Compute `expires_at` (default 7d, capped 30d).
5. Determine `invalidation_policy`:
   - If any accepted finding severity `critical` → `strict`.
   - If target profile class `release` → `strict`.
   - Else → `lenient` default (user can override to strict in UI).

**Exit**: pin populated from fixture run.

### S3 — Worktree digest (0.3 day)

Uses upstream PR #8 helper.

```rust
pub fn compute_worktree_digest(project_root: &Path, base_sha: &str) -> Result<String> {
    let mut gitignore = GitignoreBuilder::new(project_root).build()?;
    let mut entries: Vec<(String, String)> = WalkBuilder::new(project_root)
        .hidden(false).git_ignore(true).git_exclude(true).build()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map_or(false, |t| t.is_file()))
        .map(|e| {
            let rel = e.path().strip_prefix(project_root)?.to_string_lossy().to_string();
            let content = fs::read(e.path())?;
            Ok((rel, hex::encode(Sha256::digest(&content))))
        })
        .collect::<Result<Vec<_>>>()?;
    entries.sort();
    let joined = entries.into_iter().map(|(p, h)| format!("{p}:{h}")).collect::<Vec<_>>().join("\n");
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(joined.as_bytes()))))
}
```

Perf target: 500ms for 10k files.

**Exit**: deterministic across runs; untracked files excluded correctly.

### S4 — Invalidation detection (0.3 day)

`pin/verify.rs`:
```rust
pub async fn verify_pin(pin: &Pin, policy: InvalidationPolicy, touches_paths: Option<&[PathBuf]>) -> VerifyResult {
    // 1. base commit reachable?
    if !git_rev_parse(&pin.base_commit_sha).await? {
        return Invalidated { reason: "base commit not reachable" };
    }
    // 2. expiry.
    if pin.expires_at < now() {
        return Expired;
    }
    // 3. worktree drift.
    match policy {
        Strict => {
            let now_digest = compute_worktree_digest(&project_root, &pin.base_commit_sha).await?;
            if now_digest != pin.worktree_digest {
                return Invalidated { reason: "worktree drifted" };
            }
        }
        Lenient => {
            let touched = touches_paths.unwrap_or(&[]);
            for p in touched {
                if file_drifted(&project_root, p, &pin.base_commit_sha).await? {
                    return Invalidated { reason: format!("touched path drifted: {}", p.display()) };
                }
            }
        }
    }
    // 4. connector snapshots.
    for snap in &pin.connector_snapshots {
        let policy = policy_for_kind(&snap.kind);
        if policy.is_hard_expire() && is_stale(snap) {
            return Invalidated { reason: format!("connector snapshot stale: {}", snap.connector_id) };
        }
    }
    Valid
}
```

**Exit**: strict detects any file change; lenient ignores non-touched paths.

### S5 — Lifecycle state machine (0.3 day)

States per `handoff-contract.md §5`:
```rust
pub enum HandoffState {
    Draft, PendingApproval, Approved, Dispatched, Executing,
    Completed, Rejected, Cancelled, Invalidated, Expired,
}
```

Allowed transitions encoded:
```rust
pub fn allowed_transition(from: HandoffState, to: HandoffState) -> bool { ... }
```

`state_history` appended on every transition. Transition function takes reason + actor.

**Exit**: illegal transitions rejected; all valid paths tested.

### S6 — Commands (0.2 day)

`handoff.create`:
- Validate inputs (findings exist, source runs exist, profile valid, target kind supported).
- Capture pin.
- Default target = `dispatch_to_local_vac` with `executor.code@1.0.0` unless any finding category suggests release (then `executor.release@1.0.0`).
- Create packet, state = `Draft`.
- Emit `handoff.created`.

`handoff.fetch`: return packet + status.

`handoff.cancel`: transition to `Cancelled` with reason (requires ack from creator).

`handoff.reject`: explicit rejection path (approver decision); different from cancel.

**Exit**: commands round-trip.

### S7 — Auto-invalidation watchdog (0.1 day)

Background task ticking every 10min:
- For each handoff in `Approved` or `PendingApproval`: run `verify_pin`.
- On `Invalidated` or `Expired`: transition, emit event.

Also run on-demand before dispatch (Plan 34 calls).

**Exit**: synthetic drift triggers invalidation within 10min or immediately on dispatch.

### S8 — Audit (0.1 day)

Per transition: write JSONL entry per `handoff-contract.md §9`. Separate stream per handoff id.

**Exit**: full trail for test packet.

### S9 — Edge cases (0.2 day)

- Handoff from findings across multiple runs: aggregated source_run_ids.
- Finding deleted mid-flight (shouldn't happen, but defensive): invalidate handoff.
- Two-party requirement propagated: if any accepted finding critical OR target class release → `approval.two_party = true`.

**Exit**: edge cases covered.

## Testing

- Unit: state machine, pin verify.
- Integration: create + invalidate + expire flows.
- Red-team: RT-014, RT-040, RT-041, RT-044–RT-046 pass.

## Exit criteria

- [ ] Packet create + persist round-trip.
- [ ] Pin capture deterministic; verify detects drift per policy.
- [ ] Lifecycle transitions enforced + audited.
- [ ] Auto-invalidation watchdog running.
- [ ] All HandoffPacket invariants hold.

## Risks

| Risk | Mitigation |
|---|---|
| Worktree digest slow on huge repos | Benchmark + parallelize; exclude large binary dirs |
| Clock skew affects expiry | Use monotonic + wall-clock tolerance |
| Invalidation feels punitive | Clear UX message (Plan 33) + easy replay |
| Lenient mode too permissive | Default strict for critical / release |

## Related

- [`handoff-contract.md`](../../handoff-contract.md)
- Plan 34 — dispatch (consumer)
- Plan 35 — reassess diff (post-completion)
