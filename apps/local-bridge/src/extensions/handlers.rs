//! `extensions.list` + `extensions.update_trust` handlers.
//!
//! Hardening 2026-05-06 (audit BLOCKER-1):
//!
//! - `handle_update_trust` runs only after the profile-layer admits the
//!   command. As of Slice #4 (2026-05-07) `extensions.update_trust` is
//!   `scope: session` and routes through `profile_layer::enforce_action`,
//!   which requires the session profile's `tool_allow` to contain
//!   `extensions.update_trust`. The legacy `VAC_EXTENSIONS_ADMIN`
//!   env-var gate has been retired.
//! - Unknown extension ids return `extensions.unknown_id` instead of
//!   silently registering a new entry at the caller-supplied tier.
//! - `revoked` -> `allowed_*` transitions are rejected as
//!   `extensions.permission_denied` until a two-party approval flow
//!   ships.
//!
//! Round 2 follow-up 2026-05-07 (WARNING-B): every accepted or denied
//! call routes through [`crate::audit::log_structured`] so the audit
//! shard receives the same JSON shape the observability sink validates
//! against `schema/observability-events.yaml`.
//!
//! Catalog event ids:
//!
//! - `extensions.update_trust.allowed` (success)
//! - `extensions.update_trust.denied` (admin gate / payload / id /
//!   transition rejections)
//! - `extensions.update_trust.save_failed` (persist failure)
//!
//! All entries carry `extensions.extension_id`, `extensions.decision`,
//! and (when known) `extensions.prev_tier` / `extensions.next_tier` in
//! the namespaced section.
use crate::audit::log_structured;
use crate::extensions::store;
use crate::observability::{LogActor, LogSeverity, StructuredLogBuilder};
use crate::server::AppStateHandle;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use profile_core::extension_trust::{
    enforce_extension_trust, EnforceContext, ExtensionEntry, ExtensionSource, ExtensionTier,
    ExtensionTrustConfig, TrustDecision,
};
use serde_json::{json, Value};

fn tier_str(t: ExtensionTier) -> &'static str {
    match t {
        ExtensionTier::AllowedBundled => "allowed_bundled",
        ExtensionTier::AllowedSigned => "allowed_signed",
        ExtensionTier::Quarantined => "quarantined",
        ExtensionTier::Revoked => "revoked",
    }
}

fn source_str(s: ExtensionSource) -> &'static str {
    match s {
        ExtensionSource::Bundled => "bundled",
        ExtensionSource::Signed => "signed",
    }
}

fn decision_str(d: TrustDecision) -> &'static str {
    match d {
        TrustDecision::AllowedBundled => "allowed_bundled",
        TrustDecision::AllowedSigned => "allowed_signed",
        TrustDecision::Quarantined => "quarantined",
        TrustDecision::Revoked => "revoked",
    }
}

fn parse_tier(s: &str) -> Option<ExtensionTier> {
    match s {
        "allowed_bundled" => Some(ExtensionTier::AllowedBundled),
        "allowed_signed" => Some(ExtensionTier::AllowedSigned),
        "quarantined" => Some(ExtensionTier::Quarantined),
        "revoked" => Some(ExtensionTier::Revoked),
        _ => None,
    }
}

fn entry_payload(entry: &ExtensionEntry, decision: TrustDecision) -> Value {
    json!({
        "id": entry.id,
        "tier": tier_str(entry.tier),
        "source": source_str(entry.source),
        "publisher": entry.publisher,
        "decision": decision_str(decision),
    })
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Outcome bucket for `extensions.update_trust` audit events. Determines
/// the catalog event id, severity, and the `decision` namespaced field.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum UpdateOutcome {
    Allowed,
    Denied,
    SaveFailed,
}

impl UpdateOutcome {
    fn event_id(self) -> &'static str {
        match self {
            Self::Allowed => "extensions.update_trust.allowed",
            Self::Denied => "extensions.update_trust.denied",
            Self::SaveFailed => "extensions.update_trust.save_failed",
        }
    }
    fn severity(self) -> LogSeverity {
        match self {
            Self::Allowed => LogSeverity::Info,
            Self::Denied => LogSeverity::Warning,
            Self::SaveFailed => LogSeverity::Error,
        }
    }
    fn decision_label(self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::Denied => "denied",
            Self::SaveFailed => "save_failed",
        }
    }
}

