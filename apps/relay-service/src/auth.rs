//! Auth helpers for the relay's admin surface (AUDIT-012).
//!
//! `/admin/pair` and `/admin/revoke` require a bearer token loaded from
//! `RELAY_ADMIN_TOKEN` at startup (see `main.rs`). The token may be
//! presented as `Authorization: Bearer <token>` or as `?admin_token=<token>`
//! for curl/CLI convenience. Constant-time comparison protects against
//! timing leaks.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};

use crate::hmac::ct_eq;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct RevokeParams {
    pub device_id: String,
    #[serde(default)]
    pub admin_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RevokeReply {
    pub ok: bool,
    pub device_id: String,
}

/// Validates the admin bearer presented in either header or query against
/// `state.security.admin_token`. When `admin_token` is `None` the relay was
/// started with `RELAY_ALLOW_OPEN_ADMIN=1` and the call is allowed.
#[allow(clippy::result_large_err)]
pub fn check_admin_auth(
    state: &AppState,
    headers: &HeaderMap,
    query_token: Option<&str>,
) -> Result<(), Response> {
    let Some(expected) = state.security.admin_token.as_deref() else {
        return Ok(());
    };
    let header_token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim);
    let presented = header_token.or(query_token).unwrap_or("");
    if !presented.is_empty() && ct_eq(presented.as_bytes(), expected.as_bytes()) {
        Ok(())
    } else {
        tracing::warn!("rejected admin request: invalid or missing bearer token");
        Err((StatusCode::UNAUTHORIZED, "unauthorized").into_response())
    }
}

pub async fn revoke_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<RevokeParams>,
) -> Response {
    if let Err(resp) = check_admin_auth(&state, &headers, q.admin_token.as_deref()) {
        return resp;
    }
    state.tokens.revoke_device(&q.device_id);
    state.registry.unregister_bridge(&q.device_id);
    Json(RevokeReply {
        ok: true,
        device_id: q.device_id,
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::DeviceRegistry;
    use crate::tokens::TokenStore;
    use crate::RelaySecurity;
    use std::sync::Arc;

    fn state_with_admin(token: Option<&str>) -> AppState {
        AppState {
            registry: Arc::new(DeviceRegistry::new()),
            tokens: Arc::new(TokenStore::new()),
            security: Arc::new(RelaySecurity {
                admin_token: token.map(|s| s.to_string()),
                bridge_secret: None,
                allow_unsigned_dial: true,
            }),
        }
    }

    #[test]
    fn missing_token_rejected_when_required() {
        let state = state_with_admin(Some("s3cret"));
        let headers = HeaderMap::new();
        assert!(check_admin_auth(&state, &headers, None).is_err());
    }

    #[test]
    fn header_bearer_accepted() {
        let state = state_with_admin(Some("s3cret"));
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer s3cret".parse().unwrap(),
        );
        assert!(check_admin_auth(&state, &headers, None).is_ok());
    }

    #[test]
    fn query_token_accepted() {
        let state = state_with_admin(Some("s3cret"));
        let headers = HeaderMap::new();
        assert!(check_admin_auth(&state, &headers, Some("s3cret")).is_ok());
    }

    #[test]
    fn open_admin_allows_no_token() {
        let state = state_with_admin(None);
        let headers = HeaderMap::new();
        assert!(check_admin_auth(&state, &headers, None).is_ok());
    }

    #[test]
    fn wrong_token_rejected() {
        let state = state_with_admin(Some("s3cret"));
        let headers = HeaderMap::new();
        assert!(check_admin_auth(&state, &headers, Some("nope")).is_err());
    }
}
