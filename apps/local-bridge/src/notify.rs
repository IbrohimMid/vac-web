//! Notify event router — maps semantic events to (lane, severity).

use crate::ws::envelope::ServerEvent;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy)]
pub enum Lane {
    Transient,
    Persistent,
    Sticky,
}

impl Lane {
    pub fn as_str(self) -> &'static str {
        match self {
            Lane::Transient => "transient",
            Lane::Persistent => "persistent",
            Lane::Sticky => "sticky",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Severity {
    Ok,
    Info,
    Warn,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Ok => "ok",
            Severity::Info => "info",
            Severity::Warn => "warn",
            Severity::Error => "error",
        }
    }
}

/// Build a `notify.event` server frame for a given event shape.
pub fn notify_event(
    session_id: String,
    lane: Lane,
    severity: Severity,
    subsystem: &str,
    title: &str,
    message: &str,
) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id,
        event_type: "notify.event".into(),
        payload: json!({
            "id": format!("ntfy_{}", ulid::Ulid::new()),
            "lane": lane.as_str(),
            "severity": severity.as_str(),
            "subsystem": subsystem,
            "title": title,
            "message": message,
            "ts": chrono::Utc::now().to_rfc3339(),
        }),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    }
}

/// Build a `system_pulse.updated` frame from bridge state.
pub fn system_pulse_event(
    session_id: String,
    facets: Vec<(&str, &str, &str)>, // (kind, label, severity)
) -> ServerEvent {
    let payload_facets: Vec<Value> = facets
        .into_iter()
        .map(|(kind, label, severity)| {
            json!({
                "kind": kind,
                "label": label,
                "severity": severity,
            })
        })
        .collect();
    ServerEvent {
        seq: 0,
        session_id,
        event_type: "system_pulse.updated".into(),
        payload: json!({ "facets": payload_facets }),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    }
}

/// Build an `activity.appended` frame.
pub fn activity_event(
    session_id: String,
    subsystem: &str,
    severity: Severity,
    summary: &str,
) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id,
        event_type: "activity.appended".into(),
        payload: json!({
            "id": format!("act_{}", ulid::Ulid::new()),
            "ts": chrono::Utc::now().to_rfc3339(),
            "subsystem": subsystem,
            "severity": severity.as_str(),
            "summary": summary,
        }),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    }
}
