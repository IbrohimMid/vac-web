//! Pairing + JWT minting + verification.
//!
//! Slice 41 (continuation #7): emit sites migrated from raw
//! `state.audit.log(..)` to the structured `audit::log_structured`
//! adapter. Event ids (`pairing.{mint,exchange,exchange_denied}`) live
//! in `config/control-plane/event-catalog.yaml` and the namespaced
//! prefixes (`pairing.*`) are declared in
//! `schema/observability-events.yaml` + `observability::ALLOWED_NAMESPACE_PREFIXES`.

mod jwt;
mod pairing;

use crate::audit;
use crate::observability::{LogActor, LogSeverity, StructuredLogBuilder};
use crate::server::AppStateHandle;
use axum::{extract::State, http::StatusCode, Json};
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
            let _ = audit::log_structured(
                &state,
                "pairing",
                StructuredLogBuilder::new("pairing.mint", LogActor::System, LogSeverity::Info)
                    .code("ok"),
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
        let builder = StructuredLogBuilder::new(
            "pairing.exchange_denied",
            LogActor::User,
            LogSeverity::Warning,
        )
        .code("pairing.invalid_code")
        .namespaced("pairing.device", json!(req.device_id))
        .expect("pairing.device is an allowed namespaced key");
        let _ = audit::log_structured(&state, "pairing", builder);
        return Err((StatusCode::UNAUTHORIZED, "invalid or expired code".into()));
    }
    let token = state
        .auth
        .mint_access(&req.device_id, &req.project_root)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let builder = StructuredLogBuilder::new("pairing.exchange", LogActor::User, LogSeverity::Info)
        .code("ok")
        .namespaced("pairing.device", json!(req.device_id))
        .expect("pairing.device is an allowed namespaced key")
        .namespaced("pairing.project", json!(req.project_root))
        .expect("pairing.project is an allowed namespaced key");
    let _ = audit::log_structured(&state, "pairing", builder);
    Ok(Json(ExchangePairResponse {
        access_token: token,
        expires_in: 900,
    }))
}
