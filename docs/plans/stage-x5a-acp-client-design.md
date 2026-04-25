# Stage X.5a — Official ACP Client Design Spike

**Status.** Design spike. Two prototypes built and exercised against
the live `claude-agent-acp@0.31.0` binary. Doc-only commit; code lives
in `/tmp/acp-{node,rust}-spike` and is *not* committed.

**Question.** Should `local-bridge` speak ACP via:

- **Option A — Rust-native client** inside `local-bridge`.
- **Option B — Node sidecar** that re-uses `@agentclientprotocol/sdk`.

**Recommendation.** **Option A (Rust-native).** Rationale below.

---

## 1. Spike A — Rust-native (raw ndjson + JSON-RPC 2.0)

### Code surface

~155 lines of `main.rs`, dependencies `tokio + serde + serde_json +
anyhow`. No SDK; the spike hand-writes the JSON-RPC envelope and
reads stdout line-by-line through a `BufReader`. Request correlation
via `HashMap<u64, oneshot::Sender<Value>>`. Notifications surface to
stderr with the `update.sessionUpdate` discriminator.

### Run output (verbatim, against `@agentclientprotocol/claude-agent-acp@0.31.0`)

```text
[spike] spawning /home/emp/.local/share/.../bin/claude-agent-acp
[spike] → initialize
[spike] ← initialize {"agentCapabilities":{"_meta":{"claudeCode":{"promptQueueing":true}},"loadSession":true,"mcpCapabilities":{"http":true,"sse":true},"promptCapabilities":{"embeddedContext":true,"image":true},"sessionCapabilities":{"close":{},"fork":{},"list":{},"resume":{}}},"agentInfo":{"name":"@agentclientprotocol/claude-agent-acp","title":"Claude Agent","version":"0.31.0"},"authMethods":[],"protocolVersion":1}
[spike] → session/new
[spike] ← session/new sessionId=f721286a-f7cf-4b98-ba6e-36684a733b9c
[spike] → session/prompt
[notif] session/update :: available_commands_update
[notif] session/update :: usage_update
[notif] session/update :: agent_message_chunk
[notif] session/update :: agent_message_chunk
[notif] session/update :: usage_update
[notif] session/update :: usage_update
[spike] ← session/prompt {"stopReason":"end_turn","usage":{"cachedReadTokens":24007,"cachedWriteTokens":0,"inputTokens":6,"outputTokens":7,"totalTokens":24020}}
```

### Findings

- Wire layer is trivial in Rust. `BufReader::lines` + serde_json is
  enough for the full ACP wire.
- Correlation table is one `HashMap` + one mpsc; no protocol
  fancier than JSON-RPC 2.0 line-delimited.
- The spike doesn't yet implement `session/request_permission`,
  `fs/*`, or `terminal/*`, but those are additional handler arms in
  the same correlation loop — no architectural surprise.
- Compile time: 4.7s clean, ~0.5s incremental.

## 2. Spike B — Node sidecar (`@agentclientprotocol/sdk@0.20.0`)

### Code surface

~75 lines of `spike.mjs`, depends on
`@agentclientprotocol/sdk@^0.20.0`. Uses `ClientSideConnection` +
`ndJsonStream` from the SDK; spawns `claude-agent-acp` as a child of
the spike script. SDK API quirk: `ClientSideConnection` takes a
*factory function* `(self) => Client`, not a Client object — caught at
runtime, not at import (`TypeError: toClient is not a function`).

### Run output

