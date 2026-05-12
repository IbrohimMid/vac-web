//! TeleportToken — short-lived bearer bound to `{device_id, session_id, nonce}`.
//!
//! Production (upstream PR #10) will mint signed tokens via the bridge's
//! keyring. For now the relay mints locally as a scaffold; the shape + TTL +
//! nonce-rejection semantics are what the bridge- and web-side consumers wire
//! against, so the swap is transparent when the upstream API lands.

use axum::{
    extract::{Query, State},
    response::Json,
};
use chrono::Utc;
use dashmap::{DashMap, DashSet};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::AppState;

const TOKEN_TTL_SECS: i64 = 300; // 5 minutes, single-use on claim.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportToken {
    pub device_id: String,
    pub session_id: String,
    pub nonce: String,
    pub expires_at: String,
    pub short_code: String,
    pub opaque: String,
}

impl TeleportToken {
    pub fn is_expired(&self) -> bool {
        match chrono::DateTime::parse_from_rfc3339(&self.expires_at) {
            Ok(t) => t.with_timezone(&Utc) < Utc::now(),
            Err(_) => true,
        }
    }
}

pub struct TokenStore {
    /// Active tokens indexed by `opaque` — the only piece the client returns
    /// when attaching. Mint inserts; `claim_by_opaque` removes.
    active: DashMap<String, TeleportToken>,
    /// Nonces already claimed — prevents QR screenshot replay within the TTL.
    claimed: DashSet<String>,
    /// Revoked device ids. Cached TTL list per §plan 7.7.
    revoked: DashSet<String>,
}

impl TokenStore {
    pub fn new() -> Self {
        Self {
            active: DashMap::new(),
            claimed: DashSet::new(),
            revoked: DashSet::new(),
        }
    }

    pub fn mint(&self, device_id: &str, session_id: &str) -> TeleportToken {
        let nonce = format!("{:x}", rand::random::<u128>());
        let short_code = short_code_from(&nonce);
        let expires_at = (Utc::now() + chrono::Duration::seconds(TOKEN_TTL_SECS)).to_rfc3339();
        let opaque = {
            let mut h = Sha256::new();
            h.update(device_id.as_bytes());
            h.update(b"|");
            h.update(session_id.as_bytes());
            h.update(b"|");
            h.update(nonce.as_bytes());
            hex::encode(h.finalize())
        };
        let token = TeleportToken {
            device_id: device_id.to_string(),
            session_id: session_id.to_string(),
            nonce,
            expires_at,
            short_code,
            opaque: opaque.clone(),
        };
        self.active.insert(opaque, token.clone());
        token
    }

    /// Look up + consume by the bytes the client actually presents.
    /// Returns the bound `{device_id, session_id}` on success.
    pub fn claim_by_opaque(&self, opaque: &str) -> Result<(String, String), &'static str> {
        let Some((_, token)) = self.active.remove(opaque) else {
            return Err("token not found");
        };
        self.claim(&token)?;
        Ok((token.device_id, token.session_id))
    }

    /// Consume a token: returns Ok if it matches the expected binding and
    /// hasn't been claimed or revoked; marks it claimed on success.
    pub fn claim(&self, token: &TeleportToken) -> Result<(), &'static str> {
        if token.is_expired() {
            return Err("token expired");
        }
        if self.revoked.contains(&token.device_id) {
            return Err("device revoked");
        }
        if self.claimed.contains(&token.nonce) {
            return Err("nonce already claimed");
        }
        self.claimed.insert(token.nonce.clone());
        Ok(())
    }

    pub fn revoke_device(&self, device_id: &str) {
        self.revoked.insert(device_id.to_string());
    }

    pub fn is_revoked(&self, device_id: &str) -> bool {
        self.revoked.contains(device_id)
    }
}

impl Default for TokenStore {
    fn default() -> Self {
        Self::new()
    }
}

fn short_code_from(nonce: &str) -> String {
    // 8-char human-typable fallback per rollback plan §7.5.
    let h = Sha256::digest(nonce.as_bytes());
    let alphabet = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    (0..8)
        .map(|i| alphabet[(h[i] as usize) % alphabet.len()] as char)
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct MintParams {
    pub device_id: String,
    pub session_id: String,
    #[serde(default)]
    pub admin_token: Option<String>,
}

pub async fn mint_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(q): Query<MintParams>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Err(resp) = crate::auth::check_admin_auth(&state, &headers, q.admin_token.as_deref()) {
        return resp;
    }
    Json(state.tokens.mint(&q.device_id, &q.session_id)).into_response()
}

