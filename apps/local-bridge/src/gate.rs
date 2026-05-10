use crate::audit::log_tool_event;
use crate::server::AppStateHandle;
use crate::session::handle::SessionHandleRef;
use crate::session::persistence::{PersistedServerEvent, SessionPersistence};
use crate::translator::emit_session_event;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex as StdMutex};
use tracing::warn;

const DEFAULT_OVERRIDE_DAYS: i64 = 7;

pub const KNOWN_GATES: &[&str] = &[
    "DevComplete",
    "QAComplete",
    "ReadyForStaging",
    "ReadyToDeploy",
    "ReadyToPublish",
    "ReadyForGrowth",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateCriterion {
    pub id: String,
    pub label: String,
    pub satisfied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateSigner {
    pub name: String,
    pub signed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateSnapshot {
    pub id: String,
    pub state: String,
    pub summary: String,
    #[serde(default)]
    pub blockers: Vec<String>,
    #[serde(default)]
    pub criteria: Vec<GateCriterion>,
    #[serde(default)]
    pub signers: Vec<GateSigner>,
    pub required_signers: usize,
    pub overridden: bool,
    pub last_changed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub override_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub override_expires_at: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SessionGateState {
    gates: BTreeMap<String, GateSnapshot>,
}

impl SessionGateState {
    pub fn from_events(events: &[PersistedServerEvent]) -> Self {
        let mut state = Self::default();
        for ev in events {
            if ev.event_type.starts_with("gate.") {
                if let Some(snapshot) = snapshot_from_payload(&ev.payload) {
                    state.gates.insert(snapshot.id.clone(), snapshot);
                }
            }
        }
        state
    }

    pub fn get(&self, gate_id: &str) -> Option<GateSnapshot> {
        self.gates.get(gate_id).cloned()
    }

    pub fn ensure_known(&mut self, gate_id: &str) -> Option<&mut GateSnapshot> {
        if !KNOWN_GATES.contains(&gate_id) {
            return None;
        }
        if !self.gates.contains_key(gate_id) {
            self.gates
                .insert(gate_id.to_string(), default_gate_snapshot(gate_id));
        }
        self.gates.get_mut(gate_id)
    }

    pub fn upsert(&mut self, snapshot: GateSnapshot) {
        self.gates.insert(snapshot.id.clone(), snapshot);
    }

    pub fn ready_for_target(&self, target_environment: &str) -> (bool, Vec<String>) {
        let required = required_gate_ids_for_environment(target_environment);
        missing_gate_ids(self, required)
    }

    pub fn emit_known_defaults(&mut self) {
        for gate_id in KNOWN_GATES {
            self.gates
                .entry((*gate_id).to_string())
                .or_insert_with(|| default_gate_snapshot(gate_id));
        }
    }
}

pub fn build_session_gate_state(
    persistence: Option<&Arc<dyn SessionPersistence>>,
    session_id: &str,
) -> Arc<StdMutex<SessionGateState>> {
    let mut state = SessionGateState::default();
    if let Some(persistence) = persistence {
        match persistence.load_events(session_id, 0) {
            Ok(events) => state = SessionGateState::from_events(&events),
            Err(err) => {
                warn!(session = %session_id, error = %err, "failed to restore gate state from persistence")
            }
        }
    }
    Arc::new(StdMutex::new(state))
}

pub fn required_gate_ids_for_environment(environment: &str) -> Vec<&'static str> {
    match environment {
        "staging" => vec!["DevComplete", "ReadyToDeploy", "ReadyForStaging"],
        _ => vec!["DevComplete", "ReadyToDeploy"],
    }
}

pub fn required_publish_gate_ids() -> Vec<&'static str> {
    vec!["ReadyToPublish"]
}

pub fn missing_gate_ids(
    state: &SessionGateState,
    required: Vec<&'static str>,
) -> (bool, Vec<String>) {
    let missing: Vec<String> = required
        .into_iter()
        .filter(|gate_id| state.gates.get(*gate_id).map(gate_is_effectively_pass) != Some(true))
        .map(str::to_string)
        .collect();
    (missing.is_empty(), missing)
}

fn gate_is_effectively_pass(snapshot: &GateSnapshot) -> bool {
    if snapshot.overridden {
        let Some(expiry) = snapshot.override_expires_at.as_deref() else {
            return true;
        };
        let Ok(expiry_dt) = DateTime::parse_from_rfc3339(expiry) else {
            return false;
        };
        return expiry_dt.with_timezone(&Utc) > Utc::now();
    }
    snapshot.state.as_str() == "pass"
}

fn override_is_expired(snapshot: &GateSnapshot) -> bool {
    if !snapshot.overridden {
        return false;
    }
    let Some(expiry) = snapshot.override_expires_at.as_deref() else {
        return false;
    };
    let Ok(expiry_dt) = DateTime::parse_from_rfc3339(expiry) else {
        return false;
    };
    expiry_dt.with_timezone(&Utc) <= Utc::now()
}

fn default_gate_snapshot(gate_id: &str) -> GateSnapshot {
    let required_signers = if gate_id == "ReadyToDeploy" || gate_id == "ReadyToPublish" {
        2
    } else {
        1
    };
    let mut snapshot = GateSnapshot {
        id: gate_id.to_string(),
        state: "open".into(),
        summary: String::new(),
        blockers: Vec::new(),
        criteria: Vec::new(),
        signers: Vec::new(),
        required_signers,
        overridden: false,
        last_changed_at: now_iso(),
        override_reason: None,
        override_expires_at: None,
    };
    touch_gate(&mut snapshot);
    snapshot
}

fn snapshot_from_payload(payload: &serde_json::Value) -> Option<GateSnapshot> {
    let id = payload.get("id").and_then(|v| v.as_str())?.to_string();
    let state = payload
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("open")
        .to_string();
    let summary = payload
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let blockers = payload
        .get("blockers")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let criteria = payload
        .get("criteria")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").and_then(|v| v.as_str())?.to_string();
                    let label = item.get("label").and_then(|v| v.as_str())?.to_string();
                    let satisfied = item
                        .get("satisfied")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    Some(GateCriterion {
                        id,
                        label,
                        satisfied,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let signers = payload
        .get("signers")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name").and_then(|v| v.as_str())?.to_string();
                    let signed_at = item.get("signed_at").and_then(|v| v.as_str())?.to_string();
                    Some(GateSigner { name, signed_at })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let required_signers = payload
        .get("required_signers")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as usize;
    let overridden = payload
        .get("overridden")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let last_changed_at = payload
        .get("last_changed_at")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(now_iso);
    let override_reason = payload
        .get("override_reason")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let override_expires_at = payload
        .get("override_expires_at")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Some(GateSnapshot {
        id,
        state,
        summary,
        blockers,
        criteria,
        signers,
        required_signers,
        overridden,
        last_changed_at,
        override_reason,
        override_expires_at,
    })
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn default_expiry_iso() -> String {
    (Utc::now() + Duration::days(DEFAULT_OVERRIDE_DAYS)).to_rfc3339()
}

fn parse_expiry(raw: Option<&str>) -> Result<String, &'static str> {
    match raw {
        None => Ok(default_expiry_iso()),
        Some(s) if s.trim().is_empty() => Ok(default_expiry_iso()),
        Some(s) => {
            let parsed = DateTime::parse_from_rfc3339(s).map_err(|_| "gate.expiry_required")?;
            if parsed.with_timezone(&Utc) <= Utc::now() {
                return Err("gate.expiry_in_past");
            }
            Ok(parsed.with_timezone(&Utc).to_rfc3339())
        }
    }
}

fn touch_gate(snapshot: &mut GateSnapshot) {
    if let Some(expiry) = snapshot.override_expires_at.as_deref() {
        if let Ok(expiry_dt) = DateTime::parse_from_rfc3339(expiry) {
            if expiry_dt.with_timezone(&Utc) <= Utc::now() {
                snapshot.overridden = false;
                snapshot.override_reason = None;
                snapshot.override_expires_at = None;
            }
        }
    }
    let signed = snapshot.signers.len();
    let required = snapshot.required_signers.max(1);
    let satisfied = snapshot.overridden || signed >= required;
    snapshot.state = if satisfied {
        "pass".into()
    } else {
        "open".into()
    };
    snapshot.criteria = vec![GateCriterion {
        id: "signoffs_complete".into(),
        label: if required == 1 {
            "1 sign-off required".into()
        } else {
            format!("{required} sign-offs required")
        },
        satisfied,
    }];
    snapshot.blockers = if satisfied {
        Vec::new()
    } else {
        vec![if required == 1 {
            "Awaiting 1 sign-off".into()
        } else {
            let missing = required.saturating_sub(signed);
            format!("Awaiting {missing} more sign-off(s)")
        }]
    };
    snapshot.summary = if snapshot.overridden {
        snapshot
            .override_reason
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|reason| format!("override: {reason}"))
            .unwrap_or_else(|| "override active".into())
    } else if satisfied {
        if signed == 0 {
            "Gate approved".into()
        } else {
            format!("Approved with {signed} sign-off(s)")
        }
    } else if required == 1 {
        "Awaiting sign-off".into()
    } else {
        let missing = required.saturating_sub(signed);
        format!("Awaiting {missing} sign-off(s)")
    };
    snapshot.last_changed_at = now_iso();
}

fn error_ack(
    cmd: &ClientCommand,
    code: &'static str,
    message: impl Into<String>,
) -> (ServerAck, Vec<ServerEvent>) {
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: false,
            error: Some(ErrorInfo {
                code: code.into(),
                message: message.into(),
            }),
        },
        Vec::new(),
    )
}

fn ok_ack(cmd: &ClientCommand) -> (ServerAck, Vec<ServerEvent>) {
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        Vec::new(),
    )
}