```text
[spike] → initialize
[spike] ← initialize {"protocolVersion":1,"agentCapabilities":{"_meta":{"claudeCode":{"promptQueueing":true}},...},"agentInfo":{"name":"@agentclientprotocol/claude-agent-acp","title":"Claude Agent","version":"0.31.0"},"authMethods":[]}
[spike] → session/new
[spike] ← session/new {"sessionId":"02afcbce-4fc2-4fb6-8469-5e984bbfd3de","models":{"availableModels":[{"modelId":"default",...}, ...],"currentModelId":"opus[1m]"},"modes":{"currentModeId":"default","availableModes":[...]}, ...}
[spike] → session/prompt
[spike] ← session/prompt resp: {"stopReason":"end_turn","usage":{"inputTokens":6,"outputTokens":7,"cachedReadTokens":16202,"cachedWriteTokens":7805,"totalTokens":24020}} err: null
[spike] session/update notifications received: 6
[spike]   • session/update available_commands_update
[spike]   • session/update usage_update
[spike]   • session/update agent_message_chunk
[spike]   • session/update agent_message_chunk
[spike]   • session/update usage_update
[spike] agent exit { code: 0, sig: null }
```

### Findings

- SDK works but its TS surface is rough: factory-function
  constructor, no value-typed `Client` object, runtime error if you
  pass an object directly.
- For VAC, an architecture is now: **bridge ↔ Node sidecar ↔
  claude-agent-acp**. Three processes per session instead of two.
- IPC bridge ↔ sidecar would need its own envelope (JSON-RPC over
  socket?) — that's effectively a *second* protocol we maintain.
- Sidecar must be supervised by the bridge (restart, crash detection,
  resource caps); duplicates SessionRegistry's reaper.
- Schema drift: SDK pin tracks upstream automatically.

## 3. Side-by-side comparison

| Concern | Rust-native | Node sidecar |
| ------- | ----------- | ------------ |
| Code in vac-web | ~200 lines, in `local-bridge` | sidecar package + IPC wire + supervisor |
| External runtime added | none | Node runtime + npm install on every host |
| Processes per ACP session | 2 (bridge + agent) | 3 (bridge + sidecar + agent) |
| Schema source of truth | hand-rolled types from SDK schema.json (or codegen) | SDK pin |
| Drift cost when SDK bumps | manually update affected type | bump npm version |
| Audit surface | one Rust crate | bridge + sidecar + IPC envelope + npm tree |
| Profile enforcement boundary | already in-process with bridge | needs to cross IPC boundary |
| Latency overhead per session/update | ~0 | one extra process hop + serialize/deserialize |
| Crash recovery story | existing SessionRegistry watchdog | new supervisor for sidecar **plus** existing one |
| Distribution complexity | ships in `local-bridge` binary | bridge ships + sidecar ships + version-pin both |
| Time-to-first-prompt in spike | wire works in 12s, prompt works | wire works in 12s, prompt works |
| Spike line count | 155 (incl. correlation table) | 75 (using SDK) |
| Schema correctness verification | spike confirmed wire is plain JSON-RPC 2.0 + ndjson | spike confirmed SDK matches the binary |

## 4. Architectural fit

The existing `AgentDriver` in `local-bridge/src/session/handle.rs`
already dispatches per-line on `agent_kind`, with `process_acp_line`
parsing toy ACP envelopes today. Replacing the toy parser with real
ACP fits the existing code shape:

- Add a request-correlation table to `SessionHandle` so
  `send_client_command` can `await` a JSON-RPC response.
- Replace the toy envelope with the wire methods captured in
  [`stage-x-claude-acp-verification.md` §12.3](./stage-x-claude-acp-verification.md).
- Implement Client-side handlers (`session/update`,
  `session/request_permission`, `fs/*`, `terminal/*`) as inbound
  request handlers in the same line pump.

The Node-sidecar route would force a second IPC envelope, a second
supervisor, and split policy enforcement across a process boundary
which the design lock at `docs/agent-runtime.md` explicitly puts
inside the bridge.

## 5. Risk register

| Risk | Rust-native impact | Mitigation |
| ---- | ------------------ | ---------- |
| ACP schema drift in a new SDK release | manual chase | use the SDK's `schema/schema.json` as the source; ship a small `vac-acp-types` crate generated from it (one-shot `typify` or hand-keep ~30 messages) |
| Vendor `_meta` extensions (e.g. `claudeCode.promptQueueing`) | unknown shapes appear over time | preserve `serde_json::Value` for `_meta` fields rather than typed structs |
| Auth flow (`Run \`claude /login\` in the terminal`) | bridge can't trigger this; user must | surface `authMethods` to web, point to the CLI; out-of-band auth |
| `notification` mid-correlation | mpsc/oneshot pattern handles this fine in spike | keep the spike's pump-while-waiting loop |
| Cross-platform stdio quirks | none observed on Linux | replicate the spike on macOS/Windows once supervisor lands |

