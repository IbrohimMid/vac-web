//! `websocket_event_delivery` driver — measures the latency of a full
//! WebSocket roundtrip through the bridge: client send -> server WS
//! receive -> dispatch -> ack send -> client WS receive.
//!
//! Approach:
//! 1. Build the same minimal in-process `AppState` used by F2.3.
//! 2. Bind an ephemeral TCP port and `tokio::spawn` `axum::serve` with
//!    the real `build_app(state)` router, so traffic exercises the
//!    production WS upgrade + framing path.
//! 3. Connect a `tokio-tungstenite` client, perform the standard
//!    `hello`/`welcome` handshake, then loop N timed `system.ping`
//!    roundtrips.
//!
//! Why `system.ping`?
//!   The budget guards the symmetric WS framing path: every
//!   `ServerAck` and `ServerEvent` traverses the same encode/send/recv
//!   pipeline. A sessionless command keeps the harness free of
//!   filesystem fixtures while still routing through the real
//!   `dispatch_command` and ws encoder/decoder. F2.3 already isolates
//!   in-process dispatch latency, so the delta here is the WS layer
//!   itself.
//!
//! Budget: `websocket_event_delivery_p95_ms = 250`
//! (config/slo-budgets.yaml).

// tokio-tungstenite 0.24 Message::Text takes Utf8Bytes; .into() is
// required to coerce String, but clippy can't tell from context
// alone. Mirrors the same allow in apps/local-bridge/tests/ws_smoke.rs.
#![allow(clippy::useless_conversion)]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::{SinkExt, StreamExt};
use local_bridge::audit::AuditFacility;
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::config::{ConfigSnapshot, SessionResumePolicy};
use local_bridge::handoff::HandoffService;
use local_bridge::server::{build_app, AppState};
use local_bridge::session::persistence::PersistenceHealth;
use local_bridge::session::SessionRegistry;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::runtime::Builder as RuntimeBuilder;
use tokio::sync::RwLock;
use tokio_tungstenite::tungstenite::Message;

use super::{summarize, Measurement};

/// Number of timed `system.ping` roundtrips. Smaller than the
/// in-process drivers because each iteration pays a real TCP frame.
pub const SAMPLE_COUNT: u64 = 200;
const RECV_TIMEOUT: Duration = Duration::from_secs(5);
const SUBSYSTEM: &str = "websocket_event_delivery";
const SESSION_ID: &str = "perf_session_ws_event_delivery";

pub fn measure() -> anyhow::Result<Measurement> {
    let runtime = RuntimeBuilder::new_current_thread().enable_all().build()?;
    runtime.block_on(measure_async())
}

async fn measure_async() -> anyhow::Result<Measurement> {
    let audit_dir = TempDir::new()?;
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let profile_root = PathBuf::from(manifest_dir).join("../../packages/protocol/v1/profiles");
    let unused_engine_bin = PathBuf::from("/dev/null/perf-harness-mock-engine-not-invoked");

    let state = Arc::new(AppState {
        started_at: Instant::now(),
        sessions: SessionRegistry::new(unused_engine_bin),
        auth: AuthState::new_dev(),
        audit: Arc::new(AuditFacility::new(audit_dir.path().to_path_buf())),
        pairing: PairingStore::new(),
        profile_root,
        handoff: Arc::new(HandoffService::new()),
        persistence: None,
        persistence_health: PersistenceHealth::default(),
        assessment_index: None,
        resume_policy: Arc::new(SessionResumePolicy::default()),
        config_snapshot: Arc::new(RwLock::new(ConfigSnapshot::default())),
    });

    let app = build_app(Arc::clone(&state));
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let server = tokio::spawn(async move {
        // Bind drops when the harness exits.
        let _ = axum::serve(listener, app).await;
    });

    let url = format!("ws://{addr}/api/sessions/stream");
    let result = run_client(&url).await;

    server.abort();
    let _ = server.await;

    result
}

