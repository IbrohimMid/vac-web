//! WebSocket endpoints: bridge dial-in, client attach.
//!
//! Frame shape over the wire:
//! ```text
//! {"header":{"device_id":"dev","session_id":"s","seq":1,"dir":"to_client"},
//!  "payload":"<base64>"}
//! ```
//! Payload is an opaque JSON string from the inner protocol; relay does not
//! parse it. This wrapping is additive over the existing WS envelope shipped
//! in Phases 1–6, per §plan 7 "transport shape".

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::Response,
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::registry::{Direction, Frame};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct BridgeDialParams {
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ClientAttachParams {
    pub device_id: String,
    pub session_id: String,
    pub token: String,
    #[serde(default)]
    pub last_event_id: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct WireFrame {
    header: FrameHeader,
    payload: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct FrameHeader {
    session_id: String,
    seq: u64,
    #[serde(rename = "dir")]
    direction: String,
}

pub async fn bridge_dial_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<BridgeDialParams>,
) -> Response {
    ws.on_upgrade(move |socket| bridge_dial_loop(socket, state, q.device_id))
}

pub async fn client_attach_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<ClientAttachParams>,
) -> Response {
    ws.on_upgrade(move |socket| client_attach_loop(socket, state, q))
}

async fn bridge_dial_loop(socket: WebSocket, state: AppState, device_id: String) {
    if state.tokens.is_revoked(&device_id) {
        tracing::warn!(%device_id, "rejected revoked bridge dial");
        return;
    }
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Frame>();
    state.registry.register_bridge(device_id.clone(), out_tx);

    let writer_device = device_id.clone();
    let writer = tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            if frame.direction != Direction::ToBridge {
                continue;
            }
            let wire = WireFrame {
                header: FrameHeader {
                    session_id: frame.session_id,
                    seq: frame.seq,
                    direction: "to_bridge".into(),
                },
                payload: String::from_utf8_lossy(&frame.payload).into_owned(),
            };
            if let Ok(text) = serde_json::to_string(&wire) {
                if ws_tx.send(Message::Text(text)).await.is_err() {
                    break;
                }
            }
        }
        tracing::debug!(%writer_device, "bridge writer exit");
    });

    while let Some(msg) = ws_rx.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let Ok(wire) = serde_json::from_str::<WireFrame>(&text) else {
                    continue;
                };
                let frame = Frame {
                    session_id: wire.header.session_id.clone(),
                    seq: wire.header.seq,
                    payload: wire.payload.into_bytes(),
                    direction: Direction::ToClient,
                };
                state
                    .registry
                    .forward_to_clients(&device_id, &wire.header.session_id, frame);
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }
    // Tell any attached clients the bridge went away so their writer tasks
    // can emit a session.disconnected envelope rather than stalling silently.
    let signal = Frame {
        session_id: String::new(),
        seq: 0,
        payload: br#"{"type":"relay.bridge_gone"}"#.to_vec(),
        direction: Direction::ToClient,
    };
    for tx in state.registry.all_client_txs_for_device(&device_id) {
        let _ = tx.send(signal.clone());
    }
    state.registry.unregister_bridge(&device_id);
    writer.abort();
    tracing::info!(%device_id, "bridge disconnected");
}

