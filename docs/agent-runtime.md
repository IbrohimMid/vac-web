# Agent Runtime — ACP picker for VAC Web

**Stage**: X.0 — design lock (this document)
**Status**: 🔵 design accepted, no implementation yet
**Audience**: anyone implementing Stage X.1+ or auditing the resulting
implementation against the locked design

> **Provisional flag posture**: this document treats Claude Code's `--acp`
> CLI mode as **provisional and unverified locally**. Stage X.0 ships the
> design; Stage X.3 ships the generic ACP driver. Stage X.3 must NOT start
> until the project owner runs `claude --help && claude --version &&
> claude --acp --help` (or equivalent) on a real machine and pins a
> working version. If `--acp` is not stable, the blueprint allows
> alternate paths (wrapper subprocess, version pin, alternate machine
> protocol) without rewriting Stage X.

---

## 0. Executive goal

Make VAC Web an **agent-runtime-agnostic cockpit**. The user picks one
CLI agent per session:

```
mock-engine     → dev/test provider
vac-native      → first-party VAC CLI engine (when ready)
claude-code     → ACP-compatible external provider (provisional)
opencode        → ACP-compatible external provider
codex           → ACP-compatible external provider
…and other ACP-compatible CLIs via the same Generic ACP driver
```

Architecture target:

```
Browser / VAC Web
  ↓ VAC protocol v1
local-bridge
  ↓ AgentRuntime router
AgentDriver
  ├─ MockDriver
  ├─ VacNativeDriver
  └─ GenericAcpDriver
       ├─ Claude Code           (provisional)
       ├─ OpenCode              (provisional)
       └─ other ACP-compatible CLIs
```

`local-bridge` remains the authority for profile enforcement, approval
queue, gate evaluation, handoff lifecycle, assessment orchestration,
audit log, and connector access. External CLI providers can propose tool
calls / file edits / shell commands; the bridge decides whether they
run.

---

## 1. Non-goals (locked OUT for Stage X)

```
- Browser → CLI direct.
- Claude Code (or any external CLI) as semantic core of VAC.
- Assessment delegated to an external CLI provider.
- Handoff packet lifecycle delegated to an external CLI.
- Gate decisions delegated to an external CLI.
- VIL / VWFD fed by an external CLI.       (Stage K stays HOLD)
- New browser-facing VAC commands beyond the additive `agent_id`
  field on session.create payload.
- Profile enforcement bypass on the grounds that "Claude already
  asked the user".
- Mid-session agent switch.
```

---

## 2. Ownership boundary

| Concern                     | Owner                       | Stage X rule                                                    |
| --------------------------- | --------------------------- | --------------------------------------------------------------- |
| Browser ↔ bridge protocol   | VAC protocol v1             | unchanged except optional additive `agent_id` on session.create |
| Session identity            | bridge                      | one `agent_id` pinned at session create                         |
| Profile enforcement         | bridge                      | deny before provider ever sees a tool/action                    |
| Approval queue              | bridge                      | provider permission request normalized into VAC approval        |
| Audit log                   | bridge                      | provider decisions logged by VAC, includes `agent_id`/`kind`    |
| Gate                        | bridge                      | external provider cannot override                               |
| Handoff                     | bridge                      | external provider cannot forge or bypass                        |
| Assessment                  | bridge / VAC engine         | ACP providers disallowed for assessor profiles                  |
| VIL / VWFD                  | VAC engine                  | Stage K HOLD                                                    |
| LLM chat turn               | selected provider           | via driver                                                      |
| Proposed file/shell tools   | provider proposes           | bridge approves/denies/records                                  |

---

## 3. Locked decisions (1–6)

### Decision 1 — ACP dialect

`AcpDialect` enum exists in code; **actual Claude Code flag/dialect must
be locally verified before X.3**. The doc does not claim `--acp` works.
Provider config has a `dialect` field so multiple ACP variants can
co-exist.

```toml
[agents.claude]
kind = "acp"
label = "Claude Code"
command = "claude"
args = ["--acp"]      # provisional; verify locally before X.3
dialect = "zed-acp"
enabled = false       # gated until X.3 verification
```

If `--acp` is not stable upstream, valid fallback options:

