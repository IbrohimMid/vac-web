# Capability Profiles — SSOT

**Status**: Draft v1 (locked after review)
**Owners**: vac-web architecture, VAC engine security
**Scope**: Defines the two-class worker model (assessor / executor), the capability profile schema, default profiles, tool taxonomy, and the enforcement contract between `local-bridge` and the VAC engine.

This document is the **single source of truth**. Any conflict between code and this document is a bug in code. Changes here require a PR with red-team test updates.

---

## 1. Why this exists

`vac-web` hosts multiple agent families:

- **Assessors** (RTD, Product Review, UX Review, Security Review, etc.) analyse codebase + connector context and produce findings. They must never mutate anything.
- **Executors** (code editing, release, migration) mutate repo / infra / data after explicit user approval via a `HandoffPacket`.

Without a formal capability boundary, a prompt-injected assessor agent could call `edit_file` or `bash` with a destructive payload. We prevent that **structurally**, not via prompting or agent discipline.

**Core invariant**: *An agent can only invoke tools that its pinned profile explicitly allows. Enforcement is verified at two independent layers. A profile is pinned at session creation and immutable for the lifetime of that session.*

---

## 2. Worker classes

| Class | Purpose | Can mutate? | Entry point |
|---|---|---|---|
| `assessor` | Read-only analysis + finding generation + plan authoring | No | Direct from UI via `assessment.run` |
| `executor` | Mutating work scoped to an approved `HandoffPacket` | Yes (scoped) | Only via `handoff.dispatch_*` |

A user **cannot** start an executor session without going through an approved handoff. The bridge rejects `session.create` with `class=executor` unless the request carries a valid `handoff_id` in `approved` state.

---

## 3. `CapabilityProfile` schema

Canonical definition (Rust serde; TS types generated). Lives in `packages/protocol/v1/capability_profile.schema.json`.

```jsonc
{
  "$id": "https://vac-web/schema/v1/CapabilityProfile.json",
  "type": "object",
  "required": ["id", "class", "version", "tool_allow", "tool_deny",
               "shell_allowlist", "fs", "git", "connectors",
               "network_egress", "approval_required_for"],
  "properties": {
    "id":      { "type": "string", "pattern": "^(assessor|executor)\\.[a-z0-9_]+(\\.[a-z0-9_]+)*$" },
    "class":   { "enum": ["assessor", "executor"] },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "description": { "type": "string" },

    "tool_allow": { "type": "array", "items": { "type": "string" } },
    "tool_deny":  { "type": "array", "items": { "type": "string" } },

    "shell_allowlist": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["bin"],
        "properties": {
          "bin":           { "type": "string" },
          "args_pattern":  { "type": "string", "description": "Regex applied to the full args array joined by \\x1F" },
          "max_args":      { "type": "integer", "minimum": 0, "default": 32 },
          "cwd_scope":     { "enum": ["project_root", "project_root_subtree", "tempdir"], "default": "project_root_subtree" },
          "timeout_ms":    { "type": "integer", "minimum": 100, "maximum": 120000, "default": 15000 },
          "env_allowlist": { "type": "array", "items": { "type": "string" }, "default": [] },
          "output_cap_bytes": { "type": "integer", "default": 2097152 }
        }
      }
    },

    "fs": {
      "type": "object",
      "properties": {
        "read":  { "enum": ["none", "project_root", "project_and_docs"], "default": "project_root" },
        "write": { "enum": ["none", "project_root", "scoped_paths"], "default": "none" },
        "scoped_paths": { "type": "array", "items": { "type": "string" } },
        "deny_globs":   { "type": "array", "items": { "type": "string" },
                          "default": [".env*", "**/*.key", "**/*.pem", "**/secrets/**", "**/.git/config"] },
        "max_bytes_per_read":  { "type": "integer", "default": 10485760 },
        "max_bytes_per_write": { "type": "integer", "default": 5242880 }
      }
    },

    "git": {
      "type": "object",
      "properties": {
        "read":   { "type": "boolean", "default": true },
        "branch": { "type": "boolean", "default": false },
        "commit": { "type": "boolean", "default": false },
        "tag":    { "type": "boolean", "default": false },
        "push":   { "type": "boolean", "default": false },
        "push_remotes_allow": { "type": "array", "items": { "type": "string" }, "default": [] },
        "protected_refs":     { "type": "array", "items": { "type": "string" },
                                "default": ["main", "master", "release/*", "prod"] }
      }
    },

    "connectors": {
      "type": "object",
      "properties": {
        "read":  { "type": "array", "items": { "type": "string" } },
        "write": { "type": "array", "items": { "type": "string" }, "default": [] }
      }
    },

    "network_egress": {
      "type": "object",
      "properties": {
        "mode": { "enum": ["off", "allowlist", "unrestricted"], "default": "allowlist" },
        "host_allowlist": { "type": "array", "items": { "type": "string" } },
        "methods_allow":  { "type": "array", "items": { "enum": ["GET","HEAD","OPTIONS","POST","PUT","PATCH","DELETE"] },
                            "default": ["GET","HEAD","OPTIONS"] }
      }
    },

    "approval_required_for": { "type": "array", "items": { "type": "string" } },

    "resource_limits": {
      "type": "object",
      "properties": {
        "max_session_wallclock_ms": { "type": "integer", "default": 3600000 },
        "max_tool_calls":           { "type": "integer", "default": 2000 },
        "max_concurrent_children":  { "type": "integer", "default": 4 }
      }
    },

    "audit": {
      "type": "object",
      "properties": {
        "log_every_tool_call":  { "type": "boolean", "default": true },
        "log_tool_args":        { "enum": ["full", "redacted", "none"], "default": "redacted" },
        "retain_for_days":      { "type": "integer", "default": 90 }
      }
    }
  }
}
```

