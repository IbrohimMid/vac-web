//! Scenario dispatcher (Slice 34).
//!
//! `scenarios::handle` first attempts to dispatch via the YAML-driven
//! `RUNTIME_SCENARIO_CATALOG` (codegen'd from
//! `tools/mock-engine/scenarios/*.yaml`). If the inbound JSON-RPC
//! method matches a runtime-dispatched scenario (`runtime_dispatch:
//! true`), state seeds are evaluated, payload templates rendered, and
//! the timeline emitted (with the optional `final_response`).
//! Otherwise `handle` falls through to `legacy_scenarios::handle`.
//!
//! Template syntax:
//!   - State seeds: `var: "@generator"` invokes a generator (e.g.
//!     `@next_shell_id`). `var: "$input.<key>"` reads the inbound
//!     JSON-RPC `params.<key>` (string only; falls back to empty
//!     string if absent). Plain values pass through verbatim.
//!   - Payload + final_response strings substitute `${var}` placeholders
//!     from the bindings produced by state seeds. Unknown placeholders
//!     are preserved verbatim.
//!
//! As legacy handlers port to YAML, `legacy_scenarios.rs` shrinks.

use crate::generated::scenario_catalog::{RuntimeScenarioEntry, RUNTIME_SCENARIO_CATALOG};
use serde_json::{json, Value};
use std::collections::HashMap;

#[allow(unused_imports)]
pub use crate::legacy_scenarios::{emit_error, emit_notification, emit_response, State};

/// Dispatch an inbound JSON-RPC line to scripted output.
///
/// 1. Try `try_runtime_dispatch` (YAML catalog).
/// 2. Fall back to `legacy_scenarios::handle` (imperative handlers).
pub fn handle(line: &str, state: &mut State) -> Vec<String> {
    if let Some(out) = try_runtime_dispatch(line, state) {
        return out;
    }
    crate::legacy_scenarios::handle(line, state)
}

fn try_runtime_dispatch(line: &str, state: &mut State) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(line).ok()?;
    let method = v.get("method").and_then(|m| m.as_str())?;
    let entry = RUNTIME_SCENARIO_CATALOG
        .iter()
        .find(|e| e.input_command == method)?;
    let id = v.get("id").cloned().unwrap_or(Value::Null);
    let params = v.get("params").cloned().unwrap_or(Value::Null);
    let bindings = build_bindings(entry, state, &params);

    let mut out = Vec::with_capacity(entry.timeline.len() + 1);
    for step in entry.timeline {
        let raw: Value = serde_json::from_str(step.payload_json).ok()?;
        let rendered = render_value(&raw, &bindings);
        out.push(emit_notification(step.event, rendered));
    }
    let result = if let Some(json_str) = entry.final_response_json {
        let raw: Value = serde_json::from_str(json_str).ok()?;
        render_value(&raw, &bindings)
    } else {
        json!({ "ok": true })
    };
    out.push(emit_response(id, result));
    Some(out)
}

fn build_bindings(
    entry: &RuntimeScenarioEntry,
    state: &mut State,
    params: &Value,
) -> HashMap<String, String> {
    let mut bindings = HashMap::new();
    for seed in entry.state_seeds {
        let val = if let Some(generator) = seed.value.strip_prefix('@') {
            match generator {
                "next_shell_id" => state.next_shell_id(),
                "next_msg_id" => state.next_msg_id(),
                "next_tool_call_id" => state.next_tool_call_id(),
                "next_job_id" => state.next_job_id(),
                "session_id" => state.session_id.clone(),
                _ => seed.value.to_string(),
            }
        } else if let Some(key) = seed.value.strip_prefix("$input.") {
            params
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        } else {
            seed.value.to_string()
        };
        bindings.insert(seed.var.to_string(), val);
    }
    bindings
}

fn render_value(v: &Value, bindings: &HashMap<String, String>) -> Value {
    match v {
        Value::String(s) => Value::String(render_string(s, bindings)),
        Value::Array(arr) => Value::Array(arr.iter().map(|x| render_value(x, bindings)).collect()),
        Value::Object(obj) => {
            let mut new = serde_json::Map::with_capacity(obj.len());
            for (k, val) in obj {
                new.insert(k.clone(), render_value(val, bindings));
            }
            Value::Object(new)
        }
        _ => v.clone(),
    }
}