- pin a stable Claude Code machine protocol if one exists and write a
  small wrapper that translates it to `GenericAcpDriver` shape
- wrapper subprocess that translates Claude API → ACP and is referenced
  here as the `command`
- keep provider disabled until dialect is verified

### Decision 2 — Permission timeout

Default `5 minutes`, config-driven per agent definition. Minimum
`10 seconds` (config validator rejects anything lower).

```toml
permission_timeout_ms = 300000    # 5min default
```

### Decision 3 — Mid-session agent switch

**Not allowed.** `agent_id` is immutable for the life of the session.
Switching agent = closing current session and creating a new one.

### Decision 4 — Profile-vs-agent matrix location

**Profile YAML is authoritative.** Profiles add `allowed_agent_kinds`:

```yaml
# packages/protocol/v1/profiles/executor.code@1.0.0.yaml
allowed_agent_kinds:
  - mock
  - vac-native
  - acp
```

Bridge code carries a hard fallback when the field is missing
(deny-by-default per profile prefix; see §8). Profile is data, not
engine code.

### Decision 5 — Claude Code flag

Config-driven. No literal `"--acp"` baked into Rust. Driver code reads
`command` + `args` from `agents.toml`; if Claude's flag changes, only
the config moves.

### Decision 6 — UI feature flag

Agent picker hidden behind:

```js
localStorage['vac.agent_picker.experimental'] === '1'
```

Default-off through X.1–X.6. Default-on at X.7 exit.

---

## 4. Repo shape

### New bridge modules (Stage X.1 onward)

```
apps/local-bridge/src/agent_runtime/
  mod.rs
  config.rs
  registry.rs
  policy.rs
  driver.rs
  session.rs
  errors.rs

  drivers/
    mod.rs
    mock_stdio.rs
    vac_native.rs
    acp.rs

  acp/
    mod.rs
    codec.rs
    process.rs
    translate_in.rs
    translate_out.rs
    permission.rs
    fs.rs
    shell.rs
```

### Existing files refactored across X.1–X.7

```
apps/local-bridge/src/session/registry.rs
apps/local-bridge/src/session/handle.rs
apps/local-bridge/src/translator/mod.rs
apps/local-bridge/src/profile_layer/mod.rs
apps/local-bridge/src/server.rs
apps/local-bridge/src/capabilities.rs
packages/protocol/v1/command.schema.json
packages/protocol/v1/_samples/command/
docs/architecture.md           (cross-link only at X.0)
docs/protocol.md               (cross-link only at X.0)
docs/capability-profiles.md    (cross-link only at X.0)
```

### Optional UI files (X.7)

```
apps/web/src/components/SessionPicker/SessionPicker.tsx
apps/web/src/stores/agents.ts
apps/web/src/transport/capabilities.ts
apps/web/src/components/cockpit/Topbar.tsx
```

### Repo-aware refactor targets (audit-flagged)

The current code does not look like the target. Acknowledge explicitly:

```
Current: SessionRegistry holds a single `default_engine_bin`.
Target:  AgentRuntimeRegistry — multi-provider registry.

Current: SessionHandle::spawn hard-codes
         `--stdio --profile <id> --session-id <id> --project <root>`.
Target:  driver abstraction owns spawn args + protocol.

Current: translator forwards JSON-RPC method = command type.
Target:  driver decides VAC-native vs ACP translation.
```

Stage X.1 must replace these patterns; not extend them.

---

## 5. Core data models

### Agent kind

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentKind {
    Mock,
    VacNative,
    Acp,
}
```

### Agent definition

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDefinition {
    pub id: String,
    pub label: String,
    pub kind: AgentKind,
    pub command: PathBuf,
    pub args: Vec<String>,
    pub env_allow: Vec<String>,
    pub cwd_mode: AgentCwdMode,
    pub permission_timeout_ms: u64,
    pub dialect: Option<String>,
    pub enabled: bool,
}
```

### Session spec

```rust
#[derive(Debug, Clone)]
pub struct AgentSessionSpec {
    pub session_id: String,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub agent_id: String,
    pub agent: AgentDefinition,
}
```

### Driver trait

