//! Auth helpers. Revocation admin endpoint is intentionally tiny + CLI-facing;
//! there is no relay admin UI in v1 per `docs/plans/phase-7/README.md §OUT`.

use axum::{extract::{Query, State}, response::Json};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct RevokeParams {
    pub device_id: String,
}

#[derive(Debug, Serialize)]
pub struct RevokeReply {
    pub ok: bool,
    pub device_id: String,
}

pub async fn revoke_handler(
    State(state): State<AppState>,
    Query(q): Query<RevokeParams>,
) -> Json<RevokeReply> {
    state.tokens.revoke_device(&q.device_id);
    // Kick any in-flight routes for this device.
    state.registry.unregister_bridge(&q.device_id);
    Json(RevokeReply {
        ok: true,
        device_id: q.device_id,
    })
}
