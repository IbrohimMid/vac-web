//! `extensions.list` + `extensions.update_trust` handlers.
//!
//! Hardening 2026-05-06 (audit BLOCKER-1):
//! - `handle_update_trust` is gated by an admin token (see
//!   [`crate::extensions::admin_gate`]).
//! - Unknown extension ids return `extensions.unknown_id` instead of
//!   silently registering a new entry at the caller-supplied tier.
//! - `revoked` -> `allowed_*` transitions are rejected as
//!   `extensions.permission_denied` until a two-party approval flow
//!   ships.
//! - Every accepted or denied call writes a structured audit record
//!   with actor / extension_id / prev_tier / next_tier / decision /
//!   ts / cmd_id.

use crate::extensions::{admin_gate, store};
use crate::server::AppStateHandle;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use bridge_core::AuditSeverity;
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

fn audit_actor(cmd: &ClientCommand) -> &str {
    let s = cmd.session_id.as_str();
    if s.is_empty() {
        "anonymous"
    } else {
        s
    }
}

/// Build the audit fields recorded for every `extensions.update_trust`
/// call (success or denial). Required by audit 2026-05-06 BLOCKER-1
/// fix #3 -- ensures actor / extension_id / prev_tier / next_tier /
/// decision / ts / cmd_id are present so red-team review can detect
/// unauthorized attempts.
pub(crate) fn build_update_trust_audit(
    cmd: &ClientCommand,
    extension_id: &str,
    prev_tier: Option<ExtensionTier>,
    next_tier: Option<ExtensionTier>,
    decision: &str,
) -> Value {
    json!({
        "actor": audit_actor(cmd),
        "extension_id": extension_id,
        "prev_tier": prev_tier.map(tier_str),
        "next_tier": next_tier.map(tier_str),
        "decision": decision,
        "ts": now_iso(),
        "cmd_id": cmd.id,
    })
}