```rust
#[async_trait::async_trait]
pub trait AgentDriver: Send + Sync {
    async fn spawn(&self, spec: AgentSessionSpec)
        -> anyhow::Result<Box<dyn AgentSession>>;
}

#[async_trait::async_trait]
pub trait AgentSession: Send + Sync {
    async fn send_command(&self, cmd: ClientCommand) -> anyhow::Result<()>;
    async fn approve(&self, approval_id: &str) -> anyhow::Result<()>;
    async fn reject(&self, approval_id: &str, reason: Option<String>)
        -> anyhow::Result<()>;
    async fn close(&self) -> anyhow::Result<()>;
}
```

### Session handle refactor

```rust
pub struct SessionHandle {
    pub id: String,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub agent_id: String,
    pub agent_kind: AgentKind,
    pub state: Arc<StateHolder>,
    pub ring: Arc<RwLock<EventRing<ServerEvent>>>,
    pub driver_session: Arc<dyn AgentSession>,
    pub broadcast: broadcast::Sender<ServerEvent>,
}
```

The raw `ChildStdin` field that exists today is removed; the driver
session owns that detail.

---

## 6. Agent config (`agents.toml`)

### Lookup order

```
1. $VAC_WEB_AGENTS_CONFIG     (explicit override)
2. $VAC_CONFIG_DIR/agents.toml
3. ~/.config/vac-web/agents.toml
4. embedded default            (mock-engine only)
```

### Embedded default

```toml
[agents.mock]
kind = "mock"
label = "Mock Engine"
command = "mock-engine"
args = ["--stdio"]
enabled = true
permission_timeout_ms = 300000
env_allow = []
cwd_mode = "project-root"
```

### Example local config

```toml
default_agent = "mock"

[agents.mock]
kind = "mock"
label = "Mock Engine"
command = "mock-engine"
args = ["--stdio"]
enabled = true
permission_timeout_ms = 300000
env_allow = []
cwd_mode = "project-root"

[agents.vac]
kind = "vac-native"
label = "VAC Engine"
command = "vac"
args = ["serve", "--stdio"]
enabled = false
permission_timeout_ms = 300000
env_allow = ["VAC_*"]
cwd_mode = "project-root"

[agents.claude]
kind = "acp"
label = "Claude Code"
command = "claude"
args = ["--acp"]      # provisional — verify before X.3
dialect = "zed-acp"
enabled = false
permission_timeout_ms = 300000
env_allow = ["ANTHROPIC_*", "CLAUDE_*"]
cwd_mode = "project-root"

[agents.opencode]
kind = "acp"
label = "OpenCode"
command = "opencode"
args = ["--acp"]
dialect = "zed-acp"
enabled = false
permission_timeout_ms = 300000
env_allow = []
cwd_mode = "project-root"
```

### Validation rules (rejected at startup or load)

```
- duplicate agent id
- unknown kind
- missing command
- empty label
- relative command path that does not resolve in PATH
- env var entries not matching allowlist syntax
- permission_timeout_ms < 10000
- acp provider without `dialect`
```

Errors must surface as structured logs, not panics.

---

## 7. Protocol additive extension

### Existing payload (unchanged)

`session.create` payload today:

```json
{ "profile_id": "...", "project_root": "..." }
```

### Additive field

```json
{
  "profile_id": "executor.code@1.0.0",
  "project_root": "/repo",
  "agent_id": "claude"
}
```

`agent_id` is **optional**. Resolution when absent:

```
payload.agent_id
  else $VAC_WEB_DEFAULT_AGENT
  else config.default_agent
  else "mock"
```

Snake-case is preserved (matches current translator parsing).

### `session.ready` payload extension

```json
{
  "session_id": "sess_...",
  "profile_id": "executor.code@1.0.0",
  "agent_id": "claude",
  "agent_kind": "acp"
}
```

Additive only; existing clients ignore the extra fields.

### New error codes (ack on session.create failure)

```
agent.not_registered
agent.disabled
agent.profile_incompatible
agent.spawn_failed
agent.protocol_error
agent.permission_timeout
agent.unavailable
```

**No new browser-facing commands.** Existing protocol surface
(`message.*`, `approval.*`, `review.*`, `runtime.*`, `session.*`, etc.)
is sufficient for normalising provider events.

---

