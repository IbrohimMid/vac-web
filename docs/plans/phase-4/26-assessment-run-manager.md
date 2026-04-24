# Plan 26 — Assessment run manager (bridge)

**Phase**: 4 · **Depends on**: Plans 03, 10, upstream PR #7 · **Blocks**: 27, 29, 31 · **Est**: 2 days

## Goal

Implement the bridge-side lifecycle of `AssessmentRun`: accept `assessment.run`, spawn assessor session with correct profile, stream findings as they emit, compute verdict via synthesizer, persist run + emit completed event.

## Why this is hard

The run manager orchestrates multi-agent swarms via the engine. Must track per-run state, coordinate cancellation, persist artifacts, and maintain evidence + finding hash indexes. Parallel to other runs (user can run RTD + PM simultaneously). Resource limits matter.

## Scope

### In
- `assessment.run` command handler.
- Per-run session spawn (dedicated assessor profile).
- Run state machine.
- Finding stream handler + identity hash dedup.
- Verdict computation hand-off to synthesizer.
- Run persistence.
- `assessment.cancel`, `assessment.replay`, `assessment.fetch_report`.
- Progress reporting.

### Out
- Actual swarm agents (Plan 31).
- Evidence capture pipeline details (Plan 27).
- Freshness policy runtime enforcement (Plan 28).

## Deliverables

```
apps/local-bridge/src/assessment/
├── mod.rs
├── run.rs                # AssessmentRun state machine
├── manager.rs            # registry + lifecycle
├── swarm.rs              # family → session spawn mapping
├── finding_stream.rs
├── dedup.rs              # identity hash index
├── verdict.rs            # synthesizer coordination
├── storage.rs            # persistence to disk
└── replay.rs
```

## Stages

### S1 — Data model & storage (0.3 day)

Reuse `protocol-rs` generated types (`AssessmentRun`, `AssessmentFinding`, `AssessmentVerdict`).

Storage layer:
```rust
pub struct RunStore {
    root: PathBuf,   // ~/.local/share/vac-web/runs/
}
impl RunStore {
    pub async fn save(&self, run: &AssessmentRun) -> Result<()>;   // atomic write via tempfile + rename
    pub async fn load(&self, id: &RunId) -> Result<AssessmentRun>;
    pub async fn list(&self, filter: Option<RunFilter>) -> Result<Vec<RunSummary>>;
    pub async fn delete(&self, id: &RunId) -> Result<()>;   // respects retention
}
```

Atomicity: partial-write safe (crash recovery OK).

**Exit**: save + load round-trip; atomic write test.

### S2 — Run manager (0.3 day)

```rust
pub struct AssessmentManager {
    runs: DashMap<RunId, Arc<RwLock<RunHandle>>>,
    store: Arc<RunStore>,
}
impl AssessmentManager {
    pub async fn start(&self, req: AssessmentRunReq, parent_session: SessionId) -> Result<RunId>;
    pub async fn cancel(&self, id: RunId) -> Result<()>;
    pub async fn replay(&self, id: RunId) -> Result<RunId>;   // new run linked via baseRunId
    pub async fn fetch_report(&self, id: RunId) -> Result<AssessmentReport>;
}
```

`RunHandle` holds state, swarm session id, progress tracker, finding index.

**Exit**: start run returns RunId; state starts `pending` then `running`.

### S3 — Swarm session spawn (0.3 day)

Family → profile mapping:
```rust
pub fn profile_for_family(family: AssessmentFamily) -> &'static str {
    match family {
        RTD => "assessor.rtd@1.0.0",
        PM => "assessor.pm@1.0.0",
        // ...
    }
}
```

Start run:
1. Resolve profile.
2. Capture pin baseline (baseCommitSha via git, worktree digest — **used for replay baseline**, not handoff pin; those share code though).
3. Capture initial connector snapshots for connectors the family needs (partial — more on capture in Plan 27).
4. Spawn new session via `SessionRegistry.create` with assessor profile.
5. Send initial message to engine: "run swarm {family} with depth {depth} on scope {...}". Engine's `finding.emit` tool + swarm catalog (upstream PR #7) does the rest.
6. Track mapping: runId → sessionId.
7. Emit `assessment.started`.

**Exit**: calling `assessment.run RTD` spawns a session; engine initializes RTD swarm.