/// Build the structured-log entry for an `extensions.update_trust`
/// outcome. Public for testing so the shape can be asserted without
/// spinning up the bridge state.
#[cfg(test)]
pub(crate) fn build_update_trust_entry(
    cmd: &ClientCommand,
    outcome: UpdateOutcome,
    code: &str,
    extension_id: &str,
    prev_tier: Option<ExtensionTier>,
    next_tier: Option<ExtensionTier>,
) -> Result<Value, crate::observability::LogValidationError> {
    let actor = if cmd.session_id.is_empty() {
        LogActor::System
    } else {
        LogActor::User
    };
    let mut b = StructuredLogBuilder::new(outcome.event_id(), actor, outcome.severity())
        .code(code)
        .command_id(cmd.id.clone());
    if !cmd.session_id.is_empty() {
        b = b.session_id(cmd.session_id.clone());
    }
    let b = b.namespaced("extensions.extension_id", extension_id.to_string())?;
    let b = b.namespaced("extensions.decision", outcome.decision_label().to_string())?;
    let b = if let Some(p) = prev_tier {
        b.namespaced("extensions.prev_tier", tier_str(p).to_string())?
    } else {
        b
    };
    let b = if let Some(n) = next_tier {
        b.namespaced("extensions.next_tier", tier_str(n).to_string())?
    } else {
        b
    };
    b.build()
}

/// Emit the structured audit entry. On schema-validation failure the
/// entry is dropped (mirrors the policy of every other
/// `log_structured` callsite in the bridge).
fn audit_update_trust(
    state: &AppStateHandle,
    cmd: &ClientCommand,
    outcome: UpdateOutcome,
    code: &str,
    extension_id: &str,
    prev_tier: Option<ExtensionTier>,
    next_tier: Option<ExtensionTier>,
) {
    let actor = if cmd.session_id.is_empty() {
        LogActor::System
    } else {
        LogActor::User
    };
    let mut b = StructuredLogBuilder::new(outcome.event_id(), actor, outcome.severity())
        .code(code)
        .command_id(cmd.id.clone());
    if !cmd.session_id.is_empty() {
        b = b.session_id(cmd.session_id.clone());
    }
    let b = match b.namespaced("extensions.extension_id", extension_id.to_string()) {
        Ok(b) => b,
        Err(_) => return,
    };
    let b = match b.namespaced("extensions.decision", outcome.decision_label().to_string()) {
        Ok(b) => b,
        Err(_) => return,
    };
    let b = if let Some(p) = prev_tier {
        match b.namespaced("extensions.prev_tier", tier_str(p).to_string()) {
            Ok(b) => b,
            Err(_) => return,
        }
    } else {
        b
    };
    let b = if let Some(n) = next_tier {
        match b.namespaced("extensions.next_tier", tier_str(n).to_string()) {
            Ok(b) => b,
            Err(_) => return,
        }
    } else {
        b
    };
    let _ = log_structured(state, "extensions", b);
}

fn permission_denied_ack(cmd: &ClientCommand, message: impl Into<String>) -> ServerAck {
    ServerAck {
        ack_of: cmd.id.clone(),
        ok: false,
        error: Some(ErrorInfo {
            code: "extensions.permission_denied".into(),
            message: message.into(),
        }),
    }
}

fn unknown_id_ack(cmd: &ClientCommand, extension_id: &str) -> ServerAck {
    ServerAck {
        ack_of: cmd.id.clone(),
        ok: false,
        error: Some(ErrorInfo {
            code: "extensions.unknown_id".into(),
            message: format!(
                "extension '{extension_id}' is not registered; \
                 add it to config/extension-trust.yaml first"
            ),
        }),
    }
}

/// Pure outcome from [`apply_update_trust`].
#[derive(Debug)]
pub(crate) struct UpdateTrustOutcome {
    pub entry: ExtensionEntry,
    pub prev_tier: ExtensionTier,
    pub next_tier: ExtensionTier,
}

/// Pure error variants from [`apply_update_trust`].
#[derive(Debug)]
pub(crate) enum UpdateTrustError {
    BadPayload(String),
    UnknownId(String),
    DisallowedTransition {
        extension_id: String,
        prev: ExtensionTier,
        next: ExtensionTier,
    },
}

