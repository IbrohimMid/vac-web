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
        // Two render paths:
        //  (a) payload_template_json is Some: substitute ${var} placeholders
        //      directly in the raw JSON template string, then parse. Lets typed
        //      JSON-value bindings (e.g. array from @mention_search_results)
        //      splice in as real arrays/objects rather than string blobs.
        //  (b) payload_template_json is None (default): parse payload_json into
        //      a Value first, then walk the Value substituting string-typed
        //      bindings via render_value. Used for the 22 existing scenarios.
        let rendered = if let Some(template) = step.payload_template_json {
            let substituted = render_string(template, &bindings);
            serde_json::from_str(&substituted).ok()?
        } else {
            let raw: Value = serde_json::from_str(step.payload_json).ok()?;
            render_value(&raw, &bindings)
        };
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
                // Section A primitive: counter-bumping generator for release.deploy ids.
                // `@release_deploy_id` mutates state.counter and renders a deterministic
                // `dep_{seed%10000:0>12}{counter:0>3}` shape (matches legacy contract).
                "release_deploy_id" => {
                    state.counter += 1;
                    format!("dep_{:0>12}{:0>3}", state.seed % 10000, state.counter)
                }
                // Read-only counter projection: returns 40-char hex of
                // `state.counter * 0xDEAD_BEEF` without bumping. Pair with
                // `@release_deploy_id` placed first in state_seeds so both
                // bindings derive from the same counter snapshot.
                "release_deploy_commit" => {
                    format!("{:040x}", state.counter.wrapping_mul(0xDEAD_BEEF_u64))
                }
                // Section A primitive (Pass #30): bumps counter and renders
                // `notes_{target_id}_{counter}` shape used by release.generate_notes.
                // Reads target_id from input params (empty if absent, matches legacy).
                "release_notes_id" => {
                    state.counter += 1;
                    let target = params
                        .get("target_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    format!("notes_{target}_{}", state.counter)
                }
                // Section A primitive (Pass #32): query-driven filter generator.
                // Reads $input.query, applies legacy filter logic over a fixed sample
                // path set, returns a JSON-array string for embedding via
                // payload_template_json substitution. Mirrors handle_mention_search
                // semantics: lowercased substring match on path, descending score by
                // result index. Empty query matches all samples.
                "mention_search_results" => {
                    let query = params
                        .get("query")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_lowercase();
                    let samples = [
                        "src/foo.ts",
                        "src/main.tsx",
                        "docs/README.md",
                        "package.json",
                    ];
                    let results: Vec<Value> = samples
                        .iter()
                        .filter(|p| query.is_empty() || p.to_lowercase().contains(&query))
                        .enumerate()
                        .map(|(i, p)| {
                            json!({
                                "id": format!("file:{p}"),
                                "kind": "file",
                                "label": p,
                                "score": 1.0 - (i as f64) * 0.1,
                                "payload": p
                            })
                        })
                        .collect();
                    Value::Array(results).to_string()
                }
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
    fn release_deploy_runtime_dispatch_emits_three_progress_events_and_final_response() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":91,"method":"release.deploy","params":{"target_id":"prod"}}"#,
            &mut state,
        );
        // 3 notifications + 1 response.
        assert_eq!(
            out.len(),
            4,
            "expected 3 notifications + 1 response, got {out:?}"
        );
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n0["method"], "release.deploy_progress");
        let deploy_id = n0["params"]["deploy_id"].as_str().unwrap().to_string();
        assert!(
            deploy_id.starts_with("dep_"),
            "unexpected deploy_id {deploy_id}"
        );
        assert_eq!(n0["params"]["target_id"], "prod");
        assert_eq!(n0["params"]["status"], "deploying");
        let n1: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(n1["method"], "release.deploy_progress");
        assert_eq!(n1["params"]["deploy_id"], deploy_id);
        assert_eq!(n1["params"]["status"], "deployed");
        let n2: Value = serde_json::from_str(&out[2]).unwrap();
        assert_eq!(n2["method"], "release.post_deploy_observation");
        assert_eq!(n2["params"]["target_id"], "prod");
        let obs_id = n2["params"]["id"].as_str().unwrap();
        assert!(
            obs_id.contains(&deploy_id),
            "obs_id should embed deploy_id, got {obs_id}"
        );
        let r: Value = serde_json::from_str(&out[3]).unwrap();
        assert_eq!(r["id"], 91);
        assert_eq!(r["result"]["ok"], true);
        assert_eq!(r["result"]["deploy_id"], deploy_id);
    }

    #[test]
    fn release_generate_notes_runtime_dispatch_emits_notes_draft_then_response() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":92,"method":"release.generate_notes","params":{"target_id":"prod"}}"#,
            &mut state,
        );
        assert_eq!(
            out.len(),
            2,
            "expected 1 notification + 1 response, got {out:?}"
        );
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n0["method"], "release.notes_draft");
        let notes_id = n0["params"]["id"].as_str().unwrap();
        assert!(
            notes_id.starts_with("notes_prod_"),
            "unexpected notes_id {notes_id}"
        );
        assert_eq!(n0["params"]["target_id"], "prod");
        assert_eq!(n0["params"]["commit_range"], "abc1234..def5678");
        let md = n0["params"]["markdown"].as_str().unwrap();
        assert!(
            md.contains("## What changed"),
            "markdown missing header: {md}"
        );
        assert!(
            md.contains("## Deploy window"),
            "markdown missing deploy window: {md}"
        );
        let refs = n0["params"]["source_refs"].as_array().unwrap();
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0]["kind"], "commit");
        assert_eq!(refs[1]["kind"], "packet");
        let r: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(r["id"], 92);
        assert_eq!(r["result"]["ok"], true);
    }

    #[test]
    fn context_mention_search_runtime_dispatch_filters_samples_via_payload_template() {
        let mut state = mk_state();
        // Empty query — all 4 samples returned with descending score.
        let out = handle(
            r#"{"jsonrpc":"2.0","id":93,"method":"context.mention_search","params":{"query":""}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n0["method"], "context.mention_results");
        assert_eq!(n0["params"]["query"], "");
        let results = n0["params"]["results"].as_array().unwrap();
        assert_eq!(results.len(), 4, "empty query should match all samples");
        assert_eq!(results[0]["id"], "file:src/foo.ts");
        assert_eq!(results[0]["score"], 1.0);
        assert_eq!(results[3]["id"], "file:package.json");
        // Filtered query.
        let mut state2 = mk_state();
        let out2 = handle(
            r#"{"jsonrpc":"2.0","id":94,"method":"context.mention_search","params":{"query":"src"}}"#,
            &mut state2,
        );
        let n2: Value = serde_json::from_str(&out2[0]).unwrap();
        let results2 = n2["params"]["results"].as_array().unwrap();
        assert_eq!(results2.len(), 2, "`src` should match 2 samples");
        assert!(results2
            .iter()
            .all(|r| r["label"].as_str().unwrap().contains("src/")));
        assert_eq!(n2["params"]["query"], "src");
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
