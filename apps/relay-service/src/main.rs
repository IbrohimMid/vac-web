//! vac-relay — blind router between outbound-dialing bridges and browser
//! clients. Routes frames by `{device_id, session_id}` header metadata only;
//! payloads pass through unchanged. Enforces short-lived bearer tokens + a
//! revocation list. See `docs/plans/phase-7/README.md` for the security model.

use anyhow::{anyhow, Result};
use axum::{routing::get, Router};
use std::net::SocketAddr;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

mod auth;
mod hmac;
mod registry;
mod route;
mod tokens;

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<registry::DeviceRegistry>,
    pub tokens: Arc<tokens::TokenStore>,
    pub security: Arc<RelaySecurity>,
}

/// Static security configuration loaded at startup (AUDIT-012).
///
/// - `admin_token`: bearer required by `/admin/*`. `None` only when the
///   operator explicitly set `RELAY_ALLOW_OPEN_ADMIN=1` (dev only).
/// - `bridge_secret`: HMAC-SHA256 key used to verify `?bridge_token=` on
///   `/bridge/dial`. `None` only when `RELAY_ALLOW_UNSIGNED_DIAL=1` (dev only).
pub struct RelaySecurity {
    pub admin_token: Option<String>,
    pub bridge_secret: Option<Vec<u8>>,
    pub allow_unsigned_dial: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let security = Arc::new(load_security_from_env()?);

    let state = AppState {
        registry: Arc::new(registry::DeviceRegistry::new()),
        tokens: Arc::new(tokens::TokenStore::new()),
        security,
    };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/bridge/dial", get(route::bridge_dial_ws))
        .route("/client/attach", get(route::client_attach_ws))
        .route("/admin/pair", get(tokens::mint_handler))
        .route("/admin/revoke", get(auth::revoke_handler))
        .with_state(state);

    let addr: SocketAddr = std::env::var("RELAY_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4343".into())
        .parse()?;
    if !addr.ip().is_loopback() {
        if !is_truthy("RELAY_ALLOW_PUBLIC_BIND") {
            return Err(anyhow!(
                "RELAY_ADDR={addr} is non-loopback. Set RELAY_ALLOW_PUBLIC_BIND=1 \
                 to explicitly allow public binding (NOT recommended for laptop installs)."
            ));
        }
        tracing::warn!(%addr, "RELAY_ADDR is non-loopback (RELAY_ALLOW_PUBLIC_BIND=1)");
    }

    tracing::info!(%addr, "vac-relay listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn load_security_from_env() -> Result<RelaySecurity> {
    let admin_token = std::env::var("RELAY_ADMIN_TOKEN")
        .ok()
        .filter(|s| !s.is_empty());
    let allow_open_admin = is_truthy("RELAY_ALLOW_OPEN_ADMIN");
    if admin_token.is_none() && !allow_open_admin {
        return Err(anyhow!(
            "RELAY_ADMIN_TOKEN must be set so /admin/pair and /admin/revoke can authenticate \
             callers. To intentionally run without admin auth (NOT for production), set \
             RELAY_ALLOW_OPEN_ADMIN=1."
        ));
    }
    if admin_token.is_none() && allow_open_admin {
        tracing::warn!("RELAY_ALLOW_OPEN_ADMIN=1 -- /admin/* endpoints unauthenticated (DEV ONLY)");
    }

    let bridge_secret = std::env::var("RELAY_BRIDGE_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
        .map(|s| s.into_bytes());
    let allow_unsigned_dial = is_truthy("RELAY_ALLOW_UNSIGNED_DIAL");
    if bridge_secret.is_none() && !allow_unsigned_dial {
        return Err(anyhow!(
            "RELAY_BRIDGE_SECRET must be set so /bridge/dial requests can be authenticated. \
             To intentionally allow unsigned dial (NOT for production), set \
             RELAY_ALLOW_UNSIGNED_DIAL=1."
        ));
    }
    if bridge_secret.is_none() && allow_unsigned_dial {
        tracing::warn!("RELAY_ALLOW_UNSIGNED_DIAL=1 -- /bridge/dial unauthenticated (DEV ONLY)");
    }

    Ok(RelaySecurity {
        admin_token,
        bridge_secret,
        allow_unsigned_dial,
    })
}

fn is_truthy(name: &str) -> bool {
    std::env::var(name)
        .map(|v| {
            let t = v.trim().to_ascii_lowercase();
            t == "1" || t == "true" || t == "yes"
        })
        .unwrap_or(false)
}
