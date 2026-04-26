//! WebSocket upgrade + per-connection loop.
//!
//! axum 0.7 accepts `String` directly for `Message::Text`; the explicit
//! `.into()` conversions exist so upgrading to the pre-1.0 `Utf8Bytes` API
//! (introduced mid-2024 in some builds) is a no-op rename. Clippy can't see
//! the cross-version ergonomic intent.
#![allow(clippy::useless_conversion)]

use super::envelope::{
    AuthFrame, ClientCommand, ErrorInfo, HelloFrame, ReplayRequest, ServerAck, ServerEvent,
    WelcomeFrame,
};
use crate::server::AppStateHandle;
use crate::translator::dispatch_command;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use bridge_core::ReplayResult;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tracing::{debug, info, warn};
use ulid::Ulid;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppStateHandle>,
) -> impl IntoResponse {
    let client_id = format!("cli_{}", Ulid::new());
    ws.on_upgrade(move |socket| run_socket(socket, state, client_id))
}

async fn run_socket(socket: WebSocket, state: AppStateHandle, client_id: String) {
    let (mut tx, mut rx) = socket.split();
    info!(%client_id, "ws connected");

    // 1. Expect hello frame within 5s.
    let hello_line = match tokio::time::timeout(Duration::from_secs(5), rx.next()).await {
        Ok(Some(Ok(Message::Text(t)))) => t.to_string(),
        Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
            info!(%client_id, "ws closed before hello");
            return;
        }
        _ => {
            warn!(%client_id, "hello timeout or bad frame");
            let _ = tx.send(Message::Close(None)).await;
            return;
        }
    };

    let hello: HelloFrame = match serde_json::from_str(&hello_line) {
        Ok(h) => h,
        Err(e) => {
            send_raw_err(
                &mut tx,
                "protocol.bad_envelope",
                &format!("hello parse: {e}"),
            )
            .await;
            return;
        }
    };
    if hello.r#type != "hello" {
        send_raw_err(
            &mut tx,
            "protocol.bad_envelope",
            "first frame must be hello",
        )
        .await;
        return;
    }

    // 2. Authenticate (optional in dev mode; strict with JWT otherwise).
    let device_id = match authenticate(&hello.auth, &state) {
        Ok(d) => d,
        Err(code) => {
            state.audit.log(
                "_ws",
                "ws",
                bridge_core::AuditSeverity::Warn,
                serde_json::json!({ "event": "auth_failed", "code": code, "client": client_id }),
            );
            send_raw_err(&mut tx, code, "auth failed").await;
            return;
        }
    };
    state.audit.log(
        "_ws",
        "ws",
        bridge_core::AuditSeverity::Info,
        serde_json::json!({ "event": "connected", "device": device_id, "client": client_id }),
    );

    // 3. Send welcome.
    let welcome = serde_json::to_string(&WelcomeFrame::new()).expect("serialize WelcomeFrame");
    if tx.send(Message::Text(welcome.into())).await.is_err() {
        return;
    }
    debug!(%client_id, %device_id, "ws hello-welcome completed");

    // 4. Run IO loops.
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<String>(512);

    let outgoing_task = tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            if tx.send(Message::Text(line.into())).await.is_err() {
                return;
            }
        }
    });

    // Ping task every 20s
    let ping_sender = out_tx.clone();
    let ping_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(20)).await;
            let _ = ping_sender
                .send(
                    serde_json::to_string(&json!({"type": "ping"})).expect("serialize ping frame"),
                )
                .await;
        }
    });

    // Main loop: read + dispatch.
    while let Some(msg) = rx.next().await {
        match msg {
            Ok(Message::Text(t)) => {
                handle_incoming(t.to_string(), &state, &out_tx, &client_id).await;
            }
            Ok(Message::Binary(_)) => { /* phase 3 (shell) */ }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    ping_task.abort();
    outgoing_task.abort();
    state.audit.log(
        "_ws",
        "ws",
        bridge_core::AuditSeverity::Info,
        serde_json::json!({ "event": "disconnected", "client": client_id }),
    );
    info!(%client_id, "ws disconnected");
}

async fn handle_incoming(
    line: String,
    state: &AppStateHandle,
    out_tx: &tokio::sync::mpsc::Sender<String>,
    client_id: &str,
) {
    // Try replay first (has distinct field pattern).
    if let Ok(r) = serde_json::from_str::<ReplayRequest>(&line) {
        if r.r#type == "replay.request" {
            handle_replay(r, state, out_tx).await;
            return;
        }
    }

    // Try command envelope.
    let cmd: ClientCommand = match serde_json::from_str(&line) {
        Ok(c) => c,
        Err(e) => {
            let _ = out_tx
                .send(serde_ack(
                    "unknown",
                    false,
                    Some(ErrorInfo {
                        code: "protocol.bad_envelope".into(),
                        message: format!("{e}"),
                    }),
                ))
                .await;
            return;
        }
    };

    debug!(%client_id, cmd_id = %cmd.id, cmd_type = %cmd.cmd_type, "dispatch");
    let cmd_type = cmd.cmd_type.clone();
    let (ack, events) = dispatch_command(cmd, state.clone()).await;
    let _ = out_tx.send(serde_ack_from(ack)).await;
    for ev in events {
        // When session.create returns session.ready, spawn a subscriber task so
        // subsequent broadcast events from the engine reach this client live.
        if ev.event_type == "session.ready" {
            subscribe_to_session(&ev.session_id, state.clone(), out_tx.clone());
        }
        let _ = out_tx.send(serde_event(ev)).await;
    }
    let _ = cmd_type;
}