/// Apply an `extensions.update_trust` payload to a mutable
/// [`ExtensionTrustConfig`].
///
/// Pure function (no I/O, no env access).
pub(crate) fn apply_update_trust(
    cfg: &mut ExtensionTrustConfig,
    payload: &Value,
) -> Result<UpdateTrustOutcome, UpdateTrustError> {
    let extension_id = match payload.get("extension_id").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => {
            return Err(UpdateTrustError::BadPayload(
                "extension_id is required".into(),
            ))
        }
    };
    let next_tier = match payload
        .get("tier")
        .and_then(|v| v.as_str())
        .and_then(parse_tier)
    {
        Some(t) => t,
        None => {
            return Err(UpdateTrustError::BadPayload(
                "tier must be one of allowed_bundled|allowed_signed|quarantined|revoked".into(),
            ))
        }
    };
    let idx = match cfg.extensions.iter().position(|e| e.id == extension_id) {
        Some(i) => i,
        None => return Err(UpdateTrustError::UnknownId(extension_id)),
    };
    let prev_tier = cfg.extensions[idx].tier;
    if matches!(prev_tier, ExtensionTier::Revoked)
        && matches!(
            next_tier,
            ExtensionTier::AllowedBundled | ExtensionTier::AllowedSigned
        )
    {
        return Err(UpdateTrustError::DisallowedTransition {
            extension_id,
            prev: prev_tier,
            next: next_tier,
        });
    }
    cfg.extensions[idx].tier = next_tier;
    Ok(UpdateTrustOutcome {
        entry: cfg.extensions[idx].clone(),
        prev_tier,
        next_tier,
    })
}

pub async fn handle_list(
    cmd: &ClientCommand,
    _state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let cfg = match store::load() {
        Ok(c) => c,
        Err(e) => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "extensions.config_load_failed".into(),
                        message: e.to_string(),
                    }),
                },
                vec![],
            );
        }
    };
    let entries: Vec<Value> = cfg
        .extensions
        .iter()
        .map(|e| {
            let ctx = EnforceContext {
                extension_id: &e.id,
                signature_b64: None,
                publisher_pubkey_b64: e.publisher.as_deref(),
            };
            let decision = enforce_extension_trust(&ctx, &cfg);
            entry_payload(e, decision)
        })
        .collect();
    let event = ServerEvent {
        seq: 0,
        session_id: cmd.session_id.clone(),
        event_type: "extensions.list_response".into(),
        payload: json!({
            "version": cfg.version,
            "allow_unsigned": cfg.allow_unsigned,
            "publishers": cfg.publishers,
            "entries": entries,
        }),
        v: 1,
        ts: now_iso(),
    };
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        vec![event],
    )
}

