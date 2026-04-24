# Plan 0.6-04 — End-to-end roundtrip integration test

**Phase**: 0.6 · **Depends on**: 0.6-01 (mock-engine) + 0.6-02 (bridge-core) · **Blocks**: 1.1 · **Est**: 0.5 day

## Goal

A single integration test that proves the stack works: spawn `mock-engine` as a child, send commands via stdin, receive events on stdout, parse via `protocol-rs`, feed through `bridge-core::EventRing`, verify sequence + content. No HTTP, no WebSocket yet — just the stdio contract working end-to-end.

## Why this is hard

The test is the substrate Phase 1 will extend. If it's flaky, every 1.x plan inherits the flakiness. Design for:
- Deterministic (seeded timestamps, stable ULIDs).
- Timeout-guarded (each await has upper bound).
- Process cleanup on panic (ChildGuard).
- Fast (sub-second; not a load test).

## Scope

### In
- New workspace crate `tests/integration/` or reuse `tests/` folder pattern.
- Helper: `spawn_mock_engine(seed: u64) -> MockEngineHandle` with Drop cleanup.
- Test: `handshake_and_message_submit` — full scripted exchange.
- Test: `invalid_request` — mock rejects; parser handles.
- Test: `replay_via_event_ring` — push events into ring, replay after cursor.

### Out
- axum WebSocket (Phase 1.1).
- Real auth (Phase 1.4).
- Multiple concurrent sessions (Phase 1.2).

## Deliverables

```
tests/integration/
├── Cargo.toml
├── src/
│   ├── lib.rs           # MockEngineHandle helper
│   └── protocol.rs      # convenience typed send/recv wrappers
└── tests/
    └── roundtrip.rs     # scenarios
```

## Stages

### S1 — Crate scaffold (0.1 day)

```toml
[package]
name = "vac-integration"
...
publish = false

[dependencies]
tokio = { workspace = true, features = ["full"] }
serde_json = { workspace = true }
anyhow = { workspace = true }
tracing = { workspace = true }
tempfile = { workspace = true }
bridge-core = { path = "../../packages/bridge-core" }
protocol-rs = { path = "../../packages/protocol-rs" }

[dev-dependencies]
tracing-subscriber = { workspace = true }
```

Add to workspace members.

**Exit**: `cargo check -p vac-integration`.

### S2 — MockEngineHandle (0.2 day)

```rust
pub struct MockEngineHandle {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout_lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    stderr_pump: JoinHandle<()>,
}

impl MockEngineHandle {
    pub async fn spawn(seed: u64) -> Result<Self> {
        let path = env!("CARGO_BIN_EXE_mock-engine");   // cargo provides exe path
        let mut child = tokio::process::Command::new(path)
            .arg("--stdio").arg("--seed").arg(seed.to_string())
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap()).lines();
        let stderr = child.stderr.take().unwrap();
        let stderr_pump = tokio::spawn(async move {
            // pump stderr to test output for debugging
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[mock-engine] {line}");
            }
        });
        Ok(Self { child, stdin, stdout_lines: stdout, stderr_pump })
    }

    pub async fn send(&mut self, line: &str) -> Result<()> {
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;
        Ok(())
    }

    pub async fn recv_next(&mut self, timeout: Duration) -> Result<String> {
        match tokio::time::timeout(timeout, self.stdout_lines.next_line()).await?? {
            Some(l) => Ok(l),
            None => Err(anyhow!("mock-engine stdout EOF")),
        }
    }
}

impl Drop for MockEngineHandle {
    fn drop(&mut self) {
        // kill_on_drop handles it; this is belt-and-suspenders
        let _ = self.child.start_kill();
    }
}
```

Env var `CARGO_BIN_EXE_mock-engine` set automatically by cargo for `[dev-dependencies]` binary references via `artifact = "bin"` — or use `env!` if mock-engine is in workspace. Document either way.

**Exit**: spawn + kill test green.

### S3 — Typed helper (0.1 day)