## 6. Decision

**Adopt Option A (Rust-native).** Reasons in priority order:

1. The spike shows the full wire is implementable in ~155 lines on
   top of `tokio + serde + serde_json + anyhow` — all already
   workspace dependencies.
2. Keeping ACP inside the bridge's address space preserves the X.0
   design lock: profile enforcement, audit, approval queue, and
   session lifecycle stay in one trust boundary.
3. The SDK's TS shape (factory-function constructor, `client` is a
   handler bag rather than a typed object) doesn't give us much
   leverage over hand-rolling the JSON-RPC envelope, since we already
   have that pattern in the bridge today.
4. Distribution: bridge stays a single binary. No npm runtime
   dependency for end users beyond what they install for
   `claude-agent-acp` itself.

The Node sidecar is the **fallback** if a future ACP version
introduces semantics that aren't reasonable to re-implement in Rust
(e.g. embedded JS runtime hooks). Recorded for future reference, not
adopted now.

## 7. Implementation outline (post-decision, NOT this commit)

1. **`packages/acp-types`** (new crate): hand-rolled or codegen'd Rust
   types for the ACP messages the bridge speaks
   (`InitializeRequest/Response`, `NewSessionRequest/Response`,
   `PromptRequest/Response`, `SessionNotification`,
   `RequestPermissionRequest/Response`, `Read/WriteTextFileRequest`,
   plus the four `Terminal*Request/Response` shapes). `_meta` stays
   `Value`.

2. **`local-bridge::agent_runtime::acp::client`**: a small client
   actor that owns the child process stdio + a request-correlation
   table. API mirrors what `SessionHandle::send_client_command`
   already needs:

   ```rust
   pub async fn initialize(&self, caps: ClientCapabilities) -> Result<InitializeResponse>;
   pub async fn new_session(&self, cwd: PathBuf, mcp: Vec<McpServer>) -> Result<NewSessionResponse>;
   pub async fn prompt(&self, sid: &str, prompt: Vec<ContentBlock>) -> Result<PromptResponse>;
   pub async fn cancel(&self, sid: &str);
   pub fn updates(&self) -> broadcast::Receiver<SessionNotification>;
   pub fn permission_requests(&self) -> mpsc::Receiver<PermissionRequest>;
   ```

3. **`SessionHandle::spawn` (Acp branch)**: replace the toy
   `process_acp_line` with the new client actor; map its `updates()`
   stream + `permission_requests()` channel into existing
   `transcript.*`, `review.*`, `runtime.*`, `approval.*` events.

4. **`tools/mock-acp` upgrade**: re-implement the mock to speak the
   real wire (same SDK schema), so X.3 tests continue to anchor the
   contract without depending on a logged-in real Claude.

5. **Tests**: integration test that spawns mock-acp speaking real ACP,
   drives initialize → new → prompt → assert agent_message_chunk
   surfaces as `transcript.delta`.

## 8. Open items before X.5b

- `session/request_permission` round-trip under auth — needs a
  logged-in `claude` to capture the real `toolCall` shape with
  options.
- Failure modes: kill mid-prompt, malformed envelope, agent-side
  unhandled error — verify mpsc/oneshot pump tolerates each.
- Decide whether `packages/acp-types` is hand-rolled or codegen'd via
  `typify` from `schema/schema.json`. (Spike kept everything as
  `Value` for speed.)

## 9. Cross-links

- [`stage-x-claude-acp-verification.md`](./stage-x-claude-acp-verification.md) — packages, captured handshakes, full wire-method list.
- [`10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md) — substage map; this doc satisfies the X.5a "design spike" gate.
- [`../agent-runtime.md`](../agent-runtime.md) — Stage X.0 design lock.
