# Upstream VAC PRs

**Status**: v1 (required before Phase 1 kickoff)
**Scope**: Changes required in the `vastar-agentic-cli` repo to support `vac-web`. Each PR is small, additive, and does not replace existing functionality.

---

## 1. Overview

`vac-web` treats VAC as a library + CLI via a thin contract. The only changes requested in VAC are:

| # | Title | Size | Blocks phase |
|---|---|---|---|
| 1 | `vac serve --stdio --profile <id@version>` (new driver) | M | Phase 1 |
| 2 | Tool `side_effect` tagging + allowlist enforcement | M | Phase 0.5 |
| 3 | `vac schema dump --out <dir>` | S | Phase 0.5 |
| 4 | `CapabilityProfile` loader + engine policy layer | M | Phase 0.5 |
| 5 | `shell.exec_allowlisted` tool | S | Phase 0.5 |
| 6 | `evidence.capture` tool + EvidenceRef serializer | S | Phase 4 |
| 7 | `finding.emit` tool + AssessmentRun lifecycle | M | Phase 4 |
| 8 | `worktree_digest` utility + pin verification helpers | S | Phase 5 |
| 9 | `SessionSnapshot` schema additions | S | Phase 1 |
| 10 | `TeleportToken` mint/verify exposure | S | Phase 7 |

All PRs land **before** the `vac-web` phase that depends on them. See [`README.md`](./README.md) roadmap.

---

## 2. PR #1 — `vac serve --stdio`

### Summary
Add a new command that runs a VAC session over stdio using line-delimited JSON-RPC 2.0. New driver, **not** wrapping existing `runner.rs` (legacy).

### Motivation
`vac-web/apps/local-bridge` spawns one VAC process per session and communicates via stdio. This is the contract.

### Interface
```
vac serve --stdio --profile <profile_id@version> [--project <path>] [--session-id <id>]
```

- stdin: line-delimited JSON-RPC 2.0 requests (methods mirror protocol v1 command subset).
- stdout: line-delimited JSON-RPC 2.0 notifications (methods mirror protocol v1 event subset).
- stderr: structured logs (JSON); never RPC data.
- exit codes: `0` clean, `1` generic error, `2` profile invalid, `3` project not allowed, `4` engine panic.

### Methods (bidirectional)
Maps 1:1 to protocol v1 §3 where relevant. Transport omits envelope (`id`, `sessionId`) since stdio is single-session per process.

Incoming (stdin → engine):
- `message.submit`, `message.cancel_stream`, `message.retry`
- `approval.approve`, `approval.reject`
- `plan.*`, `review.*`, `runtime.*`, `shell.*`, `context.*`
- `assessment.run`, `assessment.cancel`
- `overlay.*` (for state sync only; no rendering)
- `palette.invoke_action`

Outgoing (engine → stdout) notifications:
- All events per protocol v1 §4.

### Non-requirements
- Does not handle HTTP / WS / auth. Bridge handles those.
- Does not embed markdown/syntax highlight.
- Does not manage multi-session multiplexing.

### Acceptance
- Bridge integration test passes: spawn `vac serve --stdio --profile assessor.rtd@1.0.0`, send `assessment.run`, receive stream of events.
- Exits cleanly on EOF.

---

## 3. PR #2 — Tool `side_effect` tagging

### Summary
Every registered tool in VAC declares its side effect. Engine refuses to start if any tool is missing the tag.

### Enum
```rust
pub enum SideEffect {
    Read,
    Write,
    Shell,
    Network,       // further refined by method (read/write)
    Deploy,
    Destructive,
}
```

### Migration
- Tag every existing tool.
- Tools without a tag → compile error.
- Unit test asserts every tool in registry has a tag.

### Enforcement
At tool registration (engine startup): the engine reads its `CapabilityProfile` and filters the registry. Tools outside profile's `tool_allow` (or matching `tool_deny`) are unregistered — the model cannot see or call them.

### Acceptance
- New tool without tag fails build.
- Engine with `assessor.rtd@1.0.0` profile has no write-class tools in registry (verified via `vac tool list` output).