pub async fn handle_update_trust(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    // 1. Admin gate (audit on denial).
    // 2. Acquire exclusive lock + load config (Slice #1: TOCTOU fix).
    let mut locked = match store::LockedConfig::acquire() {
        Ok(l) => l,
        Err(e) => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "extensions.config_load_failed".into(),
                        message: e.to_string(),
                    }),
                },
                vec![],
            );
        }
    };
    // 3. Apply pure update-trust logic.
    let outcome = match apply_update_trust(&mut locked.config, &cmd.payload) {
        Ok(o) => o,
        Err(UpdateTrustError::BadPayload(msg)) => {
            audit_update_trust(
                state,
                cmd,
                UpdateOutcome::Denied,
                "extensions.bad_payload",
                cmd.payload
                    .get("extension_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("<missing>"),
                None,
                None,
            );
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "extensions.bad_payload".into(),
                        message: msg,
                    }),
                },
                vec![],
            );
        }
        Err(UpdateTrustError::UnknownId(id)) => {
            audit_update_trust(
                state,
                cmd,
                UpdateOutcome::Denied,
                "extensions.unknown_id",
                &id,
                None,
                None,
            );
            return (unknown_id_ack(cmd, &id), vec![]);
        }
        Err(UpdateTrustError::DisallowedTransition {
            extension_id,
            prev,
            next,
        }) => {
            audit_update_trust(
                state,
                cmd,
                UpdateOutcome::Denied,
                "extensions.permission_denied",
                &extension_id,
                Some(prev),
                Some(next),
            );
            return (
                permission_denied_ack(
                    cmd,
                    format!(
                        "transition {} -> {} requires two-party approval; \
                         edit config/extension-trust.yaml manually",
                        tier_str(prev),
                        tier_str(next),
                    ),
                ),
                vec![],
            );
        }
    };
    // 4. Compute decision against the locked snapshot before commit.
    let entry = outcome.entry.clone();
    let ctx = EnforceContext {
        extension_id: &entry.id,
        signature_b64: None,
        publisher_pubkey_b64: entry.publisher.as_deref(),
    };
    let decision = enforce_extension_trust(&ctx, &locked.config);
    // 5. Persist atomically (consumes the lock guard).
    if let Err(e) = locked.commit() {
        audit_update_trust(
            state,
            cmd,
            UpdateOutcome::SaveFailed,
            "extensions.config_save_failed",
            &outcome.entry.id,
            Some(outcome.prev_tier),
            Some(outcome.next_tier),
        );
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "extensions.config_save_failed".into(),
                    message: e.to_string(),
                }),
            },
            vec![],
        );
    }
    // 6. Audit success + emit event.
    audit_update_trust(
        state,
        cmd,
        UpdateOutcome::Allowed,
        "",
        &entry.id,
        Some(outcome.prev_tier),
        Some(outcome.next_tier),
    );
    let event = ServerEvent {
        seq: 0,
        session_id: cmd.session_id.clone(),
        event_type: "extensions.updated".into(),
        payload: json!({
            "entry": entry_payload(&entry, decision),
        }),
        v: 1,
        ts: now_iso(),
    };
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        vec![event],
    )
}

// ============================================================
// Slice #6 — two-party promotion approval flow
// ============================================================

use crate::extensions::approvals;

fn approval_payload(req: &approvals::ApprovalRequest) -> Value {
    let status = match req.status {
        approvals::ApprovalStatus::Pending => "pending",
        approvals::ApprovalStatus::Approved => "approved",
        approvals::ApprovalStatus::Denied => "denied",
    };
    json!({
        "request_id": req.request_id,
        "extension_id": req.extension_id,
        "requested_tier": req.requested_tier,
        "requested_by_session_id": req.requested_by_session_id,
        "requested_by_profile_id": req.requested_by_profile_id,
        "created_at": req.created_at,
        "status": status,
        "decided_at": req.decided_at,
        "decided_by_session_id": req.decided_by_session_id,
        "decided_by_profile_id": req.decided_by_profile_id,
    })
}

fn ack_err(cmd: &ClientCommand, code: &str, message: impl Into<String>) -> ServerAck {
    ServerAck {
        ack_of: cmd.id.clone(),
        ok: false,
        error: Some(ErrorInfo {
            code: code.into(),
            message: message.into(),
        }),
    }
}

fn ack_ok(cmd: &ClientCommand) -> ServerAck {
    ServerAck {
        ack_of: cmd.id.clone(),
        ok: true,
        error: None,
    }
}

fn approval_audit(
    state: &AppStateHandle,
    cmd: &ClientCommand,
    event_id: &str,
    code: &str,
    severity: LogSeverity,
    namespaced: &[(&str, String)],
) {
    let actor = if cmd.session_id.is_empty() {
        LogActor::System
    } else {
        LogActor::User
    };
    let mut b = StructuredLogBuilder::new(event_id, actor, severity)
        .code(code)
        .command_id(cmd.id.clone());
    if !cmd.session_id.is_empty() {
        b = b.session_id(cmd.session_id.clone());
    }
    for (k, v) in namespaced {
        b = match b.namespaced(*k, v.clone()) {
            Ok(nb) => nb,
            Err(_) => return,
        };
    }
    let _ = log_structured(state, "extensions", b);
}

fn session_profile_id(state: &AppStateHandle, session_id: &str) -> Option<String> {
    if session_id.is_empty() {
        return None;
    }
    state.sessions.get(session_id).map(|h| h.profile_id.clone())
}