```rust
pub async fn send_request(
    h: &mut MockEngineHandle,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<()> {
    let line = serde_json::to_string(&serde_json::json!({
        "id": id, "method": method, "params": params
    }))?;
    h.send(&line).await
}

pub async fn recv_notification(
    h: &mut MockEngineHandle,
    timeout: Duration,
) -> Result<(String, serde_json::Value)> {
    let line = h.recv_next(timeout).await?;
    let v: serde_json::Value = serde_json::from_str(&line)?;
    Ok((
        v["method"].as_str().unwrap_or("").to_string(),
        v["params"].clone(),
    ))
}
```

**Exit**: compiles.

### S4 — Scenario test: handshake + message.submit (0.2 day)

```rust
#[tokio::test]
async fn handshake_and_message_submit() {
    let mut h = MockEngineHandle::spawn(42).await.unwrap();
    let t = Duration::from_secs(2);

    // Mock emits `session.ready` on startup.
    let (method, _params) = recv_notification(&mut h, t).await.unwrap();
    assert_eq!(method, "session.ready");

    // Submit a message.
    send_request(&mut h, 1, "message.submit", json!({"text": "hi"})).await.unwrap();

    // Expect: message_added + 5 deltas + completed + response to req id 1.
    let (m, _) = recv_notification(&mut h, t).await.unwrap();
    assert_eq!(m, "transcript.message_added");
    let mut deltas = 0;
    loop {
        let (m, _) = recv_notification(&mut h, t).await.unwrap();
        if m == "transcript.delta" { deltas += 1; }
        else if m == "transcript.completed" { break; }
        else { panic!("unexpected {m}"); }
    }
    assert_eq!(deltas, 5);

    // response to request
    let resp_line = h.recv_next(t).await.unwrap();
    let v: Value = serde_json::from_str(&resp_line).unwrap();
    assert_eq!(v["id"], 1);
    assert!(v["result"]["ok"].as_bool().unwrap());
}
```

**Exit**: test green.

### S5 — Scenario test: invalid input (0.05 day)

```rust
#[tokio::test]
async fn invalid_json_yields_error_response() {
    let mut h = MockEngineHandle::spawn(42).await.unwrap();
    let t = Duration::from_secs(2);
    recv_notification(&mut h, t).await.unwrap();  // consume session.ready
    h.send("not json").await.unwrap();
    let line = h.recv_next(t).await.unwrap();
    let v: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["error"]["code"], -32700);
}
```

**Exit**: green.

### S6 — EventRing integration test (0.05 day)

```rust
#[test]
fn ring_buffers_notifications_from_mock() {
    // Simulate: consume N notifications, feed into EventRing, replay after cursor.
    let mut ring: EventRing<String> = EventRing::new(100);
    for i in 0..10 {
        ring.push(format!("event_{i}"));
    }
    match ring.replay_after(5) {
        ReplayResult::Stream(events) => assert_eq!(events.len(), 4),
        _ => panic!("expected stream"),
    }
}
```

**Exit**: green. (Verifies bridge-core works alongside mock-engine even without direct integration.)

### S7 — CI wire (0.05 day)

Ensure `cargo test --workspace` picks up `vac-integration`. Should automatic via workspace membership.

In `.github/workflows/ci.yml`, the rust job already runs `cargo test --workspace`.

**Exit**: CI runs integration tests.

## Exit criteria

- [ ] All scenarios green.
- [ ] No process leak (verified via `ps` after 100 runs locally).
- [ ] Deterministic: same seed → same event sequence.
- [ ] Total test runtime < 3s.

## Risks

| Risk | Mitigation |
|---|---|
| Child process leak on panic | `kill_on_drop(true)` + explicit Drop |
| Timing flakiness | Generous but bounded timeouts; assertions on content not clock |
| Stderr drains too slow → child blocks | Dedicated stderr pump task |
| CI runner slow → timeouts trip | 2s default; can raise to 10s per test if needed |

## Related

- Plan 0.6-01 — mock-engine (spawned by these tests).
- Plan 0.6-02 — bridge-core (consumed by ring test).
- Plan 1.1 README — axum WS server consumes the same MockEngineHandle pattern.
