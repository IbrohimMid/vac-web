//! vac-relay — blind router between outbound-dialing bridges and browser
//! clients. Routes frames by `{device_id, session_id}` header metadata only;
//! payloads pass through unchanged. Enforces short-lived bearer tokens + a
//! revocation list. See `docs/plans/phase-7/README.md` for the security model.

use anyhow::Result;
use axum::{routing::get, Router};
use std::net::SocketAddr;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

mod auth;
mod registry;
mod route;
mod tokens;

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<registry::DeviceRegistry>,
    pub tokens: Arc<tokens::TokenStore>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let state = AppState {
        registry: Arc::new(registry::DeviceRegistry::new()),
        tokens: Arc::new(tokens::TokenStore::new()),
    };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/bridge/dial", get(route::bridge_dial_ws))
        .route("/client/attach", get(route::client_attach_ws))
        .route("/admin/pair", get(tokens::mint_handler))
        .route("/admin/revoke", get(auth::revoke_handler))
        .with_state(state);

    let addr: SocketAddr = std::env::var("RELAY_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:4343".into())
        .parse()?;
    tracing::info!(%addr, "vac-relay listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