### Interpretation rules

- `tool_allow` and `tool_deny` both accept glob patterns (`connector.read.*`, `edit_*`). **Deny wins** on conflict.
- If a tool is not listed in either, it is **denied by default**. No implicit allow.
- `shell_allowlist` is a *whitelist of callable binaries with pattern-constrained args*. Any shell invocation outside this list is denied regardless of `tool_allow`.
- `fs.write = "none"` implies `git.commit = false` and all write-class tools denied even if wildcards in `tool_allow` would match.
- `connectors.write` non-empty requires corresponding `connector.write.<id>` in `tool_allow`; missing either side is a schema error.

---

## 4. Default profiles (v1)

All default profiles are checked in at `packages/protocol/v1/profiles/` and loaded by the bridge at startup. Profiles are versioned; profile upgrades are explicit (`profile_id@version`).

### 4.1 Assessor profiles

#### `assessor.base@1.0.0` (inherited by all assessor families)

```yaml
class: assessor
tool_allow:
  - read_file
  - list_directory
  - glob
  - grep
  - git_log
  - git_show
  - git_blame
  - git_diff
  - git_ls_files
  - git_rev_parse
  - shell.exec_allowlisted
  - http_get
  - connector.read.*
  - evidence.capture
  - finding.emit
  - report.compose
tool_deny:
  - edit_file
  - write_file
  - delete_file
  - move_file
  - bash
  - shell              # generic shell handle; only exec_allowlisted permitted
  - git_commit
  - git_push
  - git_tag
  - git_branch_create
  - deploy.*
  - publish.*
  - db.*
  - connector.write.*
  - network.post       # unless explicitly in descendant
shell_allowlist:
  - { bin: ls,    args_pattern: "^(-[AalhF1R]+\\x1F)*([^;&|`$><\\n]*\\x1F?)*$" }
  - { bin: cat,   max_args: 8 }
  - { bin: head,  max_args: 6 }
  - { bin: tail,  max_args: 6 }
  - { bin: wc,    max_args: 6 }
  - { bin: stat,  max_args: 6 }
  - { bin: file,  max_args: 6 }
  - { bin: rg,    args_pattern: "^(--?[a-zA-Z0-9-]+\\x1F)*([^;&|`$><\\n]*\\x1F?)*$", max_args: 20 }
  - { bin: find,  args_pattern: "^[^;&|`$><\\n]*$", max_args: 20 }
  - { bin: git,
      args_pattern: "^(status|diff|log|show|blame|ls-files|rev-parse|config --get|remote -v|branch --list|tag --list)(\\x1F|$).*" }
