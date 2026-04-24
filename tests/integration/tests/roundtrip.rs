//! End-to-end roundtrip: spawn mock-engine, send envelopes, verify stream.

use bridge_core::{EventRing, ReplayResult};
use serde_json::Value;
use std::time::Duration;
use vac_integration::{send_request_json, MockEngineHandle};

const T: Duration = Duration::from_secs(3);

#[tokio::test]
async fn handshake_emits_session_ready() {
    let mut h = MockEngineHandle::spawn(42).await.unwrap();
    let line = h.recv_next(T).await.unwrap();
    let v: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["method"], "session.ready");
    assert!(v["params"]["session_id"].is_string());
    h.shutdown().await.unwrap();
}

#[tokio::test]
async fn ping_returns_pong() {
    let mut h = MockEngineHandle::spawn(42).await.unwrap();
    let _ = h.recv_next(T).await.unwrap(); // consume session.ready
    h.send(&send_request_json(1, "system.ping", serde_json::json!({})))
        .await
        .unwrap();
    let resp = h.recv_next(T).await.unwrap();
    let v: Value = serde_json::from_str(&resp).unwrap();
    assert_eq!(v["id"], 1);
    assert_eq!(v["result"]["pong"], true);
    h.shutdown().await.unwrap();
}

#[tokio::test]
async fn message_submit_streams_deltas() {
    let mut h = MockEngineHandle::spawn(42).await.unwrap();
    let _ = h.recv_next(T).await.unwrap(); // session.ready

    h.send(&send_request_json(
        1,
        "message.submit",
        serde_json::json!({ "text": "hello" }),
    ))
    .await
    .unwrap();

    // Expected sequence:
    //   transcript.message_added
    //   transcript.delta × 5
    //   transcript.completed
    //   response (id=1)
    let mut methods = vec![];
    let mut saw_response = false;
    let mut response_ok = false;
    for _ in 0..10 {
        let line = h.recv_next(T).await.unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        if v.get("id").is_some() && v.get("result").is_some() {
            saw_response = true;
            response_ok = v["result"]["ok"] == true;
            break;
        }
        if let Some(m) = v.get("method").and_then(|m| m.as_str()) {
            methods.push(m.to_string());
        }
    }
    assert!(saw_response, "missing response");
    assert!(response_ok);
    assert!(methods.contains(&"transcript.message_added".to_string()));
    assert_eq!(
        methods.iter().filter(|m| *m == "transcript.delta").count(),
        5,
        "expected 5 deltas, got methods={methods:?}"
    );
    assert!(methods.contains(&"transcript.completed".to_string()));
    h.shutdown().await.unwrap();
}

#[tokio::test]
async fn invalid_json_yields_error() {
    let mut h = MockEngineHandle::spawn(42).await.unwrap();
    let _ = h.recv_next(T).await.unwrap();
    h.send("not json").await.unwrap();
    let line = h.recv_next(T).await.unwrap();
    let v: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["error"]["code"], -32700);
    h.shutdown().await.unwrap();
}

#[tokio::test]
async fn unknown_method_returns_minus_32601() {
    let mut h = MockEngineHandle::spawn(42).await.unwrap();
    let _ = h.recv_next(T).await.unwrap();
    h.send(&send_request_json(
        5,
        "does.not.exist",
        serde_json::json!({}),
    ))
    .await
    .unwrap();
    let line = h.recv_next(T).await.unwrap();
    let v: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["id"], 5);
    assert_eq!(v["error"]["code"], -32601);
    h.shutdown().await.unwrap();
}

#[tokio::test]
async fn event_ring_records_stream_for_replay() {
    // Feed mock output into a bridge-core EventRing, verify replay.
    let mut h = MockEngineHandle::spawn(42).await.unwrap();
    let mut ring: EventRing<Value> = EventRing::new(100);
    let line = h.recv_next(T).await.unwrap();
    ring.push(serde_json::from_str(&line).unwrap()); // session.ready

    h.send(&send_request_json(
        1,
        "message.submit",
        serde_json::json!({}),
    ))
    .await
    .unwrap();

    // Pump until we see the final response (includes message_added + 5 deltas + completed + response)
    loop {
        let line = h.recv_next(T).await.unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        let is_response = v.get("id").is_some() && v.get("result").is_some();
        ring.push(v);
        if is_response {
            break;
        }
    }

    let cursor = 3;
    match ring.replay_after(cursor) {
        ReplayResult::Stream(evs) => {
            assert!(!evs.is_empty());
            for (seq, _) in &evs {
                assert!(*seq > cursor);
            }
        }
        other => panic!("expected Stream, got {other:?}"),
    }

    h.shutdown().await.unwrap();
}