/// Pure helper: apply a promotion (`revoked` -> `allowed_*`) bypassing the
/// transition rejection in [`apply_update_trust`]. Used by the approve
/// path after two-party validation.
pub(crate) fn apply_promotion_with_approval(
    cfg: &mut ExtensionTrustConfig,
    extension_id: &str,
    next_tier: ExtensionTier,
) -> Result<UpdateTrustOutcome, UpdateTrustError> {
    let idx = cfg
        .extensions
        .iter()
        .position(|e| e.id == extension_id)
        .ok_or_else(|| UpdateTrustError::UnknownId(extension_id.to_string()))?;
    let prev_tier = cfg.extensions[idx].tier;
    cfg.extensions[idx].tier = next_tier;
    Ok(UpdateTrustOutcome {
        entry: cfg.extensions[idx].clone(),
        prev_tier,
        next_tier,
    })
}

pub async fn handle_request_promotion(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let extension_id = match cmd.payload.get("extension_id").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => {
            approval_audit(
                state,
                cmd,
                "extensions.promotion_requested",
                "extensions.bad_payload",
                LogSeverity::Warning,
                &[("extensions.decision", "denied".into())],
            );
            return (
                ack_err(cmd, "extensions.bad_payload", "extension_id is required"),
                vec![],
            );
        }
    };
    let target_tier_str = match cmd.payload.get("target_tier").and_then(|v| v.as_str()) {
        Some(s) if matches!(s, "allowed_bundled" | "allowed_signed") => s.to_string(),
        _ => {
            approval_audit(
                state,
                cmd,
                "extensions.promotion_requested",
                "extensions.bad_payload",
                LogSeverity::Warning,
                &[
                    ("extensions.extension_id", extension_id.clone()),
                    ("extensions.decision", "denied".into()),
                ],
            );
            return (
                ack_err(
                    cmd,
                    "extensions.bad_payload",
                    "target_tier must be allowed_bundled|allowed_signed",
                ),
                vec![],
            );
        }
    };
    let cfg = match store::load() {
        Ok(c) => c,
        Err(e) => {
            return (
                ack_err(cmd, "extensions.config_load_failed", e.to_string()),
                vec![],
            );
        }
    };
    let entry = match cfg.extensions.iter().find(|e| e.id == extension_id) {
        Some(e) => e.clone(),
        None => {
            approval_audit(
                state,
                cmd,
                "extensions.promotion_requested",
                "extensions.unknown_id",
                LogSeverity::Warning,
                &[
                    ("extensions.extension_id", extension_id.clone()),
                    ("extensions.decision", "denied".into()),
                ],
            );
            return (unknown_id_ack(cmd, &extension_id), vec![]);
        }
    };
    if !matches!(entry.tier, ExtensionTier::Revoked) {
        approval_audit(
            state,
            cmd,
            "extensions.promotion_requested",
            "extensions.target_not_revoked",
            LogSeverity::Warning,
            &[
                ("extensions.extension_id", extension_id.clone()),
                ("extensions.decision", "denied".into()),
                ("extensions.prev_tier", tier_str(entry.tier).into()),
            ],
        );
        return (
            ack_err(
                cmd,
                "extensions.target_not_revoked",
                format!(
                    "extension '{extension_id}' is currently {} (only revoked extensions can be promoted)",
                    tier_str(entry.tier)
                ),
            ),
            vec![],
        );
    }
    let requester_profile_id = match session_profile_id(state, &cmd.session_id) {
        Some(p) => p,
        None => {
            return (
                ack_err(
                    cmd,
                    "extensions.permission_denied",
                    "no active session for requester",
                ),
                vec![],
            );
        }
    };
    let mut locked = match approvals::LockedApprovals::acquire() {
        Ok(l) => l,
        Err(e) => {
            return (
                ack_err(cmd, "extensions.config_load_failed", e.to_string()),
                vec![],
            )
        }
    };
    let req = approvals::ApprovalRequest {
        request_id: approvals::new_request_id(),
        extension_id: extension_id.clone(),
        requested_tier: target_tier_str.clone(),
        requested_by_session_id: cmd.session_id.clone(),
        requested_by_profile_id: requester_profile_id.clone(),
        created_at: now_iso(),
        status: approvals::ApprovalStatus::Pending,
        decided_at: None,
        decided_by_session_id: None,
        decided_by_profile_id: None,
    };
    locked.config.requests.push(req.clone());
    if let Err(e) = locked.commit() {
        approval_audit(
            state,
            cmd,
            "extensions.promotion_requested",
            "extensions.config_save_failed",
            LogSeverity::Error,
            &[
                ("extensions.extension_id", extension_id.clone()),
                ("extensions.decision", "save_failed".into()),
            ],
        );
        return (
            ack_err(cmd, "extensions.config_save_failed", e.to_string()),
            vec![],
        );
    }
    approval_audit(
        state,
        cmd,
        "extensions.promotion_requested",
        "",
        LogSeverity::Info,
        &[
            ("extensions.extension_id", extension_id.clone()),
            ("extensions.decision", "pending".into()),
            ("extensions.request_id", req.request_id.clone()),
            ("extensions.requested_tier", target_tier_str.clone()),
            ("extensions.prev_tier", tier_str(entry.tier).into()),
        ],
    );
    let event = ServerEvent {
        seq: 0,
        session_id: cmd.session_id.clone(),
        event_type: "extensions.promotion_requested".into(),
        payload: json!({ "request": approval_payload(&req) }),
        v: 1,
        ts: now_iso(),
    };
    (ack_ok(cmd), vec![event])
}