### S4 — Finding stream + dedup (0.3 day)

On engine event `finding.emitted { finding }`:
1. Compute identity hash:
   ```rust
   fn identity_hash(f: &AssessmentFinding) -> String {
       let normalized = format!("{}|{}|{}|{}|{}",
           f.family_id, f.category, f.subsystem,
           normalize_title(&f.title),
           primary_evidence_locator(f));
       sha256(&normalized)
   }
   ```
2. Check index for existing finding with same hash in this run:
   - Exists → merge (keep stronger severity, dedupe evidence).
   - New → store.
3. Validate:
   - `evidence.length >= 1`.
   - If `severity == critical`: `confidence >= 0.7`.
4. Store + emit `assessment.finding_added`.

**Exit**: two agents emit same finding → one stored; dedup tested.

### S5 — Progress reporting (0.1 day)

Swarm catalog declares expected checks per depth. Bridge tracks:
```rust
struct Progress {
    total: u32,
    done: u32,
    current: Option<String>,   // current check name
}
```

Engine emits `finding.progress { check, done }`; bridge re-emits as `assessment.progress` to clients.

Fallback: if engine doesn't emit, bridge estimates by elapsed time.

**Exit**: progress bar moves during run.

### S6 — Synthesizer coordination (0.3 day)

Each family has synthesizer agent (e.g., `assessor.rtd.release_gate`). Engine spawns it after peer agents finish.

Synthesizer input: all findings for this run (engine pushes + bridge provides).
Synthesizer output: emits `finding.emit` (rare; for top-level synthesis entries) + final call `assessment.verdict.emit { verdict }`.

Bridge on `assessment.verdict.emit`:
1. Store verdict on run.
2. Finalize: compute counts, set `completed_at`.
3. Emit `assessment.completed { verdict, counts }`.
4. Close swarm session.

If synthesizer errors: run state → `failed` with partial findings preserved.

**Exit**: full RTD mock run → verdict emitted.

### S7 — Cancel (0.1 day)

`assessment.cancel { runId }`:
1. Send cancel signal to swarm session.
2. Wait 5s for graceful abort; else force close.
3. Mark run `cancelled`; retain partial findings.
4. Emit `assessment.completed` with `verdict: null` and reason.

**Exit**: cancel mid-run retains findings; no leaked child process.

### S8 — Replay (0.2 day)

`assessment.replay { runId }`:
1. Load base run; extract scope.
2. Start new run with same scope + new ID.
3. Link `baseRunId` in new run.
4. On completion, auto-invoke `assessment.diff { baseRunId, headRunId }` (Plan 35 computes).

**Exit**: replay creates new run; diff computed on completion.

### S9 — Multi-run concurrency (0.1 day)

Limits:
- Max concurrent assessor runs per project: default 4.
- Per-family cap: 1 (e.g., can't run two RTDs on same project simultaneously).
- Overflow → enqueue or reject with clear error.

Each run is independent session; no shared state across runs beyond store.

**Exit**: spawn 10 runs → 4 concurrent, rest queued.

### S10 — Resource budget (0.1 day)

Use `resource_limits` from assessor profile.
- Wall-clock timeout per run.
- Max tool calls per run.
On exceed: mark `failed`, emit event, close session.

**Exit**: runaway agent is killed cleanly.

## Testing

- Unit: dedup, progress accounting.
- Integration with engine stub: full run lifecycle.
- Concurrency stress.

## Exit criteria

- [ ] Run start → findings stream → verdict → completed.
- [ ] Cancel mid-run clean.
- [ ] Replay links base.
- [ ] Dedup by identity hash correct.
- [ ] Concurrency limits enforced.

## Risks

| Risk | Mitigation |
|---|---|
| Engine emits malformed finding | Serializer rejects; log + skip; don't crash |
| Synthesizer never emits verdict | Timeout; emit `assessment.failed { reason: synthesizer_timeout }` |
| Identity hash collisions | Acceptable (rare); merge semantics safe |
| Storage disk full | Check + fall back to memory-only + warn |

## Related

- [`assessment-contract.md`](../../assessment-contract.md) §2–§6
- Plan 27 — evidence capture
- Plan 28 — freshness enforcement
- Plan 29 — UI consumer
- Plan 31 — swarm agents