/// Verify a bridge dial token of the form
/// `{device_id}.{exp_unix}.{hex(hmac_sha256(secret, "device_id.exp_unix"))}`.
/// Returns Ok if well-formed, not expired, and binds to `expected_device`.
pub fn verify_bridge_dial_token(
    token: &str,
    secret: &[u8],
    expected_device: &str,
) -> Result<(), &'static str> {
    use crate::hmac::{ct_eq, hmac_sha256};
    let parts: Vec<&str> = token.splitn(3, '.').collect();
    if parts.len() != 3 {
        return Err("token_malformed");
    }
    let (device_id, exp_str, sig_hex) = (parts[0], parts[1], parts[2]);
    if device_id != expected_device {
        return Err("device_mismatch");
    }
    let exp: i64 = exp_str.parse().map_err(|_| "exp_invalid")?;
    if exp < chrono::Utc::now().timestamp() {
        return Err("token_expired");
    }
    let payload = format!("{device_id}.{exp}");
    let expected_sig = hmac_sha256(secret, payload.as_bytes());
    let presented = hex::decode(sig_hex).map_err(|_| "sig_invalid_hex")?;
    if !ct_eq(&presented, &expected_sig) {
        return Err("sig_mismatch");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_produces_valid_token() {
        let store = TokenStore::new();
        let t = store.mint("dev1", "sess1");
        assert_eq!(t.device_id, "dev1");
        assert!(!t.is_expired());
        assert_eq!(t.short_code.len(), 8);
    }

    #[test]
    fn claim_twice_fails_on_second() {
        let store = TokenStore::new();
        let t = store.mint("dev1", "sess1");
        assert!(store.claim(&t).is_ok());
        assert_eq!(store.claim(&t), Err("nonce already claimed"));
    }

    #[test]
    fn revoked_device_cannot_claim() {
        let store = TokenStore::new();
        let t = store.mint("dev1", "sess1");
        store.revoke_device("dev1");
        assert_eq!(store.claim(&t), Err("device revoked"));
    }

    #[test]
    fn claim_by_opaque_binds_to_device_and_session() {
        let store = TokenStore::new();
        let t = store.mint("devA", "sessA");
        assert_eq!(
            store.claim_by_opaque(&t.opaque).unwrap(),
            ("devA".into(), "sessA".into())
        );
    }

    #[test]
    fn claim_by_opaque_second_call_fails() {
        let store = TokenStore::new();
        let t = store.mint("dev", "sess");
        assert!(store.claim_by_opaque(&t.opaque).is_ok());
        assert_eq!(store.claim_by_opaque(&t.opaque), Err("token not found"));
    }

    #[test]
    fn claim_by_opaque_unknown_token_rejected() {
        let store = TokenStore::new();
        assert_eq!(store.claim_by_opaque("not_a_token"), Err("token not found"));
    }

    #[test]
    fn short_code_deterministic_for_nonce() {
        assert_eq!(short_code_from("nonce-a"), short_code_from("nonce-a"));
        assert_ne!(short_code_from("nonce-a"), short_code_from("nonce-b"));
    }

    #[test]
    fn verify_bridge_dial_token_round_trip() {
        let secret = b"test-bridge-secret-32bytes-min!!";
        let exp = chrono::Utc::now().timestamp() + 60;
        let payload = format!("devX.{exp}");
        let sig = hex::encode(crate::hmac::hmac_sha256(secret, payload.as_bytes()));
        let token = format!("devX.{exp}.{sig}");
        assert!(verify_bridge_dial_token(&token, secret, "devX").is_ok());
    }

    #[test]
    fn verify_bridge_dial_token_rejects_device_mismatch() {
        let secret = b"test-bridge-secret-32bytes-min!!";
        let exp = chrono::Utc::now().timestamp() + 60;
        let payload = format!("devX.{exp}");
        let sig = hex::encode(crate::hmac::hmac_sha256(secret, payload.as_bytes()));
        let token = format!("devX.{exp}.{sig}");
        assert!(verify_bridge_dial_token(&token, secret, "devY").is_err());
    }

    #[test]
    fn verify_bridge_dial_token_rejects_expired() {
        let secret = b"test-bridge-secret-32bytes-min!!";
        let exp = chrono::Utc::now().timestamp() - 60;
        let payload = format!("devX.{exp}");
        let sig = hex::encode(crate::hmac::hmac_sha256(secret, payload.as_bytes()));
        let token = format!("devX.{exp}.{sig}");
        assert!(verify_bridge_dial_token(&token, secret, "devX").is_err());
    }

    #[test]
    fn verify_bridge_dial_token_rejects_bad_sig() {
        let token = "devX.99999999999.deadbeef";
        assert!(verify_bridge_dial_token(token, b"key", "devX").is_err());
    }

    #[test]
    fn verify_bridge_dial_token_rejects_malformed() {
        assert!(verify_bridge_dial_token("not.enough", b"k", "devX").is_err());
    }
}
