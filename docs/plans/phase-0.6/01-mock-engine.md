# Plan 0.6-01 — Mock engine binary

**Phase**: 0.6 · **Depends on**: Phase 0.5 (protocol schemas + profile YAMLs) · **Blocks**: 0.6-04, 1.1–1.3 integration tests · **Est**: 1 day

## Goal

Produce a `mock-engine` binary at `tools/mock-engine/` that speaks line-delimited JSON-RPC 2.0 over stdio — the same contract upstream `vac serve --stdio` will implement (PR #1). Bridge integration tests spawn this mock until real `vac serve` lands.

## Why this is hard

Spec compliance under load: the mock must behave deterministically (scripted responses) AND handle real-world edge cases (malformed input, partial lines, stdin EOF) the same way the real engine will. Otherwise Phase 1 tests pass against mock but fail against real engine.

## Scope

### In
- Binary `mock-engine` that reads stdin lines, writes stdout lines, logs to stderr.
- Supports handshake, `message.submit`, `message.cancel_stream`, `approval.approve`, `approval.reject`.
- Scripted responses: single assistant message streamed as 5 deltas.
- Graceful EOF handling.
- Deterministic UUIDs (seeded).
- CLI flags: `--profile`, `--session-id`, `--project`.

### Out
- Real LLM integration (mocks stream fixed text).
- Real tool invocation (approvals auto-approved in scripted mode).
- Profile enforcement (bridge owns Layer 1; engine trusts bridge for mock).

## Deliverables

```
tools/mock-engine/
├── Cargo.toml
├── src/
│   ├── main.rs            # tokio loop reading stdin, writing stdout
│   ├── scenarios.rs       # scripted response table
│   ├── envelope.rs        # JSON-RPC parse + emit helpers
│   └── clock.rs           # deterministic timestamps via seed
└── README.md
```

## Stages

### S1 — Crate scaffold (0.1 day)

`Cargo.toml` with: `tokio`, `serde`, `serde_json`, `anyhow`, `tracing`, `tracing-subscriber`. Binary target `mock-engine`. Add to workspace members.

CLI via `clap` (feature-minimal):
```rust
#[derive(Parser)]
struct Args {
    #[clap(long)]
    stdio: bool,
    #[clap(long)]
    profile: Option<String>,
    #[clap(long)]
    session_id: Option<String>,
    #[clap(long)]
    project: Option<PathBuf>,
    #[clap(long, default_value = "42")]
    seed: u64,
}
```

**Exit**: `cargo run -p mock-engine -- --stdio --profile assessor.rtd@1.0.0` prints startup log to stderr, awaits stdin.

### S2 — Envelope parser (0.2 day)

Line-delimited JSON-RPC 2.0. Each line: one request. Output: one notification/response per line.

```rust
pub enum Incoming {
    Request { id: Option<Value>, method: String, params: Value },
    Invalid { raw: String, error: String },
}

pub fn parse_line(line: &str) -> Incoming { ... }
pub fn emit_notification(method: &str, params: Value) -> String { ... }
pub fn emit_response(id: Value, result: Value) -> String { ... }
pub fn emit_error(id: Option<Value>, code: i32, message: &str) -> String { ... }
```

Invalid JSON → respond with error (per JSON-RPC spec: id=null when unparseable).

**Exit**: unit tests for parse + emit round-trip.

### S3 — Main loop (0.2 day)

```rust
#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    init_tracing_to_stderr();
    info!(?args, "mock-engine starting");

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    // Emit startup notification
    emit(&mut stdout, "session.ready", json!({ "session_id": args.session_id }))
        .await?;

    while let Some(line) = reader.next_line().await? {
        let incoming = parse_line(&line);
        let responses = scenarios::handle(incoming, &state).await;
        for r in responses {
            emit_raw(&mut stdout, r).await?;
        }
    }
    info!("mock-engine EOF, exiting");
    Ok(())
}
```

Graceful shutdown on stdin EOF → exit 0. On IO error → log + exit 1. On panic → tokio catches, exit 2 via catch-unwind if possible.

**Exit**: `echo '{"id":1,"method":"system.ping","params":{}}' | cargo run -p mock-engine -- --stdio` prints pong.

### S4 — Scripted scenarios (0.3 day)

`scenarios.rs` module with handlers:

```rust
pub async fn handle(incoming: Incoming, state: &mut State) -> Vec<String> {
    match incoming {
        Incoming::Request { id, method, params } if method == "message.submit" => {
            let msg_id = state.next_ulid();
            let mut out = vec![
                emit_notification("transcript.message_added",
                    json!({ "message_id": msg_id, "role": "assistant", "created_at": state.now() })),
            ];
            for chunk in ["I'll ", "look ", "into ", "that.", ""] {
                out.push(emit_notification("transcript.delta",
                    json!({ "message_id": msg_id, "delta": chunk })));
            }
            out.push(emit_notification("transcript.completed",
                json!({ "message_id": msg_id, "usage": { "input_tokens": 10, "output_tokens": 5 } })));
            out.push(emit_response(id.unwrap(), json!({ "ok": true })));
            out
        }
        Incoming::Request { id, method, .. } if method == "system.ping" => {
            vec![emit_response(id.unwrap(), json!({ "pong": true }))]
        }
        // ... approval.approve, approval.reject, message.cancel_stream ...
        Incoming::Invalid { raw, error } => {
            warn!(?raw, error, "invalid request");
            vec![emit_error(None, -32700, &error)]
        }
        _ => vec![],
    }
}
```

**Exit**: scripted scenario tested via `cargo test -p mock-engine` (spawns self with stdio-piped).

### S5 — Determinism (0.1 day)

- Seed ULID generator via `--seed` flag.
- Use a fixed-start monotonic clock: `start_time + elapsed_count * 100ms`.
- Every run with same seed produces byte-identical output.

**Exit**: integration test runs twice, stdout byte-equal.

### S6 — Tests (0.1 day)

```rust
// tests/stdio_echo.rs
#[tokio::test]
async fn ping_pong() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mock-engine"))
        .arg("--stdio").arg("--seed").arg("1")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(b"{\"id\":1,\"method\":\"system.ping\",\"params\":{}}\n").await.unwrap();
    stdin.shutdown().await.unwrap();
    let out = child.wait_with_output().await.unwrap();
    let s = std::str::from_utf8(&out.stdout).unwrap();
    assert!(s.contains("\"pong\":true"));
}
```

**Exit**: tests green.

### S7 — Docs (0.1 day)

`tools/mock-engine/README.md`:
- Purpose (vs real `vac serve`).
- Supported methods.
- CLI flags.
- Scripted scenarios table.
- Debugging tips (stderr logs).

**Exit**: contributor can diagnose test failures from README.

## Exit criteria

- [ ] `cargo run -p mock-engine -- --stdio` responds to pings.
- [ ] `message.submit` scenario emits 5-chunk stream.
- [ ] Same seed → byte-identical output across runs.
- [ ] EOF + invalid JSON handled gracefully.
- [ ] Spawn + pipe tests green.

## Risks

| Risk | Mitigation |
|---|---|
| Scripted behaviour diverges from real engine | Document explicit scope "mock only" + cross-check when PR #1 lands |
| Timing assumptions in tests | Deterministic clock via `--seed` |
| Tokio stdin/stdout deadlock | Always drain stdin in reader task; never hold lock across await |

## Related

- [`docs/plans/phase-0.5/06-upstream-vac-prs.md`](../phase-0.5/06-upstream-vac-prs.md) PR #1 — real counterpart.
- [`docs/protocol.md`](../../protocol.md) §3 — method catalog.
- Plan 0.6-04 — integration test that drives this mock.