fn audit_log(state: &AppStateHandle, cmd: &ClientCommand, severity: AuditSeverity, fields: Value) {
    state
        .audit
        .log(&cmd.session_id, "extensions", severity, fields);
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
/// Pure function (no I/O, no env access). Hardening notes:
/// - Auto-insert is REMOVED; unknown ids surface as
///   [`UpdateTrustError::UnknownId`].
/// - `revoked` -> `allowed_bundled` / `allowed_signed` transitions are
///   rejected. Promoting a revoked extension requires a manual config
///   edit (and, in a future slice, two-party approval).
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
    if let Err(err) = admin_gate::check(&cmd.payload) {
        let extension_id = cmd
            .payload
            .get("extension_id")
            .and_then(|v| v.as_str())
            .unwrap_or("<unknown>");
        let next_tier = cmd
            .payload
            .get("tier")
            .and_then(|v| v.as_str())
            .and_then(parse_tier);
        audit_log(
            state,
            cmd,
            AuditSeverity::Warn,
            build_update_trust_audit(cmd, extension_id, None, next_tier, "denied"),
        );
        return (permission_denied_ack(cmd, err.message()), vec![]);
    }
    // 2. Load config.
    let mut cfg = match store::load() {
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
    // 3. Apply pure update-trust logic.
    let outcome = match apply_update_trust(&mut cfg, &cmd.payload) {
        Ok(o) => o,
        Err(UpdateTrustError::BadPayload(msg)) => {
            audit_log(
                state,
                cmd,
                AuditSeverity::Warn,
                build_update_trust_audit(
                    cmd,
                    cmd.payload
                        .get("extension_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("<missing>"),
                    None,
                    None,
                    "denied",
                ),
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
            audit_log(
                state,
                cmd,
                AuditSeverity::Warn,
                build_update_trust_audit(cmd, &id, None, None, "denied"),
            );
            return (unknown_id_ack(cmd, &id), vec![]);
        }
        Err(UpdateTrustError::DisallowedTransition {
            extension_id,
            prev,
            next,
        }) => {
            audit_log(
                state,
                cmd,
                AuditSeverity::Warn,
                build_update_trust_audit(cmd, &extension_id, Some(prev), Some(next), "denied"),
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
    // 4. Persist.
    if let Err(e) = store::save(&cfg) {
        audit_log(
            state,
            cmd,
            AuditSeverity::Error,
            build_update_trust_audit(
                cmd,
                &outcome.entry.id,
                Some(outcome.prev_tier),
                Some(outcome.next_tier),
                "save_failed",
            ),
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
    // 5. Compute decision after mutation.
    let entry = outcome.entry;
    let ctx = EnforceContext {
        extension_id: &entry.id,
        signature_b64: None,
        publisher_pubkey_b64: entry.publisher.as_deref(),
    };
    let decision = enforce_extension_trust(&ctx, &cfg);
    // 6. Audit success + emit event.
    audit_log(
        state,
        cmd,
        AuditSeverity::Info,
        build_update_trust_audit(
            cmd,
            &entry.id,
            Some(outcome.prev_tier),
            Some(outcome.next_tier),
            "allowed",
        ),
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
        // Pre-fix: missing ids were silently auto-inserted at the
        // caller-supplied tier with `source=bundled` / `publisher=None`.
        // Post-fix: the caller gets `extensions.unknown_id` and the
        // config is left untouched.
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
    fn extensions_update_trust_rejects_unauthorized_profile() {
        // Admin gate is default-deny when VAC_EXTENSIONS_ADMIN is unset
        // OR when admin_token is missing/mismatched. Exercises the
        // primitive the sessionless dispatcher relies on.
        let _g = admin_gate::testing::env_lock();
        admin_gate::testing::clear_secret();
        let payload = json!({"extension_id": "x", "tier": "allowed_signed"});
        let err = admin_gate::check(&payload).unwrap_err();
        assert!(matches!(err, admin_gate::AdminGateError::NotConfigured));
        admin_gate::testing::set_secret("super-secret");
        let payload = json!({"extension_id": "x", "tier": "allowed_signed"});
        let err = admin_gate::check(&payload).unwrap_err();
        assert!(matches!(err, admin_gate::AdminGateError::TokenMissing));
        let payload =
            json!({"extension_id": "x", "tier": "allowed_signed", "admin_token": "wrong"});
        let err = admin_gate::check(&payload).unwrap_err();
        assert!(matches!(err, admin_gate::AdminGateError::TokenMismatch));
        let payload = json!({
            "extension_id": "x",
            "tier": "allowed_signed",
            "admin_token": "super-secret"
        });
        admin_gate::check(&payload).expect("matching token");
        admin_gate::testing::clear_secret();
    }

    #[test]
    fn extensions_update_trust_emits_audit_record() {
        // Verify the audit fields shape recorded for every accepted
        // update_trust call: actor / extension_id / prev_tier /
        // next_tier / decision / ts / cmd_id (audit BLOCKER-1 fix #3).
        let cmd = ClientCommand {
            id: "cmd-42".into(),
            session_id: "session-7".into(),
            cmd_type: "extensions.update_trust".into(),
            payload: json!({}),
            v: 1,
        };
        let value = build_update_trust_audit(
            &cmd,
            "ext-1",
            Some(ExtensionTier::Quarantined),
            Some(ExtensionTier::AllowedSigned),
            "allowed",
        );
        assert_eq!(value["actor"], "session-7");
        assert_eq!(value["extension_id"], "ext-1");
        assert_eq!(value["prev_tier"], "quarantined");
        assert_eq!(value["next_tier"], "allowed_signed");
        assert_eq!(value["decision"], "allowed");
        assert_eq!(value["cmd_id"], "cmd-42");
        let ts = value["ts"].as_str().expect("ts must be a string");
        assert!(ts.len() >= 20, "ts must be RFC3339-ish, got {ts}");
        // Sessionless callers fall back to "anonymous".
        let cmd2 = fake_cmd(json!({}));
        let value = build_update_trust_audit(&cmd2, "ext-1", None, None, "denied");
        assert_eq!(value["actor"], "anonymous");
        assert!(value["prev_tier"].is_null());
        assert!(value["next_tier"].is_null());
    }

    #[test]
    fn extensions_update_trust_revoked_to_allowed_requires_approval() {
        // Auto-promoting a revoked extension back to allowed_* without
        // two-party review is the silent-rehabilitation vector the
        // auditor flagged. Reject at the pure layer; require a manual
        // config edit (or, in a future slice, an approval queue).
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
