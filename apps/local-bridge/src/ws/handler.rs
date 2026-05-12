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
use crate::audit;
use crate::observability::{LogActor, LogSeverity, StructuredLogBuilder};
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
            let builder =
                StructuredLogBuilder::new("ws.auth_failed", LogActor::User, LogSeverity::Warning)
                    .code(code)
                    .correlation_id(client_id.clone());
            let _ = audit::log_structured(&state, "ws", builder);
            send_raw_err(&mut tx, code, "auth failed").await;
            return;
        }
    };
    let connected_builder =
        StructuredLogBuilder::new("ws.connected", LogActor::User, LogSeverity::Info)
            .code("ok")
            .correlation_id(client_id.clone())
            .namespaced("ws.device", json!(device_id.clone()))
            .expect("ws.device is an allowed namespaced key");
    let _ = audit::log_structured(&state, "ws", connected_builder);
    // Phase 3 (AUDIT-014) — resolve principal once per connection and thread
    // it through every handle_incoming dispatch so gate signoffs/overrides
    // can bind their actor to the authenticated identity instead of trusting
    // payload-supplied strings.
    let principal = principal_for_device(&device_id);

    // 3. Send welcome. Advertise the live agent runtime registry so the
    // cockpit can render a provider picker and route `session.create`
    // with an explicit `agent_id` (avoiding the legacy default-agent clobber
    // when multiple ACP fixtures are loaded).
    let agents_snapshot = state.sessions.agents();
    let welcome = serde_json::to_string(&WelcomeFrame::with_registry(agents_snapshot.as_ref()))
        .expect("serialize WelcomeFrame");
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

    // Track which sessions this WS client is subscribed to so we can
    // auto-subscribe on first command referencing a session (handles
    // reconnect without explicit session.create).
    let mut subscribed: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Main loop: read + dispatch.
    while let Some(msg) = rx.next().await {
        match msg {
            Ok(Message::Text(t)) => {
                handle_incoming(
                    t.to_string(),
                    &state,
                    &out_tx,
                    &client_id,
                    &mut subscribed,
                    principal.as_ref(),
                )
                .await;
            }
            Ok(Message::Binary(_)) => { /* phase 3 (shell) */ }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    ping_task.abort();
    outgoing_task.abort();
    let disconnected_builder =
        StructuredLogBuilder::new("ws.disconnected", LogActor::System, LogSeverity::Info)
            .code("ok")
            .correlation_id(client_id.clone());
    let _ = audit::log_structured(&state, "ws", disconnected_builder);
    info!(%client_id, "ws disconnected");
}

async fn handle_incoming(
    line: String,
    state: &AppStateHandle,
    out_tx: &tokio::sync::mpsc::Sender<String>,
    client_id: &str,
    subscribed: &mut std::collections::HashSet<String>,
    principal: Option<&String>,
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

    // Lazy-subscribe: if this client references a session it hasn't
    // subscribed to yet (e.g. after WS reconnect), subscribe now so
    // streaming events (transcript.delta etc.) reach it.
    let sid = &cmd.session_id;
    if !sid.is_empty() && !subscribed.contains(sid) && state.sessions.get(sid).is_some() {
        subscribe_to_session(sid, state.clone(), out_tx.clone());
        subscribed.insert(sid.clone());
        debug!(%client_id, session_id = %sid, "auto-subscribed on first command");
    }

    debug!(%client_id, cmd_id = %cmd.id, cmd_type = %cmd.cmd_type, "dispatch");
    let cmd_type = cmd.cmd_type.clone();
    let (ack, events) = dispatch_command(cmd, state.clone(), principal.cloned()).await;
    let _ = out_tx.send(serde_ack_from(ack)).await;
    for ev in events {
        // When session.create returns session.ready (or session.resume
        // returns session.resumed for the native handoff path), spawn
        // a subscriber task so subsequent broadcast events from the
        // engine reach this client live. Stage X6 batch B — native
        // resume drains the per-handle ring on dispatch return for the
        // first batch of resume lifecycle events; the auto-subscribe
        // below catches any *late* events (e.g. delayed transcript.delta
        // from the session/load fixture pump) without requiring the
        // FE to issue a follow-up command.
        let auto_subscribe = matches!(ev.event_type.as_str(), "session.ready" | "session.resumed");
        if auto_subscribe && subscribed.insert(ev.session_id.clone()) {
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

/// Phase 3 (AUDIT-014) — derive a stable principal string from the device
/// id resolved by `authenticate`. Authenticated devices become
/// `device:{device_id}`; the anonymous developer fallback (only reached
/// when `AuthState::allow_anonymous` is true) becomes `dev:anonymous`.
/// Threaded through `dispatch_command` so gate signoffs / overrides
/// record who acted instead of trusting the payload-supplied signer.
fn principal_for_device(device_id: &str) -> Option<String> {
    if device_id == "anon" {
        Some("dev:anonymous".to_string())
    } else {
        Some(format!("device:{device_id}"))
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