/// Spawn a background task that forwards broadcast events from a session to this client.
fn subscribe_to_session(
    session_id: &str,
    state: AppStateHandle,
    out_tx: tokio::sync::mpsc::Sender<String>,
) {
    let Some(handle) = state.sessions.get(session_id) else {
        return;
    };
    let mut rx = handle.broadcast.subscribe();
    let sid = session_id.to_string();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    if out_tx.send(serde_event(ev)).await.is_err() {
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    let _ = out_tx
                        .send(
                            serde_json::to_string(&json!({
                                "type": "replay.out_of_range",
                                "session_id": sid.clone(),
                                "lagged": n
                            }))
                            .expect("serialize replay.out_of_range frame"),
                        )
                        .await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    debug!(session = %sid, "broadcast closed");
                    return;
                }
            }
        }
    });
}

async fn handle_replay(
    r: ReplayRequest,
    state: &AppStateHandle,
    out_tx: &tokio::sync::mpsc::Sender<String>,
) {
    let Some(session) = state.sessions.get(&r.session_id) else {
        let _ = out_tx
            .send(serde_ack(
                "replay",
                false,
                Some(ErrorInfo {
                    code: "session.not_found".into(),
                    message: r.session_id.clone(),
                }),
            ))
            .await;
        return;
    };
    let ring = session.ring.read().await;
    match ring.replay_after(r.last_event_id) {
        ReplayResult::Stream(evs) => {
            for (seq, ev) in evs {
                let mut ev = ev;
                ev.seq = seq;
                let _ = out_tx.send(serde_event(ev)).await;
            }
        }
        ReplayResult::OutOfRange { oldest, requested } => {
            let _ = out_tx
                .send(
                    serde_json::to_string(&json!({
                        "type": "replay.out_of_range",
                        "oldest": oldest,
                        "requested": requested,
                    }))
                    .unwrap(),
                )
                .await;
        }
        ReplayResult::UpToDate => {}
    }
}

fn authenticate(auth: &Option<AuthFrame>, state: &AppStateHandle) -> Result<String, &'static str> {
    match auth {
        Some(a) => state
            .auth
            .verify(&a.access_token)
            .map(|c| c.device_id.clone())
            .map_err(|_| "auth.invalid_token"),
        None => {
            // Phase 1.1 default: accept unauthenticated (tests). Production: deny.
            if state.auth.allow_anonymous() {
                Ok("anon".to_string())
            } else {
                Err("auth.required")
            }
        }
    }
}

async fn send_raw_err<S>(tx: &mut S, code: &str, msg: &str)
where
    S: SinkExt<Message> + Unpin,
{
    let v = json!({"ackOf": null, "ok": false, "error": {"code": code, "message": msg}});
    let _ = tx.send(Message::Text(v.to_string().into())).await;
}

fn serde_ack(id: &str, ok: bool, err: Option<ErrorInfo>) -> String {
    serde_json::to_string(&ServerAck {
        ack_of: id.to_string(),
        ok,
        error: err,
    })
    .expect("serialize ServerAck")
}

fn serde_ack_from(a: ServerAck) -> String {
    serde_json::to_string(&a).expect("serialize ServerAck")
}

fn serde_event(e: ServerEvent) -> String {
    serde_json::to_string(&e).expect("serialize ServerEvent")
}

// Keep the _ prefix to satisfy unused-var lints where Value is not mapped.
#[allow(dead_code)]
fn _v(_v: &Value) {}