## 8. Provider compatibility matrix

### Hard fallback (when profile YAML is silent)

| Profile prefix         | mock | vac-native | acp |
| ---------------------- | ---: | ---------: | --: |
| `executor.code@*`      |  yes |        yes | yes |
| `executor.release@*`   |  yes |        yes |  no |
| `executor.migration@*` |   no |        yes |  no |
| `assessor.*@*`         |  yes |        yes |  no |
| unknown                |   no |         no |  no |

### Authority

If profile YAML defines `allowed_agent_kinds`, that wins. Otherwise the
fallback table applies. Unknown profile → deny-by-default.

### Reasoning

ACP providers can do builder turns, file edits, and shell operations
**under bridge approval**.

ACP providers cannot own:

```
assessment verdict
handoff packet lifecycle
gate decision
migration safety semantics
VIL / VWFD semantics
release authority
```

### Enforcement timing (at `session.create`)

```
1. load profile
2. resolve agent
3. check agent enabled
4. check profile allowed_agent_kinds
5. check hard fallback matrix
6. spawn only if compatible
```

Otherwise the ack is:

```json
{
  "ackOf": "cmd_…",
  "ok": false,
  "error": {
    "code": "agent.profile_incompatible",
    "message": "agent kind acp is not allowed for assessor.rtd@1.0.0"
  }
}
```

---

## 9. Translation map

### Browser → bridge → provider

| VAC command             | mock / vac-native                            | ACP provider                                              |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `message.submit`        | JSON-RPC method `message.submit`             | ACP prompt / session message                              |
| `message.cancel_stream` | JSON-RPC method                              | ACP cancel if supported; else local cancel + drop chunks  |
| `message.retry`         | JSON-RPC method                              | resend last prompt if bridge has the message snapshot     |
| `approval.approve`      | JSON-RPC method or local approval resolver   | ACP permission response: granted                          |
| `approval.reject`       | JSON-RPC method or local approval resolver   | ACP permission response: denied                           |
| `runtime.cancel_job`    | JSON-RPC method                              | ACP tool/job cancel if supported                          |
| `context.attach_files`  | JSON-RPC method                              | convert to ACP context attachment if supported            |
| `assessment.*`          | mock / vac-native only                       | rejected at routing — never reaches ACP                   |
| `handoff.*`             | bridge / VAC only                            | not provider-owned                                        |
| `gate.*`                | bridge only                                  | not provider-owned                                        |

### Provider → bridge → browser

| Provider event          | VAC event                                     |
| ----------------------- | --------------------------------------------- |
| assistant message start | `transcript.message_added`                    |
| assistant chunk         | `transcript.delta`                            |
| assistant complete      | `transcript.completed`                        |
| provider error          | `transcript.error` or `notify.event`          |
| permission request      | `approval.pending`                            |
| permission resolved     | `approval.resolved`                           |
| file changed            | `review.changeset_updated`                    |
| diff available          | `review.diff_ready`                           |
| shell / job start       | `runtime.jobs_updated`                        |
| shell output            | `runtime.job_log`                             |
| provider closed         | `session.closed`                              |
| status update           | `activity.appended` / `system_pulse.updated`  |

The translation is internal to the bridge. Browser clients see the same
VAC events regardless of which provider drove them.

---

## 10. Security and policy rules

### Rule A — Bridge remains mandatory

No UI code may know provider protocol details.

```
Allowed:
  web → transport.send(sessionId, "message.submit", payload)

Forbidden:
  web → claude
  web → acp
  web → provider-specific transport
```

### Rule B — Deny before queue

If an ACP provider asks for a deny-listed tool / path / shell:

```
deny immediately
audit deny
respond denied to provider
DO NOT create approval.pending
```

The approval queue receives only "allowed-but-needs-human-confirmation"
actions.

### Rule C — Path canonicalization

For every file op:

```
canonicalize(project_root)
canonicalize(target_path)
require target_path starts_with project_root
apply profile deny_globs
apply protected refs
audit args_hash + diff_hash
```

### Rule D — Shell command shape

Provider-supplied raw shell strings are not authoritative.

```
{
  "program": "cargo",
  "args": ["test", "-p", "local-bridge"],
  "cwd": "/repo"
}
```

