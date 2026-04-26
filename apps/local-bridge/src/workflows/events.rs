//! Build workflow.* ServerEvent payloads.

use crate::ws::envelope::ServerEvent;
use serde_json::json;

fn make_event(session_id: &str, event_type: &str, payload: serde_json::Value) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id: session_id.to_string(),
        event_type: event_type.to_string(),
        payload,
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn workflow_started(
    session_id: &str,
    run_id: &str,
    spec_id: &str,
    spec_name: &str,
) -> ServerEvent {
    make_event(
        session_id,
        "workflow.started",
        json!({
            "run_id": run_id,
            "spec_id": spec_id,
            "spec_name": spec_name,
        }),
    )
}

pub fn workflow_step_started(
    session_id: &str,
    run_id: &str,
    step_id: &str,
    activity_kind: &str,
    label: &str,
) -> ServerEvent {
    make_event(
        session_id,
        "workflow.step.started",
        json!({
            "run_id": run_id,
            "step_id": step_id,
            "activity_kind": activity_kind,
            "label": label,
        }),
    )
}

pub fn workflow_step_updated(
    session_id: &str,
    run_id: &str,
    step_id: &str,
    detail: serde_json::Value,
) -> ServerEvent {
    make_event(
        session_id,
        "workflow.step.updated",
        json!({
            "run_id": run_id,
            "step_id": step_id,
            "detail": detail,
        }),
    )
}

pub fn workflow_step_completed(session_id: &str, run_id: &str, step_id: &str) -> ServerEvent {
    make_event(
        session_id,
        "workflow.step.completed",
        json!({
            "run_id": run_id,
            "step_id": step_id,
        }),
    )
}

pub fn workflow_step_failed(
    session_id: &str,
    run_id: &str,
    step_id: &str,
    reason: &str,
) -> ServerEvent {
    make_event(
        session_id,
        "workflow.step.failed",
        json!({
            "run_id": run_id,
            "step_id": step_id,
            "reason": reason,
        }),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn workflow_artifact_created(
    session_id: &str,
    run_id: &str,
    artifact_id: &str,
    kind: &str,
    step_id: &str,
    tool_call_id: &str,
    source_event_type: &str,
    ts: &str,
    extra: serde_json::Value,
) -> ServerEvent {
    let mut payload = json!({
        "run_id": run_id,
        "artifact_id": artifact_id,
        "kind": kind,
        "step_id": step_id,
        "tool_call_id": tool_call_id,
        "source_event_type": source_event_type,
        "ts": ts,
    });
    if let (Some(obj), Some(base)) = (extra.as_object(), payload.as_object_mut()) {
        for (k, v) in obj {
            if !v.is_null() {
                base.insert(k.clone(), v.clone());
            }
        }
    }
    make_event(session_id, "workflow.artifact.created", payload)
}

pub fn workflow_completed(session_id: &str, run_id: &str) -> ServerEvent {
    make_event(
        session_id,
        "workflow.completed",
        json!({ "run_id": run_id }),
    )
}

pub fn workflow_failed(session_id: &str, run_id: &str, reason: &str) -> ServerEvent {
    make_event(
        session_id,
        "workflow.failed",
        json!({ "run_id": run_id, "reason": reason }),
    )
}