fn gate_snapshot_event(session_id: String, snapshot: &GateSnapshot) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id,
        event_type: "gate.changed".into(),
        payload: json!({
            "id": snapshot.id,
            "state": snapshot.state,
            "summary": snapshot.summary,
            "blockers": snapshot.blockers,
            "criteria": snapshot.criteria,
            "signers": snapshot.signers,
            "required_signers": snapshot.required_signers,
            "overridden": snapshot.overridden,
            "last_changed_at": snapshot.last_changed_at,
            "override_reason": snapshot.override_reason,
            "override_expires_at": snapshot.override_expires_at,
        }),
        v: 1,
        ts: now_iso(),
    }
}

pub async fn handle_evaluate(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(handle) = state.sessions.get(&cmd.session_id) else {
        return error_ack(
            cmd,
            "session.not_found",
            format!("session {} not found", cmd.session_id),
        );
    };
    let gate_id = cmd
        .payload
        .get("gate")
        .and_then(|v| v.as_str())
        .or_else(|| cmd.payload.get("id").and_then(|v| v.as_str()))
        .unwrap_or("")
        .trim()
        .to_string();
    if gate_id.is_empty() {
        return error_ack(cmd, "gate.not_found", "gate id is required");
    }
    let snapshot = {
        let mut guard = match handle.gate_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return error_ack(cmd, "persistence.write_failed", "gate state lock poisoned");
            }
        };
        let Some(snapshot) = guard.ensure_known(&gate_id) else {
            return error_ack(cmd, "gate.not_found", format!("gate {gate_id} not found"));
        };
        if override_is_expired(snapshot) {
            snapshot.overridden = false;
            snapshot.override_reason = None;
            snapshot.override_expires_at = None;
            touch_gate(snapshot);
        }
        snapshot.clone()
    };
    log_tool_event(
        state,
        &cmd.session_id,
        "gate",
        json!({
            "command": "gate.evaluate",
            "gate_id": gate_id,
            "decision": "allow",
        }),
    );
    let event = gate_snapshot_event(handle.id.clone(), &snapshot);
    emit_session_event(&handle, event).await;
    ok_ack(cmd)
}

