//! JWT minting + verification (HS256).
//!
//! Production: construct via `AuthState::new(secret)` with per-device-install
//! OS CSPRNG-generated secret persisted to `~/.config/vac-web/bridge.toml`.
//! Tests: `AuthState::new_dev()` emits a loud warning log because allowing
//! anonymous connections is ONLY acceptable in tests.

use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub iss: String,
    pub sub: String,
    pub aud: String,
    pub exp: i64,
    pub iat: i64,
    pub device_id: String,
    pub project_root: String,
}

#[derive(Debug, Error)]
pub enum JwtError {
    #[error("jwt: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

#[derive(Clone)]
pub struct AuthState {
    secret: Vec<u8>,
    iss: String,
    allow_anonymous: bool,
    pub access_ttl_s: i64,
}

impl AuthState {
    /// Production constructor. `secret` should be ≥ 32 bytes of OS randomness.
    pub fn new(secret: Vec<u8>) -> Self {
        assert!(
            secret.len() >= 32,
            "JWT secret must be at least 32 bytes; got {}",
            secret.len()
        );
        Self {
            secret,
            iss: "vac-bridge".into(),
            allow_anonymous: false,
            access_ttl_s: 900,
        }
    }

    /// Test-only constructor: 32-byte fixed secret + anonymous WS allowed.
    /// Emits a warn-level log so misuse is loud.
    pub fn new_dev() -> Self {
        warn!("AuthState::new_dev() — anonymous WS allowed; TEST USE ONLY");
        Self {
            secret: b"dev-insecure-secret-do-not-use-in-prod-32bytes!".to_vec(),
            iss: "vac-bridge".into(),
            allow_anonymous: true,
            access_ttl_s: 900,
        }
    }

    pub fn allow_anonymous(&self) -> bool {
        self.allow_anonymous
    }

    pub fn mint_access(&self, device_id: &str, project_root: &str) -> Result<String, JwtError> {
        let now = Utc::now();
        let exp = now + Duration::seconds(self.access_ttl_s);
        let claims = Claims {
            iss: self.iss.clone(),
            sub: format!("device:{device_id}"),
            aud: "vac-web".into(),
            exp: exp.timestamp(),
            iat: now.timestamp(),
            device_id: device_id.into(),
            project_root: project_root.into(),
        };
        Ok(encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(&self.secret),
        )?)
    }

    pub fn verify(&self, token: &str) -> Result<Claims, JwtError> {
        let mut validation = Validation::default();
        validation.set_audience(&["vac-web"]);
        let data = decode::<Claims>(token, &DecodingKey::from_secret(&self.secret), &validation)?;
        Ok(data.claims)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let a = AuthState::new(b"test-secret-32bytes-minimum-padding!".to_vec());
        let t = a.mint_access("d1", "/tmp/proj").unwrap();
        let c = a.verify(&t).unwrap();
        assert_eq!(c.device_id, "d1");
        assert_eq!(c.project_root, "/tmp/proj");
    }

    #[test]
    fn tampered_token_rejected() {
        let a = AuthState::new(b"s1-filler-padding-to-32-bytes-min!!".to_vec());
        let t = a.mint_access("d", "/p").unwrap();
        let mut bytes: Vec<u8> = t.bytes().collect();
        if let Some(b) = bytes.last_mut() {
            *b = b.wrapping_add(1);
        }
        let bad = String::from_utf8_lossy(&bytes).to_string();
        assert!(a.verify(&bad).is_err());
    }

    #[test]
    #[should_panic(expected = "JWT secret must be at least 32 bytes")]
    fn short_secret_panics() {
        let _ = AuthState::new(b"too-short".to_vec());
    }

    #[test]
    fn new_dev_allows_anonymous() {
        let a = AuthState::new_dev();
        assert!(a.allow_anonymous());
    }
}
