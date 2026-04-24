# Plan 10 — Bridge profile enforcement (Layer 1)

**Phase**: 1 · **Depends on**: Plans 03, 08, 09 · **Blocks**: Phase 1 exit · **Est**: 2 days

## Goal

Implement the bridge-side capability-profile enforcement layer per `capability-profiles.md §6`. Every crossing from WS client to engine goes through this check; every tool-call envelope emitted by engine is also verified. Defense-in-depth.

## Why this is hard

This is **the** security boundary. A bug here makes the entire assessor/executor split meaningless. Every allow/deny rule must be:
- Deterministic (same input → same decision).
- Audited (full trail).
- Testable (red-team cases verify).
- Cheap (hot path; can't slow the bridge).

Edge cases surface quickly: glob matching, regex backtracking, path canonicalization, etag drift between bridge + engine profile hash.

## Scope

### In
- Profile loader from YAML.
- Per-session pinned profile (immutable).
- Tool-allow/deny check (glob-aware).
- Shell allowlist validation.
- fs scope + deny_globs.
- git scope.
- network_egress check.
- Connector method namespace check.
- ActionSpec capability check.
- Hash handshake with engine.
- Audit emission.

### Out
- Engine-side enforcement (VAC PR #4; Plan 06).
- Per-task `scoped_paths` from handoff (Plan 32).
- Red-team case authoring (Plan 04).

## Deliverables

```
apps/local-bridge/src/profile/
├── mod.rs
├── loader.rs              # YAML → struct, merge with base
├── matcher.rs             # glob + regex helpers
├── fs_scope.rs
├── shell_allowlist.rs
├── network_egress.rs
├── action_capability.rs
├── handshake.rs           # hash pin to engine
└── enforce.rs             # unified check functions
```

## Stages

### S1 — Loader + base inheritance (0.3 day)

```rust
pub fn load_profile(id_version: &str) -> Result<CapabilityProfile> {
    let raw = fs::read_to_string(profile_path(id_version))?;
    let mut prof: CapabilityProfile = serde_yaml::from_str(&raw)?;
    if let Some(base_id) = prof.inherits_from.clone() {
        let base = load_profile(&base_id)?;
        prof.merge_from_base(&base);
    }
    prof.validate()?;
    Ok(prof)
}
```

`merge_from_base`: base provides floor (deny lists, scope); family adds connectors + hosts. **Never allow family to weaken base.** Asserted in `validate()`.

Hash: `sha256(canonical_yaml_bytes(&prof))` computed after merge. Cached per profile_id.

**Exit**: load all 15 profiles; verify hash stable across reloads.

### S2 — Glob + regex matcher (0.2 day)

`matcher.rs`:
- `matches_glob(pattern, input)` using `globset` crate for tool names + fs paths.
- `matches_regex_boxed(pattern, input)` using `regex` crate with timeout (300ms) + recursion limit to avoid ReDoS.
- Safe pattern compiler: rejects patterns with catastrophic backtracking signatures (`(.+)+` etc.).

**Exit**: unit tests with deliberate ReDoS patterns — all rejected at compile time; known-safe patterns compile.

### S3 — Tool allow/deny (0.3 day)

```rust
pub fn enforce_tool(profile: &Profile, tool: &str) -> EnforceResult {
    if profile.tool_deny.iter().any(|p| matches_glob(p, tool)) {
        return Deny::explicit_deny(tool);
    }
    if profile.tool_allow.iter().any(|p| matches_glob(p, tool)) {
        return Allow;
    }
    Deny::not_in_allowlist(tool)
}
```

Rule: **deny wins**. Not-listed → deny. Document in module-level comment.

Used at two points:
1. Incoming command `palette.invoke_action { actionId }` → resolve action → required_capabilities → each capability checked.
2. Outgoing engine event `tool.call_requested { tool }` → bridge intercepts, checks, if deny: reply `tool.denied` to engine, emit `profile.denied` event to clients.

**Exit**: red-team RT-001 passes (bridge layer).

### S4 — Shell allowlist (0.4 day)

```rust
pub fn enforce_shell(profile: &Profile, bin: &str, args: &[String], cwd: &Path, env: &HashMap<String,String>) -> EnforceResult {
    let entry = profile.shell_allowlist.iter().find(|e| e.bin == bin)
        .ok_or(Deny::bin_not_listed(bin))?;
    if args.len() > entry.max_args { return Deny::too_many_args(); }
    if let Some(pat) = &entry.args_pattern {
        let joined = args.join("\x1F");
        if !matches_regex_boxed(pat, &joined) { return Deny::args_pattern_mismatch(); }
    }
    if !cwd_within_scope(cwd, entry.cwd_scope, profile) {
        return Deny::cwd_scope();
    }
    for k in env.keys() {
        if !entry.env_allowlist.contains(k) { return Deny::env_not_allowed(k); }
    }
    Allow
}
```

Hot path: pre-compile regex at profile load; cache per `(profile_id, bin)`.

**Exit**: red-team RT-003 (bash), RT-004 (git --force), RT-011 (shell chars), RT-014 (find -exec) all pass.

### S5 — fs scope + deny_globs (0.2 day)

```rust
pub fn enforce_fs_read(profile: &Profile, path: &Path, project_root: &Path) -> EnforceResult {
    let canon = path.canonicalize()?;
    if !canon.starts_with(project_root) && profile.fs.read != FsRead::ProjectAndDocs {
        return Deny::out_of_scope();
    }
    for glob in &profile.fs.deny_globs {
        if matches_glob(glob, &canon.to_string_lossy()) {
            return Deny::denied_by_glob(glob);
        }
    }
    Allow
}
```

Canonicalize always: avoids symlink escape (RT-023).

Write variant checks `fs.write` mode + `scoped_paths` when applicable.

**Exit**: RT-018, RT-022, RT-023 pass.

### S6 — network_egress (0.2 day)

Called from connector adapters + http_get tool:
```rust
pub fn enforce_network(profile: &Profile, url: &Url, method: &Method) -> EnforceResult {
    match profile.network_egress.mode {
        Off => Deny::egress_disabled(),
        Allowlist => {
            let host = url.host_str().ok_or(Deny::invalid_url())?;
            if !profile.network_egress.host_allowlist.contains(host) {
                return Deny::host_not_allowed(host);
            }
            if !profile.network_egress.methods_allow.contains(method) {
                return Deny::method_not_allowed(method);
            }
            Allow
        }
        Unrestricted => Allow,
    }
}
```

Pre-request guard in adapter layer (Plan 24). Also checked at generic `http_get` tool dispatch.

**Exit**: RT-028, RT-029 pass.

### S7 — Engine handshake (0.3 day)

On session spawn (Plan 08):
1. Bridge computes `profile_hash`.
2. Sends first RPC: `profile.handshake { profile_id, profile_hash }`.
3. Engine computes own hash, compares.
4. Engine replies `profile.ack { matched: true }` or closes with error.
5. Bridge asserts ack received within 5s; else kills child.

Test: deliberately mismatched hash → session fails with `profile.hash_mismatch`.

**Exit**: RT-033 passes.

### S8 — Audit integration (0.2 day)

Every enforcement decision logs:
```jsonc
{
  "ts": "...", "session_id": "...", "profile_id": "...",
  "actor": "agent | client",
  "kind": "tool | shell | fs | network | action",
  "target": "edit_file | shell.bash | /etc/passwd | https://...",
  "args_digest": "sha256:...",
  "decision": "allow | deny",
  "layer": "bridge",
  "reason": "...",
  "latency_us": 42
}
```

Writer: append-only JSONL; non-blocking (tokio channel → writer task).

**Exit**: audit file populated; grep verifies expected entries.

### S9 — Performance validation (0.2 day)

Benchmark:
- Tool enforcement < 5µs p99.
- Shell enforcement < 50µs p99 (regex is hot).
- fs enforcement < 20µs p99 (path canonicalization).

If over budget: profile + optimize (e.g., precompiled patterns).

**Exit**: bench results documented.

## Testing

- Unit: per-enforcer edge cases.
- Integration: red-team RT-001 through RT-037 at bridge layer.
- Benchmark: as above.
- Property-based (`proptest`): random tool names against random profiles, never panics; deny wins always holds.

## Exit criteria

- [ ] Red-team matrix bridge-layer rows pass (RT-001 thru RT-037).
- [ ] Hash handshake working end-to-end.
- [ ] Audit log contains every enforcement decision.
- [ ] Benchmarks within budget.
- [ ] Profile edit + reload (dev mode) works without restart.

## Risks

| Risk | Mitigation |
|---|---|
| ReDoS via malicious profile or input | Safe regex compiler + timeout; fuzz test |
| Path canonicalization inconsistent across OS | Abstract behind util; test on Linux + macOS in CI |
| Profile hash drift between edit + deploy | CI check in Plan 03 enforces manifest |
| Enforcement bypass via new code path | All tool calls route through single `enforce_*` entry point; lint enforces |

## Related

- [`capability-profiles.md`](../../capability-profiles.md)
- [`red-team-test-plan.md`](../../red-team-test-plan.md)
- Plan 03 — profile YAMLs
- Plan 08 — session manager
- Plan 09 — translator (hosts enforcement)