pub async fn handle_approve_promotion(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let request_id = match cmd.payload.get("request_id").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => {
            return (
                ack_err(cmd, "extensions.bad_payload", "request_id is required"),
                vec![],
            )
        }
    };
    let approver_profile_id = match session_profile_id(state, &cmd.session_id) {
        Some(p) => p,
        None => {
            return (
                ack_err(
                    cmd,
                    "extensions.permission_denied",
                    "no active session for approver",
                ),
                vec![],
            )
        }
    };
    let mut locked_appr = match approvals::LockedApprovals::acquire() {
        Ok(l) => l,
        Err(e) => {
            return (
                ack_err(cmd, "extensions.config_load_failed", e.to_string()),
                vec![],
            )
        }
    };
    let idx = match locked_appr
        .config
        .requests
        .iter()
        .position(|r| r.request_id == request_id)
    {
        Some(i) => i,
        None => {
            approval_audit(
                state,
                cmd,
                "extensions.promotion_denied",
                "extensions.approval_not_found",
                LogSeverity::Warning,
                &[
                    ("extensions.decision", "denied".into()),
                    ("extensions.request_id", request_id.clone()),
                ],
            );
            return (
                ack_err(
                    cmd,
                    "extensions.approval_not_found",
                    format!("approval '{request_id}' not found"),
                ),
                vec![],
            );
        }
    };
    let req_snapshot = locked_appr.config.requests[idx].clone();
    if !matches!(req_snapshot.status, approvals::ApprovalStatus::Pending) {
        return (
            ack_err(cmd, "extensions.bad_payload", "request is not pending"),
            vec![],
        );
    }
    if approver_profile_id == req_snapshot.requested_by_profile_id {
        approval_audit(
            state,
            cmd,
            "extensions.promotion_denied",
            "extensions.approver_is_requester",
            LogSeverity::Warning,
            &[
                ("extensions.decision", "denied".into()),
                ("extensions.request_id", request_id.clone()),
                ("extensions.extension_id", req_snapshot.extension_id.clone()),
            ],
        );
        return (
            ack_err(
                cmd,
                "extensions.approver_is_requester",
                "approver must have a different profile than the requester",
            ),
            vec![],
        );
    }
    let next_tier = match parse_tier(&req_snapshot.requested_tier) {
        Some(t) => t,
        None => {
            return (
                ack_err(
                    cmd,
                    "extensions.bad_payload",
                    "stored requested_tier is invalid",
                ),
                vec![],
            )
        }
    };
    let mut locked_trust = match store::LockedConfig::acquire() {
        Ok(l) => l,
        Err(e) => {
            return (
                ack_err(cmd, "extensions.config_load_failed", e.to_string()),
                vec![],
            )
        }
    };
    let outcome = match apply_promotion_with_approval(
        &mut locked_trust.config,
        &req_snapshot.extension_id,
        next_tier,
    ) {
        Ok(o) => o,
        Err(UpdateTrustError::UnknownId(id)) => {
            return (unknown_id_ack(cmd, &id), vec![]);
        }
        Err(_) => {
            return (
                ack_err(
                    cmd,
                    "extensions.bad_payload",
                    "internal: unexpected promotion error",
                ),
                vec![],
            );
        }
    };
    let entry = outcome.entry.clone();
    let ctx = EnforceContext {
        extension_id: &entry.id,
        signature_b64: None,
        publisher_pubkey_b64: entry.publisher.as_deref(),
    };
    let decision = enforce_extension_trust(&ctx, &locked_trust.config);
    if let Err(e) = locked_trust.commit() {
        approval_audit(
            state,
            cmd,
            "extensions.promotion_approved",
            "extensions.config_save_failed",
            LogSeverity::Error,
            &[
                ("extensions.extension_id", entry.id.clone()),
                ("extensions.request_id", request_id.clone()),
                ("extensions.decision", "save_failed".into()),
            ],
        );
        return (
            ack_err(cmd, "extensions.config_save_failed", e.to_string()),
            vec![],
        );
    }
    locked_appr.config.requests[idx].status = approvals::ApprovalStatus::Approved;
    locked_appr.config.requests[idx].decided_at = Some(now_iso());
    locked_appr.config.requests[idx].decided_by_session_id = Some(cmd.session_id.clone());
    locked_appr.config.requests[idx].decided_by_profile_id = Some(approver_profile_id.clone());
    let approved_req = locked_appr.config.requests[idx].clone();
    if let Err(e) = locked_appr.commit() {
        return (
            ack_err(cmd, "extensions.config_save_failed", e.to_string()),
            vec![],
        );
    }
    approval_audit(
        state,
        cmd,
        "extensions.promotion_approved",
        "",
        LogSeverity::Info,
        &[
            ("extensions.extension_id", entry.id.clone()),
            ("extensions.request_id", request_id.clone()),
            ("extensions.decision", "allowed".into()),
            ("extensions.prev_tier", tier_str(outcome.prev_tier).into()),
            ("extensions.next_tier", tier_str(outcome.next_tier).into()),
        ],
    );
    let approved_event = ServerEvent {
        seq: 0,
        session_id: cmd.session_id.clone(),
        event_type: "extensions.promotion_approved".into(),
        payload: json!({ "request": approval_payload(&approved_req) }),
        v: 1,
        ts: now_iso(),
    };
    let updated_event = ServerEvent {
        seq: 0,
        session_id: cmd.session_id.clone(),
        event_type: "extensions.updated".into(),
        payload: json!({ "entry": entry_payload(&entry, decision) }),
        v: 1,
        ts: now_iso(),
    };
    (ack_ok(cmd), vec![approved_event, updated_event])
}