async fn client_attach_loop(socket: WebSocket, state: AppState, q: ClientAttachParams) {
    if state.tokens.is_revoked(&q.device_id) {
        tracing::warn!(device_id = %q.device_id, "rejected revoked client attach");
        return;
    }
    // Claim the token so screenshot-replay within TTL fails. `claim_by_opaque`
    // removes + rejects a second call; revoked-device check runs inside. The
    // token's bound `(device_id, session_id)` must match the query — reject
    // any smuggling attempt.
    let (mut ws_tx, mut ws_rx) = socket.split();
    match state.tokens.claim_by_opaque(&q.token) {
        Ok((dev, sess)) => {
            if dev != q.device_id || sess != q.session_id {
                tracing::warn!(token_device = %dev, query_device = %q.device_id, "token/query binding mismatch");
                let _ = ws_tx
                    .send(Message::Text(
                        r#"{"error":"token_binding_mismatch"}"#.into(),
                    ))
                    .await;
                return;
            }
        }
        Err(reason) => {
            tracing::warn!(%reason, "client attach rejected");
            let _ = ws_tx
                .send(Message::Text(format!(r#"{{"error":"{reason}"}}"#)))
                .await;
            return;
        }
    }
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Frame>();
    let attached = state
        .registry
        .attach_client(&q.device_id, q.session_id.clone(), out_tx.clone());
    if !attached {
        let _ = ws_tx
            .send(Message::Text(r#"{"error":"device_not_registered"}"#.into()))
            .await;
        return;
    }

    // If the client sent last_event_id, relay cannot replay from its own
    // buffer (blind router). Forward a synthesized control frame to the
    // bridge so it replays from its EventRing.
    if let Some(last) = q.last_event_id {
        let control = Frame {
            session_id: q.session_id.clone(),
            seq: 0,
            payload: format!(r#"{{"type":"resume","last_event_id":{last}}}"#).into_bytes(),
            direction: Direction::ToBridge,
        };
        state.registry.forward_to_bridge(&q.device_id, control);
    }

    let device_id = q.device_id.clone();
    let session_id = q.session_id.clone();
    let writer = tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            if frame.direction != Direction::ToClient {
                continue;
            }
            let wire = WireFrame {
                header: FrameHeader {
                    session_id: frame.session_id,
                    seq: frame.seq,
                    direction: "to_client".into(),
                },
                payload: String::from_utf8_lossy(&frame.payload).into_owned(),
            };
            if let Ok(text) = serde_json::to_string(&wire) {
                if ws_tx.send(Message::Text(text)).await.is_err() {
                    break;
                }
            }
        }
    });

    while let Some(msg) = ws_rx.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let Ok(wire) = serde_json::from_str::<WireFrame>(&text) else {
                    continue;
                };
                let frame = Frame {
                    session_id: wire.header.session_id,
                    seq: wire.header.seq,
                    payload: wire.payload.into_bytes(),
                    direction: Direction::ToBridge,
                };
                state.registry.forward_to_bridge(&q.device_id, frame);
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }
    state.registry.detach_clients_for(&device_id, &session_id);
    writer.abort();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::DeviceRegistry;
    use std::sync::Arc;

    #[tokio::test]
    async fn forward_to_bridge_after_register() {
        let reg = Arc::new(DeviceRegistry::new());
        let (tx, mut rx) = mpsc::unbounded_channel::<Frame>();
        reg.register_bridge("dev1".into(), tx);
        let ok = reg.forward_to_bridge(
            "dev1",
            Frame {
                session_id: "s1".into(),
                seq: 1,
                payload: b"hi".to_vec(),
                direction: Direction::ToBridge,
            },
        );
        assert!(ok);
        let frame = rx.recv().await.unwrap();
        assert_eq!(frame.seq, 1);
    }

    #[tokio::test]
    async fn forward_fanout_to_two_clients() {
        let reg = Arc::new(DeviceRegistry::new());
        let (btx, _brx) = mpsc::unbounded_channel::<Frame>();
        reg.register_bridge("dev1".into(), btx);
        let (c1, mut c1rx) = mpsc::unbounded_channel::<Frame>();
        let (c2, mut c2rx) = mpsc::unbounded_channel::<Frame>();
        assert!(reg.attach_client("dev1", "s1".into(), c1));
        assert!(reg.attach_client("dev1", "s1".into(), c2));
        reg.forward_to_clients(
            "dev1",
            "s1",
            Frame {
                session_id: "s1".into(),
                seq: 7,
                payload: b"x".to_vec(),
                direction: Direction::ToClient,
            },
        );
        assert_eq!(c1rx.recv().await.unwrap().seq, 7);
        assert_eq!(c2rx.recv().await.unwrap().seq, 7);
    }

    #[tokio::test]
    async fn detach_drops_clients() {
        let reg = Arc::new(DeviceRegistry::new());
        let (btx, _brx) = mpsc::unbounded_channel::<Frame>();
        reg.register_bridge("dev1".into(), btx);
        let (c1, _c1rx) = mpsc::unbounded_channel::<Frame>();
        assert!(reg.attach_client("dev1", "s1".into(), c1));
        reg.detach_clients_for("dev1", "s1");
        let delivered = reg.forward_to_clients(
            "dev1",
            "s1",
            Frame {
                session_id: "s1".into(),
                seq: 1,
                payload: vec![],
                direction: Direction::ToClient,
            },
        );
        assert_eq!(delivered, 0);
    }
}