async fn run_client(url: &str) -> anyhow::Result<Measurement> {
    let (mut ws, _resp) = tokio_tungstenite::connect_async(url).await?;

    // Hello/welcome handshake.
    send_text(&mut ws, json!({ "type": "hello", "protocol_version": 1 })).await?;
    let welcome = recv_text(&mut ws).await?;
    if welcome.get("type").and_then(|v| v.as_str()) != Some("welcome") {
        anyhow::bail!("expected welcome frame, got: {welcome}");
    }

    // Warm-up roundtrip — drop first sample so the WS upgrade and any
    // one-shot allocations don't skew percentiles.
    let warm_id = "perf-ws-warmup".to_string();
    send_ping(&mut ws, &warm_id).await?;
    expect_ack(&mut ws, &warm_id).await?;

    let mut samples_ns: Vec<u128> = Vec::with_capacity(SAMPLE_COUNT as usize);
    for i in 0..SAMPLE_COUNT {
        let id = format!("perf-ws-{i}");
        let started = Instant::now();
        send_ping(&mut ws, &id).await?;
        expect_ack(&mut ws, &id).await?;
        samples_ns.push(started.elapsed().as_nanos());
    }

    // Cooperative close; ignore any error during shutdown.
    let _ = ws.close(None).await;

    Ok(summarize(SUBSYSTEM, samples_ns))
}

async fn send_text<S>(ws: &mut S, v: Value) -> anyhow::Result<()>
where
    S: SinkExt<Message> + Unpin,
    <S as futures::Sink<Message>>::Error: std::fmt::Display,
{
    ws.send(Message::Text(v.to_string().into()))
        .await
        .map_err(|e| anyhow::anyhow!("ws send failed: {e}"))
}

async fn recv_text<S>(ws: &mut S) -> anyhow::Result<Value>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let msg = tokio::time::timeout(RECV_TIMEOUT, ws.next())
        .await
        .map_err(|_| anyhow::anyhow!("ws recv timed out after {:?}", RECV_TIMEOUT))?
        .ok_or_else(|| anyhow::anyhow!("ws stream ended"))?
        .map_err(|e| anyhow::anyhow!("ws recv error: {e}"))?;
    match msg {
        Message::Text(t) => Ok(serde_json::from_str(&t)?),
        other => Err(anyhow::anyhow!("expected text frame, got {other:?}")),
    }
}

async fn send_ping<S>(ws: &mut S, id: &str) -> anyhow::Result<()>
where
    S: SinkExt<Message> + Unpin,
    <S as futures::Sink<Message>>::Error: std::fmt::Display,
{
    send_text(
        ws,
        json!({
            "id": id,
            "session_id": SESSION_ID,
            "type": "system.ping",
            "payload": {},
            "v": 1,
        }),
    )
    .await
}

async fn expect_ack<S>(ws: &mut S, id: &str) -> anyhow::Result<()>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    // Tolerate up to a small number of unrelated frames (e.g. stray
    // server events); abort if we see something that's neither our
    // ack nor a benign event.
    for _ in 0..8 {
        let v = recv_text(ws).await?;
        if v.get("ackOf").and_then(|a| a.as_str()) == Some(id) {
            if v.get("ok").and_then(|b| b.as_bool()) == Some(true) {
                return Ok(());
            }
            anyhow::bail!("system.ping ack ok=false for id {id}: {v}");
        }
    }
    anyhow::bail!("did not receive ack for id {id} after 8 frames")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measure_returns_well_formed_measurement() {
        let m = measure().expect("measure should succeed for ws roundtrip");
        assert_eq!(m.subsystem, SUBSYSTEM);
        assert_eq!(m.sample_count, SAMPLE_COUNT);
        assert!(m.p50_ms >= 0.0);
        assert!(m.p95_ms >= m.p50_ms);
        assert!(m.p99_ms >= m.p95_ms);
    }
}