pub async fn handle_signoff(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(handle) = state.sessions.get(&cmd.session_id) else {
        return error_ack(
            cmd,
            "session.not_found",
            format!("session {} not found", cmd.session_id),
        );
    };
    let gate_id = cmd
        .payload
        .get("id")
        .or_else(|| cmd.payload.get("gate_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if gate_id.is_empty() {
        return error_ack(cmd, "gate.not_found", "gate id is required");
    }
    let signer = cmd
        .payload
        .get("signer")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("anonymous")
        .to_string();
    let snapshot = {
        let mut guard = match handle.gate_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return error_ack(cmd, "persistence.write_failed", "gate state lock poisoned")
            }
        };
        let Some(snapshot) = guard.ensure_known(&gate_id) else {
            return error_ack(cmd, "gate.not_found", format!("gate {gate_id} not found"));
        };
        if !snapshot.signers.iter().any(|s| s.name == signer) {
            snapshot.signers.push(GateSigner {
                name: signer.clone(),
                signed_at: now_iso(),
            });
        }
        touch_gate(snapshot);
        snapshot.clone()
    };
    log_tool_event(
        state,
        &cmd.session_id,
        "gate",
        json!({
            "command": "gate.signoff",
            "gate_id": gate_id,
            "signer": signer,
            "decision": "allow",
        }),
    );
    emit_session_event(&handle, gate_snapshot_event(handle.id.clone(), &snapshot)).await;
    ok_ack(cmd)
}