If the provider gives a raw string, the bridge parses conservatively or
forces approval. **Never auto-run `bash -c` / `sh -c`.**

### Rule E — External provider cannot certify gates

Even if Claude says "tests pass":

```
gate.evaluate stays bridge-owned
evidence comes from bridge-observed jobs / artifacts
provider statements are NOT evidence
```

---

## 11. Audit format

### Session created

```json
{
  "event": "created",
  "session_id": "sess_…",
  "profile_id": "executor.code@1.0.0",
  "project_root": "/repo",
  "agent_id": "claude",
  "agent_kind": "acp",
  "agent_command_hash": "sha256:…"
}
```

### Permission decision

```json
{
  "event": "agent.permission_decision",
  "session_id": "sess_…",
  "agent_id": "claude",
  "provider_request_id": "acp_req_…",
  "approval_id": "appr_…",
  "tool": "shell.exec",
  "args_hash": "sha256:…",
  "decision": "approved",
  "actor": "client_…",
  "ts": "2026-04-25T…"
}
```

### File write

```json
{
  "event": "agent.fs_write",
  "session_id": "sess_…",
  "agent_id": "claude",
  "path": "src/main.rs",
  "args_hash": "sha256:…",
  "diff_hash": "sha256:…",
  "decision": "allowed",
  "policy": "executor.code@1.0.0"
}
```

### Shell exec

```json
{
  "event": "agent.shell_exec",
  "session_id": "sess_…",
  "agent_id": "claude",
  "program": "cargo",
  "args_hash": "sha256:…",
  "cwd": "/repo",
  "decision": "approved",
  "approval_id": "appr_…",
  "policy": "executor.code@1.0.0"
}
```

---

## 12. Substage breakdown + acceptance criteria

### X.0 — Design lock (this doc)

**Output**: `docs/agent-runtime.md` (this file).

**Acceptance**:

- doc committed before any Rust/TS source change
- Stage K explicitly remains HOLD
- Claude provider marked **provisional**, `enabled = false`
- decisions 1–6 locked here
- typecheck + workspace build still green (no source changed)

### X.1 — `AgentRuntime` registry + config

**File plan**:
```
apps/local-bridge/src/agent_runtime/
  mod.rs
  config.rs
  registry.rs
  driver.rs
  errors.rs
  policy.rs
```

**Implement**:
```
- parse agents.toml
- embedded mock default
- env/config lookup order
- resolve default agent
- list enabled agents
- get agent by id
- validate definitions
```

**Refactor**:
```
SessionRegistry { default_engine_bin: PathBuf }
  → SessionRegistry { agent_registry: Arc<AgentRuntimeRegistry> }

create(profile_id, project_root)
  → create(SessionCreateSpec { profile_id, project_root, agent_id })
```

**Acceptance**:
- `cargo test -p local-bridge agent_runtime::*` green
- `session.create` without `agent_id` still uses mock (regression preserved)
- invalid config logs cleanly, no panic
- 119 → ≥119 vitest unchanged (no UI yet)

### X.2 — `session.create.agent_id` plumbing

**File plan**:
```
apps/local-bridge/src/translator/mod.rs
apps/local-bridge/src/session/registry.rs
apps/local-bridge/src/session/handle.rs
packages/protocol/v1/command.schema.json
packages/protocol/v1/_samples/command/valid-session-create-mock.json
packages/protocol/v1/_samples/command/valid-session-create-claude.json
docs/protocol.md          (additive: agent_id field)
```

**Implement**:
```
let agent_id = cmd
  .payload
  .get("agent_id")
  .and_then(|v| v.as_str())
  .map(String::from);
```

Resolution order matches §7. `session.ready` payload gains
`agent_id` + `agent_kind`.

**Acceptance**:
- `session.create { agent_id: "mock" }` works
- `session.create` missing `agent_id` works (backward compatible)
- `session.create { agent_id: "unknown" }` → `agent.not_registered`
- `session.ready` includes `agent_id` + `agent_kind`
- existing clients ignore extra fields safely

### X.3 — Generic ACP driver, **chat-only**

**Scope**:
```
message.submit
assistant streaming
cancel
provider crash
provider stderr → bridge tracing
```