fs:
  read: project_and_docs
  write: none
  deny_globs:
    - .env*
    - "**/*.key"
    - "**/*.pem"
    - "**/*.p12"
    - "**/secrets/**"
    - "**/.git/config"
    - "**/.aws/**"
    - "**/.ssh/**"
    - "**/id_rsa*"
git:
  read: true
  branch: false
  commit: false
  tag: false
  push: false
connectors:
  read: []      # overridden by family
  write: []
network_egress:
  mode: allowlist
  host_allowlist: []   # overridden by family with connector endpoints only
  methods_allow: [GET, HEAD, OPTIONS]
approval_required_for: []
resource_limits:
  max_session_wallclock_ms: 1800000   # 30 min
  max_tool_calls: 1500
  max_concurrent_children: 4
audit:
  log_every_tool_call: true
  log_tool_args: redacted
```

#### Family extensions

Each family inherits `assessor.base` and only adds connector + host allowlist:

| Profile id | Connectors (read) | Host allowlist additions |
|---|---|---|
| `assessor.rtd@1.0.0` | `github`, `sentry`, `datadog`, `cloudflare`, `vercel`, `ci` | provider API hosts |
| `assessor.pm@1.0.0` | `github`, `notion`, `linear`, `figma` | provider API hosts |
| `assessor.ux@1.0.0` | `github`, `figma`, `notion`, `posthog` | provider API hosts |
| `assessor.frontend@1.0.0` | `github` | — |
| `assessor.security@1.0.0` | `github`, `dependabot`, `snyk`, `sentry` | provider API hosts |
| `assessor.reliability@1.0.0` | `github`, `sentry`, `datadog`, `grafana`, `pagerduty` | provider API hosts |
| `assessor.perf@1.0.0` | `github`, `lighthouse_ci`, `datadog`, `posthog` | provider API hosts |
| `assessor.release@1.0.0` | `github`, `ci`, `vercel`, `cloudflare` | provider API hosts |
| `assessor.launch@1.0.0` | `github`, `notion`, `posthog`, `ga4` | provider API hosts |
| `assessor.qa@1.0.0` | `github`, `ci` | provider API hosts |
| `assessor.docs@1.0.0` | `github`, `notion` | provider API hosts |
| `assessor.growth@1.0.0` | `github`, `posthog`, `ga4`, `mixpanel` | provider API hosts |

**All family profiles inherit the full deny list and shell allowlist of `assessor.base`. No family may re-allow a denied tool.**

### 4.2 Executor profiles

#### `executor.code@1.0.0`

```yaml
class: executor
tool_allow:
  - read_file
  - list_directory
  - glob
  - grep
  - edit_file
  - write_file
  - delete_file
  - move_file
  - shell.exec
  - shell.exec_allowlisted
  - git_*                    # read + branch + commit (local)
  - package_manager.*        # npm/pnpm/yarn/cargo install, run scripts
  - test.run
  - lint.run
  - build.run
  - format.run
  - connector.read.*         # may read context; writes limited
tool_deny:
  - git_push                 # no remote push from code profile; release profile handles that
  - git_tag
  - deploy.*
  - publish.*
  - db.migrate.*
  - connector.write.*        # except in explicit handoff task scope (future extension)
shell_allowlist: []          # generic shell.exec permitted (see resource limits)
fs:
  read: project_root
  write: project_root
  deny_globs:
    - ".env*"                # still denied; requires explicit handoff override
    - "**/secrets/**"
    - "**/.git/config"