---

## 4. PR #3 — `vac schema dump`

### Summary
Emit canonical JSON Schema for all protocol v1 semantic types. Consumed by `vac-web` for codegen.

### Interface
```
vac schema dump --out <dir>
```

Writes:
```
<dir>/
├── action_spec.schema.json
├── workbench_tab.schema.json
├── overlay_kind.schema.json          # semantic subset, not TUI internals
├── system_facet_kind.schema.json
├── notify_severity.schema.json
├── notify_lane.schema.json
├── capability_profile.schema.json
├── evidence_ref.schema.json
├── assessment_run.schema.json
├── assessment_finding.schema.json
├── assessment_verdict.schema.json
├── assessment_diff.schema.json
├── remediation_plan.schema.json
├── handoff_packet.schema.json
├── gate_status.schema.json
├── gate_policy.schema.json
├── session_snapshot.schema.json
├── transcript_event.schema.json
└── …
```

### Non-requirements
Does not emit `InputEvent`, `OutputEvent`, `CrosstermEvent`, or any TUI-specific internal types. These are intentionally excluded.

### Acceptance
- `vac schema dump --out /tmp/schemas` produces valid JSON Schema files.
- Each schema validates with `ajv`.
- `vac-web` codegen succeeds and produces matching TS types.

---

## 5. PR #4 — `CapabilityProfile` loader + engine policy layer

### Summary
Engine loads a profile YAML at startup, enforces it at tool registration and invocation.

### Behaviours
- `--profile <id@version>` CLI flag required for `vac serve`.
- Profile YAMLs shipped at `crates/vac_core/assets/profiles/*.yaml` (synced from `vac-web/packages/protocol/v1/profiles/`).
- Loader validates against `capability_profile.schema.json`.
- On load, stores profile hash. On handshake with bridge, asserts hash matches the hash bridge advertises.
- At tool invocation: re-checks `tool_allow`/`tool_deny`, fs scope, git scope, resource limits.
- Denial returns structured error to the model (so it can adapt) and logs to audit stream.

### Hash pinning
Profile hash: `sha256(canonical_yaml_bytes)`. Both sides compute; on mismatch → engine aborts with exit code 2 and error logged.

### Acceptance
- Red-team test (from `red-team-test-plan.md`) passes at engine layer even with bridge enforcement disabled.

---

## 6. PR #5 — `shell.exec_allowlisted` tool

### Summary
New tool that replaces generic `bash`/`shell` for assessor profiles. Takes structured args, validates against profile `shell_allowlist`.

### Signature
```rust
pub struct ShellExecAllowlistedArgs {
    pub bin:  String,
    pub args: Vec<String>,          // array, not string
    pub cwd:  Option<PathBuf>,      // must be within cwd_scope
    pub env:  Option<HashMap<String, String>>,  // subject to env_allowlist
    pub timeout_ms: Option<u64>,
}
pub struct ShellExecResult {
    pub exit_code: i32,
    pub stdout:    Vec<u8>,          // capped by output_cap_bytes
    pub stderr:    Vec<u8>,
    pub truncated: bool,
    pub duration_ms: u64,
}
```

### Validation
- `bin` in profile's `shell_allowlist`.
- `args.len() <= max_args`.
- `args_pattern` regex matches `args.join("\x1F")`.
- `cwd` within `cwd_scope`.
- Env keys all in `env_allowlist` (or empty if list empty).
- `timeout_ms` within profile limit.

### `side_effect`
`Shell` — which means executor profiles allow it; but assessor profiles also list it explicitly in `tool_allow` because shell reads are legitimate (ls/cat/rg/git-read).

### Acceptance
- Red-team cases #3, #4 pass (see `red-team-test-plan.md`).
- Assessor session can `rg`, `git diff`, `ls`, etc.

---

## 7. PR #6 — `evidence.capture` tool + EvidenceRef serializer

### Summary
Tool that fetches content, hashes it, attaches freshness metadata, returns an `EvidenceRef`.

