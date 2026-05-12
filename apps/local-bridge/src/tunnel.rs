//! Bridge outbound-dial tunnel mode. See `docs/plans/phase-7/README.md §7.3`.
//!
//! Opens a single long-lived WebSocket to the relay, identifies as
//! `device_id`, and proxies frames between the relay and the local session
//! manager. Reconnects with exponential backoff on drop.
//!
//! AUDIT-012: the dial URL carries a short-lived HMAC-SHA256 token bound to
//! `{device_id, exp}` when `VAC_RELAY_BRIDGE_SECRET` is set. The relay (with
//! `RELAY_BRIDGE_SECRET` set to the same shared secret) verifies the token
//! before registering the bridge.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelFrame {
    pub header: TunnelHeader,
    /// Opaque JSON passthrough of the inner vac-web protocol envelope.
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelHeader {
    pub session_id: String,
    pub seq: u64,
    #[serde(rename = "dir")]
    pub direction: String,
}

#[derive(Debug, Clone)]
pub struct TunnelConfig {
    pub relay_url: String,
    pub device_id: String,
    /// HMAC-SHA256 secret used to mint `bridge_token`. When `None` no token
    /// is appended and the relay must be running with
    /// `RELAY_ALLOW_UNSIGNED_DIAL=1` for the dial to succeed.
    pub bridge_secret: Option<Vec<u8>>,
}

impl TunnelConfig {
    pub fn from_env() -> Option<Self> {
        let relay = std::env::var("VAC_RELAY_URL").ok()?;
        let device = std::env::var("VAC_DEVICE_ID")
            .unwrap_or_else(|_| format!("dev_{:x}", rand::random::<u64>()));
        let bridge_secret = std::env::var("VAC_RELAY_BRIDGE_SECRET")
            .ok()
            .filter(|s| !s.is_empty())
            .map(|s| s.into_bytes());
        if bridge_secret.is_none() {
            tracing::warn!(
                "VAC_RELAY_BRIDGE_SECRET unset -- relay dial will only succeed if the \
                 relay was started with RELAY_ALLOW_UNSIGNED_DIAL=1"
            );
        }
        Some(Self {
            relay_url: relay,
            device_id: device,
            bridge_secret,
        })
    }

    pub fn dial_url(&self) -> String {
        // Split `base` from an optional existing query string so the route
        // path lands before `?`, not after. `ws://host/path?v=1` must become
        // `ws://host/path/bridge/dial?v=1&device_id=...`.
        let (base, existing_query) = match self.relay_url.split_once('?') {
            Some((b, q)) => (b.trim_end_matches('/'), Some(q)),
            None => (self.relay_url.trim_end_matches('/'), None),
        };
        let mut query = match existing_query {
            Some(q) => format!("{q}&device_id={}", self.device_id),
            None => format!("device_id={}", self.device_id),
        };
        if let Some(secret) = self.bridge_secret.as_deref() {
            let exp = chrono::Utc::now().timestamp() + 300; // 5 min TTL
            let token = mint_dial_token(secret, &self.device_id, exp);
            query.push_str(&format!("&bridge_token={token}"));
        }
        format!("{base}/bridge/dial?{query}")
    }
}

fn mint_dial_token(secret: &[u8], device_id: &str, exp: i64) -> String {
    let payload = format!("{device_id}.{exp}");
    let sig = hmac_sha256(secret, payload.as_bytes());
    format!("{payload}.{}", hex::encode(sig))
}

fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut k = [0u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        let h = Sha256::digest(key);
        k[..32].copy_from_slice(&h);
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLOCK_SIZE];
    let mut opad = [0x5cu8; BLOCK_SIZE];
    for i in 0..BLOCK_SIZE {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(msg);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    outer.finalize().into()
}

/// Main tunnel supervisor. Reconnects with backoff on drop.
pub async fn run_tunnel_supervisor(cfg: TunnelConfig) {
    let mut backoff_ms = 500u64;
    loop {
        match run_tunnel_once(&cfg).await {
            Ok(()) => {
                tracing::info!("tunnel closed cleanly");
                backoff_ms = 500;
            }
            Err(e) => {
                tracing::warn!(error = %e, "tunnel dropped");
            }
        }
        sleep(Duration::from_millis(backoff_ms)).await;
        // Exponential with 10s ceiling per §7.3 spec.
        backoff_ms = (backoff_ms * 2).min(10_000);
    }
}

async fn run_tunnel_once(cfg: &TunnelConfig) -> anyhow::Result<()> {
    use futures::{SinkExt, StreamExt};
    let (ws, _) = tokio_tungstenite::connect_async(cfg.dial_url()).await?;
    tracing::info!(device_id = %cfg.device_id, "tunnel connected");
    let (mut tx, mut rx) = ws.split();
    while let Some(msg) = rx.next().await {
        match msg? {
            Message::Text(txt) => {
                let Ok(frame) = serde_json::from_str::<TunnelFrame>(&txt) else {
                    continue;
                };
                if frame.header.direction == "to_bridge" {
                    let reply = TunnelFrame {
                        header: TunnelHeader {
                            session_id: frame.header.session_id,
                            seq: frame.header.seq,
                            direction: "to_client".into(),
                        },
                        payload: frame.payload,
                    };
                    let encoded = serde_json::to_string(&reply)?;
                    tx.send(Message::Text(encoded)).await?;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    Ok(())
}

// TODO(phase-7.3 integration): route tunnel frames through the session
// registry so engine events flow out and client commands flow in.

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(relay: &str, device: &str) -> TunnelConfig {
        TunnelConfig {
            relay_url: relay.into(),
            device_id: device.into(),
            bridge_secret: None,
        }
    }

    #[test]
    fn dial_url_appends_device_query() {
        let c = cfg("ws://localhost:4343", "devX");
        assert_eq!(
            c.dial_url(),
            "ws://localhost:4343/bridge/dial?device_id=devX"
        );
    }

    #[test]
    fn dial_url_preserves_existing_query() {
        let c = cfg("ws://host/path?v=1", "d");
        assert_eq!(c.dial_url(), "ws://host/path/bridge/dial?v=1&device_id=d");
    }

    #[test]
    fn dial_url_trims_trailing_slash() {
        let c = cfg("ws://host/", "d");
        assert_eq!(c.dial_url(), "ws://host/bridge/dial?device_id=d");
    }

    #[test]
    fn dial_url_appends_bridge_token_when_secret_set() {
        let c = TunnelConfig {
            relay_url: "ws://localhost:4343".into(),
            device_id: "devX".into(),
            bridge_secret: Some(b"shared-test-secret-32bytes-min!!".to_vec()),
        };
        let url = c.dial_url();
        assert!(
            url.starts_with("ws://localhost:4343/bridge/dial?device_id=devX&bridge_token="),
            "unexpected url: {url}"
        );
        let token = url.split("bridge_token=").nth(1).unwrap();
        let parts: Vec<&str> = token.splitn(3, '.').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "devX");
        assert!(parts[1].parse::<i64>().is_ok());
        assert_eq!(parts[2].len(), 64);
    }

    #[test]
    fn hmac_sha256_rfc4231_case_1() {
        let key = vec![0x0bu8; 20];
        let mac = hmac_sha256(&key, b"Hi There");
        let expected_hex = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
        assert_eq!(hex::encode(mac), expected_hex);
    }
}