git:
  read: true
  branch: true
  commit: true
  tag: false
  push: false
  protected_refs: [main, master, release/*, prod]
connectors:
  read: [github, notion, linear, figma]
  write: []
network_egress:
  mode: allowlist
  host_allowlist:
    - "registry.npmjs.org"
    - "pypi.org"
    - "crates.io"
    - "proxy.golang.org"
    - "github.com"
    - "api.github.com"
  methods_allow: [GET, HEAD, POST]
approval_required_for:
  - "git.branch.create_from_protected"
  - "delete_file"
  - "move_file"
  - "shell.exec"             # every generic shell needs per-call approval unless in allowlist
resource_limits:
  max_session_wallclock_ms: 7200000   # 2h
  max_tool_calls: 5000
  max_concurrent_children: 8
audit:
  log_every_tool_call: true
  log_tool_args: full
```

#### `executor.release@1.0.0`

```yaml
class: executor
tool_allow:
  - read_file
  - git_read
  - git_tag
  - git_push
  - deploy.*
  - publish.*
  - runbook.write
  - release_notes.write
  - connector.write.github       # PRs, releases
  - connector.write.notion       # release notes page
  - connector.read.*
tool_deny:
  - edit_file                    # code edits are code-profile only
  - write_file
  - shell.exec                   # allowlist only
  - db.*
fs:
  read: project_root
  write: scoped_paths
  scoped_paths:
    - "CHANGELOG.md"
    - "RELEASES.md"
    - "docs/runbooks/**"
    - ".github/releases/**"
git:
  read: true
  branch: false
  commit: true            # release-notes commits only via scoped_paths
  tag: true
  push: true
  push_remotes_allow: ["origin"]
  protected_refs: []      # push allowed to release refs; approval-gated
connectors:
  read: [github, ci, vercel, cloudflare, notion]
  write: [github, notion]
network_egress:
  mode: allowlist
  host_allowlist:
    - "api.github.com"
    - "api.vercel.com"
    - "api.cloudflare.com"
    - "api.notion.com"
  methods_allow: [GET, HEAD, POST, PATCH]
approval_required_for:
  - "git.push"
  - "git.tag"
  - "deploy.*"
  - "publish.*"
  - "connector.write.*"
resource_limits:
  max_session_wallclock_ms: 3600000
  max_tool_calls: 1000
  max_concurrent_children: 2
audit:
  log_every_tool_call: true
  log_tool_args: full
```

#### `executor.migration@1.0.0` (Phase 6+)

Deferred to Phase 6. Will scope `db.migrate.*`, `data.backfill.*`, with mandatory two-party approval and reversible-plan requirement.

---

## 5. Tool taxonomy & side-effect tagging

Every tool registered in the VAC engine MUST declare a `side_effect` tag. Treat this as a current bridge/runtime contract, not a historical upstream-PR dependency; new UI command wiring must preserve the same policy boundary described in [`plans/backend-ui-wiring.md`](./plans/backend-ui-wiring.md).

```rust
pub enum SideEffect {
    Read,       // no state change anywhere
    Write,      // filesystem / repo / db mutation
    Shell,      // arbitrary process execution
    Network,    // outbound network (GET/HEAD = Read-Network, POST+ = Write-Network)
    Deploy,     // publishes to production-adjacent surface
    Destructive // irreversible (delete, drop, purge, force-push)
}
```

Mapping rules:

- `Read` → permitted in assessor by default when named in `tool_allow`.
- `Write`, `Shell`, `Deploy`, `Destructive` → **always** require executor class. Assessor bridge router rejects before reaching engine.
- `Network` with method ∈ {GET, HEAD, OPTIONS} counts as Read-Network; anything else counts as Write-Network and requires explicit allowlisting.

Tools without a `side_effect` tag are rejected at engine startup. No legacy exceptions.

---

## 6. Enforcement — two independent layers

Both layers MUST deny. Either layer's failure to deny is a security bug.

### Layer 1 — Bridge router (`apps/local-bridge/src/profile.rs`)

Before forwarding any command or tool invocation to the VAC engine session:

1. Resolve the session's pinned `profile_id@version`.
2. If the command is `palette.invoke_action`, resolve `actionId` → required capability set (from `ActionSpec.capabilities` at codegen time). Reject if any required capability is not in the profile.
3. For tool-call envelopes originating from the engine back to the UI for approval: verify the tool name matches `tool_allow` (glob-expanded) and does not match `tool_deny`. Reject with `profile.denied { tool, reason, required, profile_id }`.
4. For `shell.exec_allowlisted`: parse `{ bin, args[] }`. Look up `bin` in `shell_allowlist`. Validate `args[]` length ≤ `max_args`. Join with `\x1F` and test against `args_pattern`. Reject on any mismatch.
5. For network egress: check host + method against `network_egress`.
6. Log every allow / deny decision to the session's audit stream.

The bridge **never** trusts the engine to self-police; it verifies every crossing.

### Layer 2 — VAC engine policy (`vac_core::policy`)

VAC engine is started with `--profile <id@version>`. The engine:

1. Loads the same profile document (from `packages/protocol/v1/profiles/` shipped with `vac-web`; hash-pinned).
2. Asserts profile hash matches what bridge advertised at session init (handshake). Mismatch → engine aborts.
3. At tool registration time: each registered tool's `side_effect` tag is checked against profile. Tools outside the allow set are **unregistered** for this session — they cannot even be offered to the model.
4. At tool invocation: re-checks `tool_allow`/`tool_deny`, fs scope, git scope, and resource limits. Denied invocations return a structured error to the model so it can adapt.

**Why two layers**: bridge protects against a malicious engine; engine protects against a malicious bridge or agent bypass. Defense in depth.

---

## 7. Profile lifecycle

- **Pinned at `session.create`**: request MUST carry `profile_id@version`. Bridge validates; unknown profile → reject.
- **Immutable at runtime**: no command can change the profile mid-session. To change profile, close session and open a new one.
- **Executor sessions require handoff**: bridge rejects `session.create { class: executor }` unless `approved_handoff_id` is present, the handoff is in `approved` state, the handoff's `target.executor_profile_id` matches the requested profile, and the handoff's `pin` is still valid (not expired, base commit reachable, worktree digest matches per invalidation policy).
- **Profile version bump**: new version = new id suffix (`@1.1.0`). Old profiles remain valid for in-flight sessions; new sessions default to latest.

---

## 8. Escalation path (assessor → executor)

This is the **only** supported path for an assessor's findings to cause mutation:

```
1. assessor session produces findings + synthesizer verdict
2. user selects findings → handoff.create  (creates HandoffPacket draft)
3. handoff.approve   (user or authorised role, see gates governance)
4. handoff.dispatch_local or handoff.dispatch_web_cli
5. bridge validates: pin intact, profile available, approval fresh
6. bridge spawns new session with class=executor, profile=<target>,
   initial context = handoff packet
7. executor runs; every mutation still goes through per-tool approval
8. on completion → assessment.replay (reassess) → verdict diff
```

At no point does the assessor session itself gain mutate capability. Findings cross the boundary **as data**, not as permission.

---

## 9. Connector capability scoping

Every connector adapter in `apps/local-bridge/src/connectors/` MUST expose two namespaces:

- `connector.read.<id>.*` — methods that perform only GET-equivalent operations.
- `connector.write.<id>.*` — methods that create / update / delete remote state.

Assessor profiles may only include `connector.read.*` entries. Attempting to include `connector.write.*` in an assessor profile is a schema validation error at profile load time.

Connector OAuth scopes obtained during `connector.connect` MUST match the **maximum** capability needed across all profiles; runtime enforcement then narrows per profile. E.g., GitHub token may be granted `repo` scope, but assessor sessions never exercise write endpoints.

---

## 10. Audit log

Every tool-call decision (allow, deny, approval-required) produces an entry:

```jsonc
{
  "ts": "2026-04-24T15:22:10.123Z",
  "session_id": "sess_...",
  "profile_id": "assessor.rtd@1.0.0",
  "actor": "agent:security_checker",
  "tool": "shell.exec_allowlisted",
  "args_digest": "sha256:...",        // full args redacted unless log_tool_args=full
  "decision": "allow|deny|approval_required",
  "layer": "bridge|engine",
  "reason": "...",                     // required on deny
  "latency_us": 142
}
```

- Append-only local file under `~/.config/vac-web/audit/<session_id>.jsonl`.
- Rotated per session; retained per `audit.retain_for_days`.
- Never shipped off-device without explicit user export.
- UI surfaces audit via `Sessions → <session> → Audit log`.

---

## 11. Red-team test matrix (MUST pass in CI, Phase 0.5 gate)

For every assessor profile and every executor profile, the following attacks MUST be rejected. Failures block merge.

| # | Attack | Expected result |
|---|---|---|
| 1 | Assessor agent calls `edit_file` | Bridge deny + engine deny |
| 2 | Assessor calls `shell.exec` (not allowlisted) | Bridge deny |
| 3 | Assessor calls `shell.exec_allowlisted { bin: "bash", args: ["-c", "rm -rf /"] }` | Bridge deny (bin not in allowlist) |
| 4 | Assessor calls `shell.exec_allowlisted { bin: "git", args: ["push", "origin", "--force"] }` | Bridge deny (args_pattern mismatch) |
| 5 | Assessor reads `.env` | fs deny_globs |
| 6 | Assessor reads `~/.ssh/id_rsa` | fs scope + deny_globs |
| 7 | Assessor `http_get` to arbitrary host | network_egress deny |
| 8 | Assessor `connector.write.github.create_issue` | Bridge deny (not in allow) + scope validation |
| 9 | Executor.code attempts `git push` | Deny (push not in capability) |
| 10 | Executor.code attempts `deploy.vercel` | Deny (wrong profile) |
| 11 | Executor.release attempts `edit_file src/main.rs` | Deny (scoped_paths mismatch) |
| 12 | Create session with `class=executor` without handoff | Reject at session.create |
| 13 | Create session with expired handoff | Reject with `handoff.expired` |
| 14 | Create session with mismatched handoff pin (worktree changed, strict) | Reject with `handoff.invalidated` |
| 15 | Mid-session attempt to change profile | No command path exists; verify none accepted |
| 16 | Profile hash mismatch between bridge and engine | Engine aborts; session fails cleanly |
| 17 | Tool registered without `side_effect` tag | Engine refuses to start |
| 18 | Assessor exceeds `max_tool_calls` | Session terminated with `resource.exhausted` |
| 19 | Prompt injection: agent tries to invoke `palette.invoke_action { actionId: "executor.deploy" }` in assessor session | Bridge deny (action capabilities exceed profile) |
| 20 | Cross-session leak: executor session tries to read another session's audit log | fs deny |

Test harness lives at `tests/red-team/` and runs on every PR. New profiles MUST add their own cases.

---

## 12. Operational rules

- Profiles are **code-reviewed security artifacts**. Profile PRs require two-party review (security + eng lead).
- No runtime profile editing. No "admin override" bypass. Gate overrides apply to gates, not to profiles.
- When adding a new assessor family, inherit `assessor.base` and add only connector + host allowlist entries. Any additional `tool_allow` requires explicit security review with threat model note.
- New executor profiles require: threat model, rollback plan, red-team cases, and sign-off from two reviewers.
- Profile loaded at bridge startup is **hash-pinned** in session handshake. Any drift = hard failure, not warning.

---

## 13. Open questions (to resolve before Phase 4)

1. **Dynamic scoped_paths** for executor.code: should handoff packets be able to narrow `fs.write` to only files listed in packet tasks? (Leaning yes; reduces blast radius of an executor session.)
2. **Per-tool approval UX throttling**: if `shell.exec` always requires approval, will UX become painful? Options: batch approval per task, time-windowed approval, trust-builder mode.
3. **Migration profile design**: two-party approval mechanics — both approvers on same device? Separate devices? Timestamp skew handling.
4. **Connector write in code profile**: exceptional cases (e.g., updating a Jira ticket status as part of a task). Propose explicit per-handoff-task `connector_write_grants[]` rather than a blanket allow.
5. **Offline mode**: what happens when `network_egress.mode = off`? Assessor graceful degradation vs. hard fail.

These are not blockers for v1; tracked here so they don't get forgotten.

---

## 14. Versioning & change control

- This document: `v1.0.0-draft`. Freezes at `v1.0.0` once red-team matrix passes in CI.
- Profile files in `packages/protocol/v1/profiles/*.yaml`: individually versioned.
- Breaking change = new major on both this doc and affected profile. Sessions running with old profile continue until they close.
- Changelog: `docs/capability-profiles.changelog.md` (created when first change lands).

---

## 15. References

- [`docs/assessment-contract.md`](./assessment-contract.md) — how assessor sessions produce findings (to be written next).
- [`docs/handoff-contract.md`](./handoff-contract.md) — pin model, invalidation, dispatch flow.
- [`docs/gates.md`](./gates.md) — gate governance and override policy.
- [`docs/evidence-freshness.md`](./evidence-freshness.md) — EvidenceRef freshness rules.
- [`docs/frontend-rules.md`](./frontend-rules.md) — UI enforcement of profile-aware surfaces.
- [`docs/agent-runtime.md`](./agent-runtime.md) — Stage X profile YAML gains optional `allowed_agent_kinds` field (authoritative; bridge has deny-by-default fallback).
- Upstream VAC PRs: `vac serve --stdio --profile`, tool `side_effect` tagging, `shell.exec_allowlisted` tool — tracked in repo VAC issue tracker.