No real tool execution. If the provider asks for a tool before X.4:

```
deny / return unsupported
emit notify.event
audit unsupported_provider_tool_request
```

**File plan**:
```
apps/local-bridge/src/agent_runtime/drivers/acp.rs
apps/local-bridge/src/agent_runtime/acp/
  mod.rs codec.rs process.rs translate_in.rs translate_out.rs
```

**Acceptance**:
- Claude provider starts only when locally verified + enabled in config
- Build chat streams into transcript
- child crash → `transcript.error` + `session.closed`
- no fs / shell side effect possible
- manual smoke documented

### X.4 — Permission ↔ approval bridge

**Mapping**:
```
ACP permission request
  → bridge policy check
    → deny immediately if profile denies
    → else create approval.pending and HOLD the ACP request open
```

User action:
```
approval.approve → ACP permission response: granted
approval.reject  → ACP permission response: denied
timeout (5min)   → auto-reject + approval.expired + audit
```

**Acceptance**:
- deny-listed action never queues
- allowed risky action queues
- approve resumes provider
- reject blocks provider
- timeout auto-rejects
- audit logs `(actor, decision, tool, args_hash, ts)` per decision

### X.5 — Filesystem + diff bridge

**Implement** (per file op):
```
normalize path
canonicalize against project_root
profile fs policy check
optional approval
execute or deny
compute diff summary + hash
emit review.changeset_updated
emit review.diff_ready when available
audit
```

**Acceptance**:
- Claude file writes appear in Review tab
- path traversal denied
- writes outside project_root denied
- `deny_globs` honored
- diff hash logged
- no silent write

### X.6 — Shell / runtime bridge

**Implement** (per shell op):
```
normalize command
check shell_allowlist
risk classify
deny / queue approval / run
stream stdout/stderr
emit runtime.jobs_updated
emit runtime.job_log
audit
```

**Acceptance**:
- shell job appears in Runtime
- logs stream incrementally
- non-allowlisted command queues or denies
- raw `bash -c` / `sh -c` never auto-runs
- long jobs visible in Agents Executor lane

### X.7 — Multi-engine routing + UI picker

**Bridge**:
```
agent_id is per-session
agent kind checked against profile
provider capabilities emitted on session.ready / system.capabilities
```

**UI** (gated by `localStorage['vac.agent_picker.experimental'] === '1'`):
```
New Session / Pairing / Build entry:
  Agent:
    Mock Engine
    Claude Code
    VAC Engine
```