fn render_string(s: &str, bindings: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        if let Some(end_rel) = rest[start + 2..].find('}') {
            let var = &rest[start + 2..start + 2 + end_rel];
            if let Some(v) = bindings.get(var) {
                out.push_str(v);
            } else {
                // Unknown var — preserve verbatim.
                out.push_str(&rest[start..start + 2 + end_rel + 1]);
            }
            rest = &rest[start + 2 + end_rel + 1..];
        } else {
            // Unmatched `${` — push the remainder verbatim and stop.
            out.push_str(&rest[start..]);
            rest = "";
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_state() -> State {
        State::new(42, "sess_test".into(), None, None)
    }

    #[test]
    fn unknown_command_falls_through_to_legacy() {
        let mut state = mk_state();
        // `system.ping` is owned by legacy and should still respond.
        let out = handle(
            r#"{"jsonrpc":"2.0","id":1,"method":"system.ping"}"#,
            &mut state,
        );
        assert!(
            out.iter().any(|line| line.contains("\"pong\":true")),
            "expected legacy ping response, got {out:?}"
        );
    }

    #[test]
    fn render_string_substitutes_known_vars_and_preserves_unknown() {
        let mut b = HashMap::new();
        b.insert("x".to_string(), "hello".to_string());
        assert_eq!(render_string("a ${x} b", &b), "a hello b");
        assert_eq!(render_string("a ${y} b", &b), "a ${y} b");
        assert_eq!(render_string("no placeholders", &b), "no placeholders");
        assert_eq!(render_string("trailing ${", &b), "trailing ${");
    }

    #[test]
    fn shell_start_runtime_dispatched_emits_started_output_and_response() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":7,"method":"shell.start","params":{"cwd":"project_root"}}"#,
            &mut state,
        );
        assert_eq!(
            out.len(),
            3,
            "expected 2 notifications + 1 response, got {out:?}"
        );
        // First two lines are JSON-RPC notifications.
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n0["method"], "shell.started");
        let shell_id = n0["params"]["shell_id"].as_str().unwrap().to_string();
        assert!(
            shell_id.starts_with("sh_01J"),
            "unexpected shell_id {shell_id}"
        );
        let n1: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(n1["method"], "shell.output");
        assert_eq!(n1["params"]["shell_id"], shell_id);
        assert_eq!(n1["params"]["data"], "mock-shell $ ");
        // Final response carries the same shell_id.
        let r: Value = serde_json::from_str(&out[2]).unwrap();
        assert_eq!(r["id"], 7);
        assert_eq!(r["result"]["ok"], true);
        assert_eq!(r["result"]["shell_id"], shell_id);
    }

    #[test]
    fn review_revert_file_runtime_dispatch_echoes_input_path() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":11,"method":"review.revert_file","params":{"path":"src/widgets/Foo.tsx"}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let n: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n["method"], "review.changeset_updated");
        assert_eq!(n["params"]["reverted_path"], "src/widgets/Foo.tsx");
        assert!(n["params"]["files"].as_array().unwrap().is_empty());
        let r: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(r["result"]["ok"], true);
    }

    #[test]
    fn gate_signoff_runtime_dispatch_emits_response_only() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":12,"method":"gate.signoff","params":{"gate_id":"g1","signer":"u"}}"#,
            &mut state,
        );
        // No notifications, response-only.
        assert_eq!(out.len(), 1);
        let r: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(r["id"], 12);
        assert_eq!(r["result"]["ok"], true);
    }

    #[test]
    fn session_close_runtime_dispatch_emits_session_closed_then_ok() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":21,"method":"session.close"}"#,
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let n: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n["method"], "session.closed");
        assert_eq!(n["params"]["reason"], "user");
        let r: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(r["id"], 21);
        assert_eq!(r["result"]["ok"], true);
    }

    #[test]
    fn connector_connect_runtime_dispatch_substitutes_provider_into_oauth_url() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":22,"method":"connector.connect","params":{"provider":"sentry"}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let n: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n["method"], "connector.oauth_url");
        assert_eq!(n["params"]["provider"], "sentry");
        assert_eq!(
            n["params"]["url"],
            "{https://example.invalid/oauth/sentry}?state=mock"
        );
    }

    #[test]
    fn shell_input_runtime_dispatch_echoes_data_on_same_shell_id() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":23,"method":"shell.input","params":{"shell_id":"sh_xyz","data":"echo hi\n"}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let n: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n["method"], "shell.output");
        assert_eq!(n["params"]["shell_id"], "sh_xyz");
        assert_eq!(n["params"]["data"], "echo hi\n");
    }

    #[test]
    fn shell_resize_runtime_dispatch_is_response_only() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":24,"method":"shell.resize","params":{"shell_id":"sh_a","cols":120,"rows":40}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 1);
        let r: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(r["id"], 24);
        assert_eq!(r["result"]["ok"], true);
    }

    #[test]
    fn approval_approve_runtime_dispatch_seeds_tool_call_id_from_approval_id() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":31,"method":"approval.approve","params":{"approval_id":"appr_01"}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let n: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n["method"], "tool_call.decided");
        assert_eq!(n["params"]["tool_call_id"], "appr_01");
        assert_eq!(n["params"]["decision"], "approved");
        let r: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(r["id"], 31);
        assert_eq!(r["result"]["ok"], true);
    }

    #[test]
    fn approval_reject_runtime_dispatch_emits_decided_with_rejected() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":32,"method":"approval.reject","params":{"approval_id":"appr_02"}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let n: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n["method"], "tool_call.decided");
        assert_eq!(n["params"]["tool_call_id"], "appr_02");
        assert_eq!(n["params"]["decision"], "rejected");
    }

    #[test]
    fn review_open_file_runtime_dispatch_embeds_path_into_unified_diff() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":33,"method":"review.open_file","params":{"path":"src/widgets/Bar.tsx"}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let n: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n["method"], "review.file_diff_chunk");
        assert_eq!(n["params"]["path"], "src/widgets/Bar.tsx");
        assert_eq!(n["params"]["truncated"], false);
        let unified = n["params"]["unified"].as_str().unwrap();
        assert!(
            unified.contains("--- a/src/widgets/Bar.tsx"),
            "missing a/path: {unified}"
        );
        assert!(
            unified.contains("+++ b/src/widgets/Bar.tsx"),
            "missing b/path: {unified}"
        );
        assert!(unified.contains("-old line"));
        assert!(unified.contains("+new line"));
    }

    #[test]
    fn render_value_recurses_into_arrays_and_objects() {
        let mut b = HashMap::new();
        b.insert("id".to_string(), "sh_01".to_string());
        let v = serde_json::json!({
            "shell_id": "${id}",
            "chunks": ["${id}-a", "${id}-b"],
            "meta": { "key": "${id}" },
            "count": 3
        });
        let out = render_value(&v, &b);
        assert_eq!(out["shell_id"], "sh_01");
        assert_eq!(out["chunks"][0], "sh_01-a");
        assert_eq!(out["meta"]["key"], "sh_01");
        assert_eq!(out["count"], 3);
    }
}