### Signature
```rust
pub struct EvidenceCaptureArgs {
    pub kind:    String,    // "file" | "commit" | "pr" | "connector" | ...
    pub uri:     String,
    pub locator: Option<serde_json::Value>,
}
pub struct EvidenceCaptureResult {
    pub evidence_ref: EvidenceRef,
}
```

### Behaviour
- Resolves URI → fetches payload via appropriate adapter (fs / git / connector shim).
- Computes digest for applicable kinds.
- Assigns `observedAt = now()`, computes `freshUntil` per kind defaults.
- Persists payload to cache dir (path provided by bridge via env).
- Returns full `EvidenceRef`.

### `side_effect`
`Read` (file/commit/pr) or `Network` (connector). Network variant subject to `network_egress` profile check.

### Acceptance
- Assessor can capture evidence for RTD findings.
- Redacts secrets matching common patterns (and emits a Security critical finding instead of storing).

---

## 8. PR #7 — `finding.emit` tool + AssessmentRun lifecycle

### Summary
Tool for assessor agents to emit findings; engine manages run lifecycle + streams events.

### Behaviours
- `assessment.run` received → engine spawns swarm with specified family + depth.
- Each agent calls `finding.emit { finding }`; serializer validates evidence + identity hash.
- On all agents complete → synthesizer agent runs → emits `assessment.completed`.
- Streaming: each emit → `assessment.finding_added` event to stdout.

### Swarm execution
Family catalogs live in `crates/vac_core/assets/swarms/<family>.yaml`. Each lists agents + their prompts + per-depth activation.

### Acceptance
- Full RTD run on a real repo produces a valid `AssessmentRun` file.
- Findings have stable identity hashes across replays.

---

## 9. PR #8 — `worktree_digest` utility

### Summary
Helper used by bridge to compute the pin's worktree digest.

### Signature
```rust
pub fn compute_worktree_digest(project_root: &Path, base_sha: &str) -> Result<String>;
```

Returns `sha256(sorted_join(path + ":" + sha256(content)))` over tracked files (gitignore-respecting).

### Acceptance
- Deterministic: same input → same output.
- Fast: < 500ms for typical repos (10k files).

---

## 10. PR #9 — `SessionSnapshot` additions

### Summary
Extend `SessionSnapshot` to include fields needed by web (tab id as string instead of TUI enum, workbench state summary).

### Changes
- `workbench_tab`: `String` (semantic id) instead of TUI-specific enum. Mapping maintained in TUI.
- Add `profile_id`, `profile_hash`.
- Add `run_ids[]` (assessment runs attached to this session).
- Add `handoff_id` if session is executor.

### Acceptance
- Backward compatible: old snapshots read correctly.
- TUI continues to work with mapped string → enum.

---

## 11. PR #10 — `TeleportToken` exposure (Phase 7)

### Summary
Expose existing `TeleportToken` / `RemoteSessionConfig` primitives via public API so `vac-web` relay can mint + verify them.

### Interface
```rust
pub fn mint_teleport_token(...) -> TeleportToken;
pub fn verify_teleport_token(token: &str) -> Result<TeleportTokenClaims>;
```

Deferred until Phase 7. No action before then.

---

## 12. Coordination plan

1. Draft all PRs as WIP in parallel in VAC repo.
2. Land order: #2, #3, #4 first (foundation), then #5, #1, #9 (bridge spawn), then #6, #7 (assessment), then #8 (handoff pin), finally #10.
3. Each PR has its own CHANGELOG entry + migration notes if any.
4. `vac-web` pins a minimum VAC version per phase in its `Cargo.toml` and `packages/protocol/v1/MIN_VAC_VERSION`.

---

## 13. Related

- [`architecture.md`](./architecture.md) §2, §11 — how bridge + engine collaborate.
- [`capability-profiles.md`](./capability-profiles.md) §6 — two-layer enforcement (engine side).
- [`protocol.md`](./protocol.md) — command/event catalog the serve driver implements.
- [`assessment-contract.md`](./assessment-contract.md) §5, §8 — `finding.emit` + `evidence.capture` semantics.
- [`handoff-contract.md`](./handoff-contract.md) §3 — pin + worktree_digest.
