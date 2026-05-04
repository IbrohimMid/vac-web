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

    let mut bindings = bindings;
    let mut out = Vec::with_capacity(entry.timeline.len() + 1);
    for step in entry.timeline {
        // Pass #34: single-equality skip primitive (conditional branching).
        // When `condition` is set, the step is emitted only if
        // `bindings[condition.binding] == condition.equals`. Missing binding compares
        // against the empty string. No operators, no nesting — entire authority for
        // branch resolution lives in generators (e.g. @handoff_dispatch_outcome) which
        // produce the binding value; YAML only declares which literal triggers the step.
        if let Some(cond) = step.condition {
            let actual = bindings.get(cond.binding).map(String::as_str).unwrap_or("");
            if actual != cond.equals {
                continue;
            }
        }
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
        // Section A primitive (Pass #33): multi-event ledger.
        // After rendering this step, evaluate any state_seeds_after directives
        // and extend the bindings map. Subsequent steps in the same scenario
        // can reference these additions via ${var}. Useful for counter bumps
        // mid-timeline or computed derivations from prior payload metadata.
        for seed in step.state_seeds_after {
            let val = eval_seed_value(seed.value, state, &params);
            bindings.insert(seed.var.to_string(), val);
        }
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

/// Mirror of legacy `legacy_scenarios::deterministic_hex` for seed-derived
/// repo defaults. Used by `@repo_default_*` generators in eval_seed_value.
fn deterministic_hex_for_seed(seed: u64) -> String {
    format!(
        "{:016x}{:016x}{:016x}{:016x}",
        seed,
        seed ^ 0xaaaa,
        seed ^ 0x5555,
        seed ^ 0xffff
    )
}

fn build_bindings(
    entry: &RuntimeScenarioEntry,
    state: &mut State,
    params: &Value,
) -> HashMap<String, String> {
    let mut bindings = HashMap::new();
    for seed in entry.state_seeds {
        bindings.insert(
            seed.var.to_string(),
            eval_seed_value(seed.value, state, params),
        );
    }
    bindings
}

/// Evaluate a single state_seed binding value. Supported syntaxes:
/// - `@<generator>` — named generator (counter-bumping ids, query-driven results).
/// - `$input.<key>[|<default>]` — read string param `<key>`; fall back to `<default>` (or empty string).
/// - `$input_json.<key>[|<default_json>]` — read param `<key>` and JSON-encode it; fall back to `<default_json>` (or `"null"`).
/// - any other string — used verbatim.
fn eval_seed_value(seed_value: &str, state: &mut State, params: &Value) -> String {
    if let Some(generator) = seed_value.strip_prefix('@') {
        match generator {
            "next_shell_id" => state.next_shell_id(),
            "next_msg_id" => state.next_msg_id(),
            "next_tool_call_id" => state.next_tool_call_id(),
            "next_job_id" => state.next_job_id(),
            "session_id" => state.session_id.clone(),
            "release_deploy_id" => {
                state.counter += 1;
                format!("dep_{:0>12}{:0>3}", state.seed % 10000, state.counter)
            }
            "release_deploy_commit" => {
                format!("{:040x}", state.counter.wrapping_mul(0xDEAD_BEEF_u64))
            }
            "release_notes_id" => {
                state.counter += 1;
                let target = params
                    .get("target_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                format!("notes_{target}_{}", state.counter)
            }
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
            // Section A (Pass #33): counter-bumping handoff packet id matching legacy
            // handle_handoff_create format `pkt_01J{seed%10000:0>20}{counter:0>3}`.
            "handoff_packet_id" => {
                state.counter += 1;
                format!("pkt_01J{:0>20}{:0>3}", state.seed % 10000, state.counter)
            }
            // Section A (Pass #33): seed-derived repo defaults matching the
            // no-project-path branch of legacy_scenarios::repo_context. Used by
            // handoff.create YAML for default pin fields when operator did not
            // pass an explicit `pin` param.
            "repo_default_base_commit_sha" => {
                deterministic_hex_for_seed(state.seed)[..40].to_string()
            }
            "repo_default_repo_ref" => {
                let sha = deterministic_hex_for_seed(state.seed);
                format!("sha:{}", &sha[..40])
            }
            "repo_default_worktree_digest" => {
                deterministic_hex_for_seed(state.seed.wrapping_add(1))
            }
            // Section A (Pass #34): conditional branching primitives for handoff.dispatch_local.
            // `executor_session_id` mirrors the legacy format
            // `format!("exec_{:0>12}{:0>3}", state.seed % 10000, state.counter)` and bumps the counter
            // once per scenario dispatch.
            "executor_session_id" => {
                state.counter += 1;
                format!("exec_{:0>12}{:0>3}", state.seed % 10000, state.counter)
            }
            // `handoff_dispatch_outcome` inspects request params and returns the literal string
            // "failure" when params.force_failure==true OR params.mode=="fail"; otherwise "success".
            // YAML timeline steps then key off this binding via `condition: { binding, equals }`.
            // Branch authority lives in this generator (Rust runtime), NOT in YAML.
            "handoff_dispatch_outcome" => {
                let force = params
                    .get("force_failure")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    || params
                        .get("mode")
                        .and_then(|v| v.as_str())
                        .map(|m| m == "fail")
                        .unwrap_or(false);
                if force {
                    "failure".to_string()
                } else {
                    "success".to_string()
                }
            }
            _ => seed_value.to_string(),
        }
    } else if let Some(rest) = seed_value.strip_prefix("$input_json.") {
        let (key, default_json) = rest.split_once('|').unwrap_or((rest, "null"));
        params
            .get(key)
            .map(|v| v.to_string())
            .unwrap_or_else(|| default_json.to_string())
    } else if let Some(rest) = seed_value.strip_prefix("$input.") {
        let (key, default_str) = rest.split_once('|').unwrap_or((rest, ""));
        params
            .get(key)
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| default_str.to_string())
    } else {
        seed_value.to_string()
    }
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
    fn handoff_approve_runtime_dispatch_emits_status_then_upserted_with_approval_payload() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":95,"method":"handoff.approve","params":{"packet_id":"pkt_01J_test","approver":"alice","reason":"lgtm"}}"#,
            &mut state,
        );
        // 2 notifications + 1 response.
        assert_eq!(out.len(), 3);
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n0["method"], "handoff.status");
        assert_eq!(n0["params"]["packet_id"], "pkt_01J_test");
        assert_eq!(n0["params"]["status"], "approved");
        let n1: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(n1["method"], "handoff.upserted");
        assert_eq!(n1["params"]["packet_id"], "pkt_01J_test");
        assert_eq!(n1["params"]["status"], "approved");
        assert_eq!(n1["params"]["approval"]["approvers"][0], "alice");
        assert_eq!(n1["params"]["approval"]["approver_notes"], "lgtm");
        assert_eq!(
            n1["params"]["approval"]["approved_at"],
            "2026-04-24T10:05:00Z"
        );
        assert_eq!(n1["params"]["signers"][0]["role"], "approver");
        assert_eq!(n1["params"]["signers"][0]["name"], "alice");
        assert_eq!(n1["params"]["signers"][0]["reason"], "lgtm");
        let r: Value = serde_json::from_str(&out[2]).unwrap();
        assert_eq!(r["id"], 95);
        assert_eq!(r["result"]["ok"], true);
    }

    #[test]
    fn handoff_approve_default_reason_is_approved_when_input_omits_reason() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":96,"method":"handoff.approve","params":{"packet_id":"pkt_X","approver":"bob"}}"#,
            &mut state,
        );
        let n1: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(n1["params"]["approval"]["approver_notes"], "approved");
        assert_eq!(n1["params"]["signers"][0]["reason"], "approved");
    }

    #[test]
    fn eval_seed_value_supports_input_default_and_input_json_pass_through() {
        let mut state = mk_state();
        let params = serde_json::json!({
            "name": "alice",
            "items": [1, 2, 3],
            "meta": { "k": "v" }
        });
        // $input.X with present key returns string.
        assert_eq!(eval_seed_value("$input.name", &mut state, &params), "alice");
        // $input.X missing falls back to default.
        assert_eq!(
            eval_seed_value("$input.absent|fallback", &mut state, &params),
            "fallback"
        );
        // $input_json.X serialises array as JSON string.
        assert_eq!(
            eval_seed_value("$input_json.items", &mut state, &params),
            "[1,2,3]"
        );
        // $input_json.X serialises object.
        assert_eq!(
            eval_seed_value("$input_json.meta", &mut state, &params),
            r#"{"k":"v"}"#
        );
        // $input_json.X missing returns "null" by default.
        assert_eq!(
            eval_seed_value("$input_json.absent", &mut state, &params),
            "null"
        );
        // $input_json.X with explicit default JSON.
        assert_eq!(
            eval_seed_value("$input_json.absent|[]", &mut state, &params),
            "[]"
        );
        // @handoff_packet_id bumps counter and formats deterministically.
        let pid = eval_seed_value("@handoff_packet_id", &mut state, &params);
        assert!(pid.starts_with("pkt_01J"), "unexpected pid {pid}");
        assert_eq!(state.counter, 1);
        let pid2 = eval_seed_value("@handoff_packet_id", &mut state, &params);
        assert_ne!(pid, pid2, "counter bumps should produce distinct ids");
        assert_eq!(state.counter, 2);
    }

    #[test]
    fn handoff_create_runtime_dispatch_emits_upserted_with_full_canonical_payload() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":97,"method":"handoff.create","params":{"title":"Test Handoff","created_by":"alice","summary":"Test summary","source_run_ids":["run_1","run_2"],"accepted_finding_ids":["f_1"],"tasks":[{"id":"t1"}],"order_hint":["t1"]}}"#,
            &mut state,
        );
        assert_eq!(
            out.len(),
            2,
            "expected 1 notification + 1 response, got {out:?}"
        );
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n0["method"], "handoff.upserted");
        let pid = n0["params"]["packet_id"].as_str().unwrap().to_string();
        assert!(pid.starts_with("pkt_01J"), "unexpected pid {pid}");
        assert_eq!(n0["params"]["title"], "Test Handoff");
        assert_eq!(n0["params"]["summary"], "Test summary");
        assert_eq!(n0["params"]["created_by"], "alice");
        assert_eq!(n0["params"]["status"], "pending_approval");
        assert_eq!(n0["params"]["required_signers"], 2);
        assert_eq!(n0["params"]["convergence_count"], 0);
        let signers = n0["params"]["signers"].as_array().unwrap();
        assert_eq!(signers.len(), 1);
        assert_eq!(signers[0]["role"], "author");
        assert_eq!(signers[0]["name"], "alice");
        let source_run_ids = n0["params"]["source_run_ids"].as_array().unwrap();
        assert_eq!(
            source_run_ids.len(),
            2,
            "typed JSON-array splice from $input_json"
        );
        assert_eq!(source_run_ids[0], "run_1");
        assert_eq!(source_run_ids[1], "run_2");
        // Pin block uses seed-derived defaults via @repo_default_* generators.
        let pin = &n0["params"]["pin"];
        assert!(pin["repo_ref"].as_str().unwrap().starts_with("sha:"));
        assert_eq!(pin["invalidation_policy"], "strict");
        assert_eq!(pin["invalidate_on_repo_change"], true);
        // Response carries ok + packet_id.
        let r: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(r["id"], 97);
        assert_eq!(r["result"]["ok"], true);
        assert_eq!(r["result"]["packet_id"], pid);
    }

    #[test]
    fn handoff_create_default_target_and_approval_used_when_input_omits_them() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":98,"method":"handoff.create","params":{"title":"X","created_by":"bob"}}"#,
            &mut state,
        );
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        let target = &n0["params"]["target"];
        assert_eq!(target["kind"], "dispatch_to_local_vac");
        assert_eq!(target["executor_profile_id"], "executor.code@1.0.0");
        let approval = &n0["params"]["approval"];
        assert_eq!(approval["required"], true);
        assert_eq!(approval["two_party"], false);
        // Empty arrays default for omitted fields.
        assert_eq!(n0["params"]["source_run_ids"].as_array().unwrap().len(), 0);
        assert_eq!(n0["params"]["tasks"].as_array().unwrap().len(), 0);
        // execution_session_id null when omitted.
        assert!(n0["params"]["execution_session_id"].is_null());
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

    #[test]
    fn handoff_dispatch_local_runtime_dispatch_success_branch_emits_full_progress_completed_upserted(
    ) {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":99,"method":"handoff.dispatch_local","params":{"packet_id":"pkt_dispatch_test"}}"#,
            &mut state,
        );
        // Success branch: started + completed_progress + completed + upserted + response = 5.
        assert_eq!(
            out.len(),
            5,
            "expected 4 notifications + 1 response on success, got {out:?}"
        );
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n0["method"], "handoff.execution_progress");
        assert_eq!(n0["params"]["packet_id"], "pkt_dispatch_test");
        assert_eq!(n0["params"]["status"], "started");
        assert_eq!(n0["params"]["completed"], 0);
        assert_eq!(n0["params"]["total"], 1);
        let exec_sid = n0["params"]["executor_session_id"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(
            exec_sid.starts_with("exec_"),
            "unexpected exec_sid {exec_sid}"
        );
        let n1: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(n1["method"], "handoff.execution_progress");
        assert_eq!(n1["params"]["status"], "completed");
        assert_eq!(n1["params"]["executor_session_id"], exec_sid);
        assert_eq!(n1["params"]["completed"], 1);
        let n2: Value = serde_json::from_str(&out[2]).unwrap();
        assert_eq!(n2["method"], "handoff.completed");
        assert_eq!(n2["params"]["status"], "completed");
        assert_eq!(n2["params"]["outcome"]["status"], "success");
        assert_eq!(n2["params"]["outcome"]["tasks_completed"][0], "t1");
        assert!(n2["params"]["outcome"]["tasks_failed"]
            .as_array()
            .unwrap()
            .is_empty());
        let n3: Value = serde_json::from_str(&out[3]).unwrap();
        assert_eq!(n3["method"], "handoff.upserted");
        assert_eq!(n3["params"]["status"], "completed");
        assert_eq!(n3["params"]["execution_session_id"], exec_sid);
        assert_eq!(n3["params"]["execution_outcome"]["status"], "success");
        let r: Value = serde_json::from_str(&out[4]).unwrap();
        assert_eq!(r["id"], 99);
        assert_eq!(r["result"]["ok"], true);
        assert_eq!(r["result"]["executor_session_id"], exec_sid);
    }

    #[test]
    fn handoff_dispatch_local_runtime_dispatch_failure_branch_via_force_failure_param() {
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":100,"method":"handoff.dispatch_local","params":{"packet_id":"pkt_fail","force_failure":true}}"#,
            &mut state,
        );
        // Failure branch: started + failed + upserted + response = 4.
        assert_eq!(
            out.len(),
            4,
            "expected 3 notifications + 1 response on failure, got {out:?}"
        );
        let n0: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(n0["method"], "handoff.execution_progress");
        assert_eq!(n0["params"]["status"], "started");
        let exec_sid = n0["params"]["executor_session_id"]
            .as_str()
            .unwrap()
            .to_string();
        let n1: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(n1["method"], "handoff.failed");
        assert_eq!(n1["params"]["packet_id"], "pkt_fail");
        assert_eq!(n1["params"]["status"], "failed");
        assert_eq!(n1["params"]["outcome"]["status"], "failed");
        assert_eq!(n1["params"]["outcome"]["tasks_failed"][0], "t1");
        assert!(n1["params"]["outcome"]["tasks_completed"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(n1["params"]["executor_session_id"], exec_sid);
        let n2: Value = serde_json::from_str(&out[2]).unwrap();
        assert_eq!(n2["method"], "handoff.upserted");
        assert_eq!(n2["params"]["status"], "failed");
        assert_eq!(n2["params"]["execution_outcome"]["status"], "failed");
        assert_eq!(n2["params"]["execution_session_id"], exec_sid);
        let r: Value = serde_json::from_str(&out[3]).unwrap();
        assert_eq!(r["id"], 100);
        assert_eq!(r["result"]["ok"], true);
        assert_eq!(r["result"]["executor_session_id"], exec_sid);
    }

    #[test]
    fn handoff_dispatch_local_failure_branch_via_mode_fail_alias() {
        // Confirms `mode: "fail"` aliases to force_failure=true (legacy parity).
        let mut state = mk_state();
        let out = handle(
            r#"{"jsonrpc":"2.0","id":101,"method":"handoff.dispatch_local","params":{"packet_id":"pkt_fail2","mode":"fail"}}"#,
            &mut state,
        );
        assert_eq!(out.len(), 4, "mode=fail should trigger failure branch");
        let n1: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(n1["method"], "handoff.failed");
        assert_eq!(n1["params"]["status"], "failed");
    }
}