Disabled providers show inline reason ("command not found", "not
installed", "profile incompatible").

**Acceptance**:
- profile-vs-agent compatibility enforced
- picker hidden by default before X.7
- picker lists bridge-provided agents
- selecting Claude sends `agent_id`
- assessor profile cannot choose ACP — clear error

### X.8 — VAC native provider as first-party engine

**Trigger**: VAC CLI exposes a stable stdio interface.

```toml
default_agent = "vac"

[agents.vac]
kind = "vac-native"
label = "VAC Engine"
command = "vac"
args = ["serve", "--stdio"]
enabled = true
```

**Acceptance**:
- VAC native session works end-to-end
- mock demoted to dev-only
- Claude / OpenCode remain optional alternatives
- all Stage X routing still works

---

## 13. Red-team test cases (121–132)

```
121: assessor.rtd + acp           → reject agent.profile_incompatible
122: executor.code + acp          → allow
123: executor.release + acp       → reject
124: executor.migration + acp     → reject
125: unknown agent_id             → reject agent.not_registered
126: disabled agent_id            → reject agent.disabled
127: ACP file write outside projectRoot → deny + audit
128: ACP shell raw `bash -c`      → approval or deny, never auto-run
129: ACP permission timeout       → auto reject + approval.expired
130: provider crash mid-stream    → transcript.error + session.closed
131: approval approve from stale / second client → first decision wins
132: missing allowed_agent_kinds on unknown profile → deny
```

Cases land in `tests/red-team/` alongside the existing matrix
(1–145 from Phases 1–7). Each case has its own `#[test]` per existing
red-team conventions.

---

## 14. Verification commands

For every substage:

```bash
cargo fmt --all
cargo clippy -p local-bridge -- -D warnings
cargo test -p local-bridge
pnpm --filter @vac-web/web typecheck
pnpm --filter @vac-web/web test
pnpm --filter @vac-web/web build
```

Provider smoke (skip in CI unless binary present):

```bash
VAC_WEB_ACP_DEBUG=1 \
VAC_WEB_AGENTS_CONFIG=./fixtures/agents.claude.toml \
cargo test -p local-bridge claude_acp_smoke -- --ignored
```

See [`docs/acp-smoke.md`](./acp-smoke.md) for the full chat-only smoke
workflow, including the OpenCode variant and expected debug events.

Browser smoke X.3+:

```
- create Build session with mock          → chat works
- create Build session with claude        → chat works
- submit message                          → transcript streams
- cancel stream                           → ok
- close session                           → ok
- provider crash                          → transcript.error + closed
- console clean
```

Browser smoke X.4+:

```
- provider requests shell/write           → approval pending visible
- VAC approval reject                     → action blocked
- VAC approval approve                    → action proceeds
- audit entry exists                      → grep audit log
```

---

## 15. Implementation order

```
1. X.0 doc only.                            (this commit)
2. X.1 registry with embedded mock only.
3. X.2 optional agent_id, still mock only.
4. X.3 generic ACP chat driver, no tools.
5. X.4 approval bridge.
6. X.5 fs bridge.
7. X.6 shell bridge.
8. X.7 UI picker.
9. X.8 vac-native default when VAC CLI ready.
```

Substages **X.3 – X.6 must be separate commits**. Combining chat,
permission, fs, and shell into a single patch defeats the review gate.

---

## 16. Reviewer gates

### X.0 PASS requires
- doc exists
- no source code changes except optional cross-link nudges
- Claude ACP dialect explicitly marked provisional
- Stage K explicitly HOLD
- decisions 1–6 locked

### X.1 PASS requires
- `AgentRuntimeRegistry` parses config
- embedded mock works
- existing `session.create` behavior preserved
- no UI changes

### X.2 PASS requires
- `agent_id` accepted and persisted in `SessionHandle`
- unknown agent rejected at `session.create`
- `session.ready` includes agent metadata
- protocol sample updated

### X.3 PASS requires
- chat-only ACP works
- no fs / shell execution path reachable
- provider crash handled
- no approval bypass

### X.4 PASS requires
- ACP permission maps to VAC approval
- deny-listed actions never queue
- approve / reject / timeout tested
- audit complete

### X.5 PASS requires
- `projectRoot` boundary enforced
- profile fs rules enforced
- review changeset emitted
- diff hash audited

### X.6 PASS requires
- shell allowlist enforced
- raw shell not auto-run
- runtime logs stream
- audit complete

### X.7 PASS requires
- profile-agent compatibility enforced
- UI picker feature-flagged
- assessor + acp rejected
- Build + acp allowed

### X.8 PASS requires
- VAC native becomes default
- Claude remains optional
- mock stays dev/test

---

## 17. Cross-references

- [`docs/architecture.md`](./architecture.md) — bridge as policy/audit boundary; agent runtime is internal.
- [`docs/protocol.md`](./protocol.md) — VAC protocol v1 surface; `agent_id` is the only additive field for Stage X.
- [`docs/capability-profiles.md`](./capability-profiles.md) — profile YAML carries `allowed_agent_kinds`.
- [`docs/red-team-test-plan.md`](./red-team-test-plan.md) — cases 121–132 land here.
- [`docs/handoff-contract.md`](./handoff-contract.md) — handoff lifecycle stays bridge-owned regardless of agent.
- [`docs/gates.md`](./gates.md) — gate evaluation stays bridge-owned regardless of agent.

---

## 18. Open follow-ups (NOT part of Stage X)

- VIL / VWFD wiring → Stage K (held on upstream signal).
- Knowledge connector grid parity vs Archive lenses → Stage Y candidate.
- Handoff packet visual richness vs prototype → Stage Y candidate.
- Assess hub scorecards-rich layout parity → Stage Y candidate.

These are intentionally outside Stage X to keep agent-runtime commits
scoped strictly to the runtime layer.

---

**End of Stage X.0 design lock.** Stage X.1 starts only on explicit go +
review of this document.