pub async fn handle_override(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(handle) = state.sessions.get(&cmd.session_id) else {
        return error_ack(
            cmd,
            "session.not_found",
            format!("session {} not found", cmd.session_id),
        );
    };
    let gate_id = cmd
        .payload
        .get("id")
        .or_else(|| cmd.payload.get("gate_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if gate_id.is_empty() {
        return error_ack(cmd, "gate.not_found", "gate id is required");
    }
    let reason = cmd
        .payload
        .get("reason")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    if reason.is_empty() {
        return error_ack(
            cmd,
            "gate.reason_required",
            "a reason is required for gate override",
        );
    }
    let expiry = match parse_expiry(
        cmd.payload
            .get("expires_at")
            .or_else(|| cmd.payload.get("expiresAt"))
            .and_then(|v| v.as_str()),
    ) {
        Ok(v) => v,
        Err(code) => return error_ack(cmd, code, "override expiry must be in the future"),
    };
    let snapshot = {
        let mut guard = match handle.gate_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return error_ack(cmd, "persistence.write_failed", "gate state lock poisoned")
            }
        };
        let Some(snapshot) = guard.ensure_known(&gate_id) else {
            return error_ack(cmd, "gate.not_found", format!("gate {gate_id} not found"));
        };
        snapshot.overridden = true;
        snapshot.override_reason = Some(reason.to_string());
        snapshot.override_expires_at = Some(expiry);
        touch_gate(snapshot);
        snapshot.clone()
    };
    log_tool_event(
        state,
        &cmd.session_id,
        "gate",
        json!({
            "command": "gate.override",
            "gate_id": gate_id,
            "reason": reason,
            "decision": "allow",
        }),
    );
    emit_session_event(&handle, gate_snapshot_event(handle.id.clone(), &snapshot)).await;
    ok_ack(cmd)
}

pub async fn handle_revoke_override(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(handle) = state.sessions.get(&cmd.session_id) else {
        return error_ack(
            cmd,
            "session.not_found",
            format!("session {} not found", cmd.session_id),
        );
    };
    let gate_id = cmd
        .payload
        .get("id")
        .or_else(|| cmd.payload.get("gate_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if gate_id.is_empty() {
        return error_ack(cmd, "gate.not_found", "gate id is required");
    }
    let snapshot = {
        let mut guard = match handle.gate_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return error_ack(cmd, "persistence.write_failed", "gate state lock poisoned")
            }
        };
        let Some(snapshot) = guard.ensure_known(&gate_id) else {
            return error_ack(cmd, "gate.not_found", format!("gate {gate_id} not found"));
        };
        snapshot.overridden = false;
        snapshot.override_reason = None;
        snapshot.override_expires_at = None;
        touch_gate(snapshot);
        snapshot.clone()
    };
    log_tool_event(
        state,
        &cmd.session_id,
        "gate",
        json!({
            "command": "gate.revoke_override",
            "gate_id": gate_id,
            "decision": "allow",
        }),
    );
    emit_session_event(&handle, gate_snapshot_event(handle.id.clone(), &snapshot)).await;
    ok_ack(cmd)
}

pub fn session_gate_snapshot(handle: &SessionHandleRef, gate_id: &str) -> Option<GateSnapshot> {
    let guard = handle.gate_state.lock().ok()?;
    guard.get(gate_id)
}

pub fn default_gate_ids() -> &'static [&'static str] {
    KNOWN_GATES
}

pub fn ensure_gate_snapshot(handle: &SessionHandleRef, gate_id: &str) -> Option<GateSnapshot> {
    let mut guard = handle.gate_state.lock().ok()?;
    let snapshot = guard.ensure_known(gate_id)?.clone();
    Some(snapshot)
}

pub fn emit_gate_snapshot(handle: &SessionHandleRef, snapshot: GateSnapshot) {
    let event = gate_snapshot_event(handle.id.clone(), &snapshot);
    let handle = Arc::clone(handle);
    tokio::spawn(async move {
        emit_session_event(&handle, event).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_gate_ids_treats_expired_override_as_not_ready() {
        let mut state = SessionGateState::default();

        let mut dev = default_gate_snapshot("DevComplete");
        dev.state = "pass".into();
        state.upsert(dev);

        let mut deploy = default_gate_snapshot("ReadyToDeploy");
        deploy.state = "pass".into();
        deploy.overridden = true;
        deploy.override_reason = Some("temporary exception".into());
        deploy.override_expires_at = Some((Utc::now() - Duration::days(1)).to_rfc3339());
        state.upsert(deploy);

        let (ready, missing) = state.ready_for_target("prod");

        assert!(!ready);
        assert_eq!(missing, vec!["ReadyToDeploy".to_string()]);
    }
}