pub async fn handle_list_approvals(
    cmd: &ClientCommand,
    _state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let cfg = match approvals::load() {
        Ok(c) => c,
        Err(e) => {
            return (
                ack_err(cmd, "extensions.config_load_failed", e.to_string()),
                vec![],
            )
        }
    };
    let payload = json!({
        "requests": cfg.requests.iter().map(approval_payload).collect::<Vec<_>>()
    });
    let event = ServerEvent {
        seq: 0,
        session_id: cmd.session_id.clone(),
        event_type: "extensions.approvals_list_response".into(),
        payload,
        v: 1,
        ts: now_iso(),
    };
    (ack_ok(cmd), vec![event])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, tier: ExtensionTier, source: ExtensionSource) -> ExtensionEntry {
        ExtensionEntry {
            id: id.into(),
            tier,
            source,
            publisher: None,
        }
    }

    fn cfg_with(entries: Vec<ExtensionEntry>) -> ExtensionTrustConfig {
        let mut cfg = ExtensionTrustConfig::empty();
        cfg.extensions = entries;
        cfg
    }

    fn fake_cmd(payload: Value) -> ClientCommand {
        ClientCommand {
            id: "cmd-1".into(),
            session_id: String::new(),
            cmd_type: "extensions.update_trust".into(),
            payload,
            v: 1,
        }
    }

    #[test]
    fn extensions_update_trust_rejects_unknown_id_in_strict_mode() {
        let mut cfg = cfg_with(vec![entry(
            "real-ext",
            ExtensionTier::AllowedBundled,
            ExtensionSource::Bundled,
        )]);
        let payload = json!({"extension_id": "ghost", "tier": "allowed_signed"});
        let err = apply_update_trust(&mut cfg, &payload).unwrap_err();
        match err {
            UpdateTrustError::UnknownId(id) => assert_eq!(id, "ghost"),
            other => panic!("expected UnknownId, got {other:?}"),
        }
        assert_eq!(cfg.extensions.len(), 1, "config must not be mutated");
        assert_eq!(cfg.extensions[0].id, "real-ext");
        assert!(matches!(
            cfg.extensions[0].tier,
            ExtensionTier::AllowedBundled
        ));
    }

    #[test]
    fn extensions_update_trust_emits_structured_audit_record() {
        // Round 2 follow-up: verify the structured-log entry shape
        // recorded for every accepted update_trust call. The entry is
        // built via `crate::observability::StructuredLogBuilder` and
        // routed through `crate::audit::log_structured`, so the JSON
        // shape is what the audit shard sees.
        let cmd = ClientCommand {
            id: "cmd-42".into(),
            session_id: "session-7".into(),
            cmd_type: "extensions.update_trust".into(),
            payload: json!({}),
            v: 1,
        };
        let value = build_update_trust_entry(
            &cmd,
            UpdateOutcome::Allowed,
            "",
            "ext-1",
            Some(ExtensionTier::Quarantined),
            Some(ExtensionTier::AllowedSigned),
        )
        .expect("build ok");
        assert_eq!(value["event"], "extensions.update_trust.allowed");
        assert_eq!(value["actor"], "user");
        assert_eq!(value["severity"], "info");
        assert_eq!(value["session_id"], "session-7");
        assert_eq!(value["command_id"], "cmd-42");
        assert_eq!(value["extensions.extension_id"], "ext-1");
        assert_eq!(value["extensions.decision"], "allowed");
        assert_eq!(value["extensions.prev_tier"], "quarantined");
        assert_eq!(value["extensions.next_tier"], "allowed_signed");
        // Sessionless callers fall back to system actor + null session_id.
        let cmd2 = fake_cmd(json!({}));
        let value = build_update_trust_entry(
            &cmd2,
            UpdateOutcome::Denied,
            "extensions.permission_denied",
            "ext-1",
            None,
            None,
        )
        .expect("build ok");
        assert_eq!(value["event"], "extensions.update_trust.denied");
        assert_eq!(value["actor"], "system");
        assert_eq!(value["severity"], "warning");
        assert!(value["session_id"].is_null());
        assert_eq!(value["code"], "extensions.permission_denied");
        assert_eq!(value["extensions.decision"], "denied");
        assert!(value.get("extensions.prev_tier").is_none());
        assert!(value.get("extensions.next_tier").is_none());
    }

    #[test]
    fn extensions_update_trust_revoked_to_allowed_requires_approval() {
        let mut cfg = cfg_with(vec![entry(
            "evil",
            ExtensionTier::Revoked,
            ExtensionSource::Bundled,
        )]);
        let payload = json!({"extension_id": "evil", "tier": "allowed_signed"});
        let err = apply_update_trust(&mut cfg, &payload).unwrap_err();
        match err {
            UpdateTrustError::DisallowedTransition {
                extension_id,
                prev,
                next,
            } => {
                assert_eq!(extension_id, "evil");
                assert!(matches!(prev, ExtensionTier::Revoked));
                assert!(matches!(next, ExtensionTier::AllowedSigned));
            }
            other => panic!("expected DisallowedTransition, got {other:?}"),
        }
        assert!(matches!(cfg.extensions[0].tier, ExtensionTier::Revoked));
        let payload = json!({"extension_id": "evil", "tier": "allowed_bundled"});
        let err = apply_update_trust(&mut cfg, &payload).unwrap_err();
        assert!(matches!(err, UpdateTrustError::DisallowedTransition { .. }));
        // Lateral revoked -> quarantined IS allowed (cleanup path).
        let payload = json!({"extension_id": "evil", "tier": "quarantined"});
        let outcome = apply_update_trust(&mut cfg, &payload).expect("revoked -> quarantined ok");
        assert!(matches!(outcome.next_tier, ExtensionTier::Quarantined));
        assert!(matches!(outcome.prev_tier, ExtensionTier::Revoked));
    }
}
