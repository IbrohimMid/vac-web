//! `extensions.list` + `extensions.update_trust` handlers.

use crate::extensions::store;
use crate::server::AppStateHandle;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use profile_core::extension_trust::{
    enforce_extension_trust, EnforceContext, ExtensionEntry, ExtensionSource, ExtensionTier,
    TrustDecision,
};
use serde_json::json;

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

fn entry_payload(entry: &ExtensionEntry, decision: TrustDecision) -> serde_json::Value {
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
    let entries: Vec<serde_json::Value> = cfg
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
    _state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let extension_id = match cmd.payload.get("extension_id").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "extensions.bad_payload".into(),
                        message: "extension_id is required".into(),
                    }),
                },
                vec![],
            );
        }
    };
    let next_tier = match cmd
        .payload
        .get("tier")
        .and_then(|v| v.as_str())
        .and_then(parse_tier)
    {
        Some(t) => t,
        None => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "extensions.bad_payload".into(),
                        message:
                            "tier must be one of allowed_bundled|allowed_signed|quarantined|revoked"
                                .into(),
                    }),
                },
                vec![],
            );
        }
    };
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
    let mut updated_entry: Option<ExtensionEntry> = None;
    for e in cfg.extensions.iter_mut() {
        if e.id == extension_id {
            e.tier = next_tier;
            updated_entry = Some(e.clone());
            break;
        }
    }
    if updated_entry.is_none() {
        let new_entry = ExtensionEntry {
            id: extension_id.clone(),
            tier: next_tier,
            source: ExtensionSource::Bundled,
            publisher: None,
        };
        cfg.extensions.push(new_entry.clone());
        updated_entry = Some(new_entry);
    }
    if let Err(e) = store::save(&cfg) {
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
    let entry = updated_entry.expect("updated_entry set above");
    let ctx = EnforceContext {
        extension_id: &entry.id,
        signature_b64: None,
        publisher_pubkey_b64: entry.publisher.as_deref(),
    };
    let decision = enforce_extension_trust(&ctx, &cfg);
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
