//! axum app state + router construction.

use crate::audit::AuditFacility;
use crate::auth::{AuthState, PairingStore};
use crate::session::SessionRegistry;
use axum::{routing::get, routing::post, Json, Router};
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

pub type AppStateHandle = Arc<AppState>;

pub struct AppState {
    pub started_at: Instant,
    pub sessions: SessionRegistry,
    pub auth: AuthState,
    pub audit: AuditFacility,
    pub pairing: PairingStore,
    pub profile_root: std::path::PathBuf,
}

impl AppState {
    pub fn version() -> &'static str {
        env!("CARGO_PKG_VERSION")
    }
}

pub fn build_app(state: AppStateHandle) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/version", get(version))
        .route("/api/pair/mint", post(crate::auth::mint_pair))
        .route("/api/pair/exchange", post(crate::auth::exchange_pair))
        .route("/api/sessions/stream", get(crate::ws::ws_handler))
        .with_state(state)
}

async fn health(
    axum::extract::State(state): axum::extract::State<AppStateHandle>,
) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "version": AppState::version(),
        "uptime_s": state.started_at.elapsed().as_secs(),
        "sessions": state.sessions.count(),
    }))
}

async fn version() -> Json<serde_json::Value> {
    Json(json!({
        "bridge": AppState::version(),
        "protocol": "v1",
    }))
}
