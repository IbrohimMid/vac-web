//! Pairing + JWT minting + verification.

mod jwt;
mod pairing;

use crate::server::AppStateHandle;
use axum::{extract::State, http::StatusCode, Json};
use bridge_core::AuditSeverity;
pub use jwt::{AuthState, Claims, JwtError};
pub use pairing::PairingStore;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone, Deserialize)]
pub struct ExchangePairRequest {
    pub code: String,
    pub device_id: String,
    pub project_root: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExchangePairResponse {
    pub access_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MintPairResponse {
    pub code: String,
    pub expires_in: u64,
}

pub async fn mint_pair(
    State(state): State<AppStateHandle>,
) -> Result<Json<MintPairResponse>, (StatusCode, String)> {
    match state.pairing.mint() {
        Some(code) => {
            state.audit.log(
                "_pairing",
                "pairing",
                AuditSeverity::Info,
                json!({ "event": "mint" }),
            );
            Ok(Json(MintPairResponse {
                code,
                expires_in: 60,
            }))
        }
        None => Err((
            StatusCode::TOO_MANY_REQUESTS,
            "too many active pair codes; wait for existing ones to expire".into(),
        )),
    }
}

pub async fn exchange_pair(
    State(state): State<AppStateHandle>,
    Json(req): Json<ExchangePairRequest>,
) -> Result<Json<ExchangePairResponse>, (StatusCode, String)> {
    if !state.pairing.consume(&req.code) {
        state.audit.log(
            "_pairing",
            "pairing",
            AuditSeverity::Warn,
            json!({ "event": "exchange_denied", "device": req.device_id }),
        );
        return Err((StatusCode::UNAUTHORIZED, "invalid or expired code".into()));
    }
    let token = state
        .auth
        .mint_access(&req.device_id, &req.project_root)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    state.audit.log(
        "_pairing",
        "pairing",
        AuditSeverity::Info,
        json!({ "event": "exchange", "device": req.device_id, "project": req.project_root }),
    );
    Ok(Json(ExchangePairResponse {
        access_token: token,
        expires_in: 900,
    }))
}
