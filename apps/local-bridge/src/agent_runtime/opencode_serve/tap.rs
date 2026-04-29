//! Stage X.5h.2 Step 3b — sub-agent activity tap on an `opencode acp` child.
//!
//! Owns an [`OpencodeServeClient`] pointed at the child's HTTP `--port`
//! and a tokio task that subscribes to `/event`. Translates SSE
//! `tool.call.started`/`tool.call.completed` frames into
//! [`ObservedToolActivity`] DTOs and forwards them through an
//! `mpsc::UnboundedSender` to a drainer owned by
//! [`crate::session::handle::SessionHandle::spawn_acp`], which emits
//! the canonical 4-lane VAC event surface
//! (`tool.observed`/`tool.updated`/`tool.failed` + rich
//! `tool.call.created`/`tool.call.updated` + `tool.diff.updated`
//! + `tool.terminal.updated`).
//!
//! Binding strategy: when `session.updated{parent_id == acp_root}`
//! arrives, the tap queries the X.5h.1
//! [`AcpRuntime::current_task_parent`] task-scope stack tip. If the
//! bridge has already pushed the parent `task` tool_call_id (the
//! common case — the user approves the task tool *before* the
//! sub-session is spawned), we bind `sub_session_id ->
//! parent_tool_call_id`. Subsequent tool-call frames inside that
//! sub-session inherit the parent. If the stack is empty at bind
//! time (rare race), we drop the binding and the sub-tool is
//! observed as top-level — degraded but never wrong.
//!
//! The subscriber loop reconnects with exponential backoff (100 ms →
//! 2 s) so a slow opencode boot doesn't lose events permanently. The
//! task is aborted on `Drop` so a closing session also tears down
//! its tap — satisfying the X.5h.2 "kill on Drop" risk mitigation.

use super::client::OpencodeServeClient;
use super::events::OpencodeServeEvent;
use crate::agent_runtime::acp::{
    redact_raw_input, sha256_hex_canonical, ObservedToolActivity, ToolDiff, ToolKind, ToolLocation,
    ToolStatus, DEFAULT_RAW_OUTPUT_CAP_BYTES,
};
use crate::agent_runtime::AgentKind;
use crate::session::AcpRuntime;
use dashmap::DashMap;
use futures::StreamExt;
use serde_json::Value;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

/// One sub-agent tool event forwarded from the SSE subscriber to the
/// session-side emit drainer. The drainer fans this out to the 4-lane
/// VAC event surface.
#[derive(Debug, Clone)]
pub struct SubagentToolEvent {
    pub activity: ObservedToolActivity,
    /// `"tool_call"` for started, `"tool_call_update"` for completed.
    /// Maps to `tool.call.created` / `tool.call.updated` on the rich lane.
    pub discriminator: &'static str,
}

/// Sub-agent tap. See module-level docs for scope.
pub struct OpencodeSubagentTap {
    client: OpencodeServeClient,
    /// The opencode-side session id the bridge opened via ACP
    /// `session/new`. Sub-sessions reference it as their `parent_id`
    /// field in `session.updated` frames; that's how we recognize
    /// dispatched Task children.
    acp_session_id: String,
    /// `sub_session_id` (from opencode `/event`) → `parent_tool_call_id`
    /// (from the X.5h.1 `task_scope` stack tip).
    bindings: Arc<DashMap<String, String>>,
    task: JoinHandle<()>,
}

impl OpencodeSubagentTap {
    /// Build a tap and immediately spawn the SSE subscriber task.
    ///
    /// `weak_acp` is a `Weak<AcpRuntime>` so the tap can query the
    /// X.5h.1 task-scope stack without creating an Arc cycle
    /// (AcpRuntime owns the tap via `subagent_tap: Arc<...>`).
    /// `event_tx` is the producer half of an mpsc channel drained by
    /// `spawn_acp`; the drainer translates each forwarded
    /// [`SubagentToolEvent`] into the 4-lane VAC event surface.
    pub fn launch(
        base_url: impl Into<String>,
        acp_session_id: String,
        vac_session_id: String,
        agent_id: String,
        agent_kind: AgentKind,
        weak_acp: Weak<AcpRuntime>,
        event_tx: UnboundedSender<SubagentToolEvent>,
    ) -> Self {
        let client = OpencodeServeClient::new(base_url);
        let bindings: Arc<DashMap<String, String>> = Arc::new(DashMap::new());
        let task = {
            let client = client.clone();
            let bindings = Arc::clone(&bindings);
            let acp_root = acp_session_id.clone();
            let vac_id = vac_session_id.clone();
            tokio::spawn(async move {
                run_subscriber_loop(
                    client, acp_root, vac_id, agent_id, agent_kind, weak_acp, bindings, event_tx,
                )
                .await;
            })
        };
        Self {
            client,
            acp_session_id,
            bindings,
            task,
        }
    }

    pub fn base_url(&self) -> &str {
        self.client.base_url()
    }
    pub fn acp_session_id(&self) -> &str {
        &self.acp_session_id
    }

    /// Bind a sub-session id to a parent task tool_call_id. Public
    /// for tests + as an escape hatch if some future flow wants to
    /// pre-seed bindings outside the SSE path.
    pub fn bind_sub_session(&self, sub_session_id: &str, parent_tool_call_id: &str) {
        self.bindings
            .insert(sub_session_id.to_string(), parent_tool_call_id.to_string());
    }

    pub fn lookup_parent(&self, sub_session_id: &str) -> Option<String> {
        self.bindings.get(sub_session_id).map(|v| v.clone())
    }
}

impl Drop for OpencodeSubagentTap {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_subscriber_loop(
    client: OpencodeServeClient,
    acp_root_session_id: String,
    vac_session_id: String,
    agent_id: String,
    agent_kind: AgentKind,
    weak_acp: Weak<AcpRuntime>,
    bindings: Arc<DashMap<String, String>>,
    event_tx: UnboundedSender<SubagentToolEvent>,
) {
    let mut backoff_ms = 100u64;
    let max_backoff_ms = 2_000u64;

    loop {
        match client.subscribe().await {
            Ok(stream) => {
                info!(
                    session = %vac_session_id,
                    base = %client.base_url(),
                    "opencode subagent tap subscribed"
                );
                backoff_ms = 100;
                let mut stream = Box::pin(stream);
                while let Some(item) = stream.next().await {
                    match item {
                        Ok(evt) => handle_event(
                            &evt,
                            &acp_root_session_id,
                            &vac_session_id,
                            &agent_id,
                            agent_kind,
                            &weak_acp,
                            &bindings,
                            &event_tx,
                        ),
                        Err(e) => {
                            warn!(
                                session = %vac_session_id,
                                error = %e,
                                "opencode subagent tap stream error; reconnecting"
                            );
                            break;
                        }
                    }
                }
                info!(
                    session = %vac_session_id,
                    "opencode subagent tap stream ended; reconnecting"
                );
            }
            Err(e) => {
                warn!(
                    session = %vac_session_id,
                    error = %e,
                    backoff_ms,
                    "opencode subagent tap subscribe failed"
                );
            }
        }
        // If the drain channel has been closed, the session has gone
        // away — exit the loop instead of spinning a dead reconnect.
        if event_tx.is_closed() {
            info!(session = %vac_session_id, "opencode subagent tap drain channel closed; stopping");
            return;
        }
        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        backoff_ms = (backoff_ms * 2).min(max_backoff_ms);
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_event(
    evt: &OpencodeServeEvent,
    acp_root_session_id: &str,
    vac_session_id: &str,
    agent_id: &str,
    agent_kind: AgentKind,
    weak_acp: &Weak<AcpRuntime>,
    bindings: &DashMap<String, String>,
    event_tx: &UnboundedSender<SubagentToolEvent>,
) {
    match evt {
        OpencodeServeEvent::ServerConnected => {
            debug!(session = %vac_session_id, "opencode tap: server.connected");
        }
        OpencodeServeEvent::SessionUpdated {
            session_id,
            parent_id,
        } => {
            let Some(parent) = parent_id.as_deref() else {
                return;
            };
            if parent != acp_root_session_id {
                // Nested deeper than first-level (sub-of-sub) — not
                // wired in this stage; record at debug.
                debug!(
                    session = %vac_session_id,
                    sub = %session_id,
                    parent = %parent,
                    "opencode tap: session.updated for non-root parent (skipped)"
                );
                return;
            }
            // Already bound? Nothing to do — tolerates repeated
            // `session.updated` frames opencode emits while a
            // sub-session is alive.
            if bindings.contains_key(session_id) {
                return;
            }
            let Some(acp) = weak_acp.upgrade() else {
                debug!(session = %vac_session_id, "opencode tap: AcpRuntime gone; cannot bind");
                return;
            };
            // Empty self_tool_call_id == "give me whatever's on top of
            // the task scope stack".
            match acp.current_task_parent("") {
                Some(parent_tc) => {
                    bindings.insert(session_id.clone(), parent_tc.clone());
                    info!(
                        session = %vac_session_id,
                        sub = %session_id,
                        parent_tc = %parent_tc,
                        "opencode tap: bound sub-session to parent task"
                    );
                }
                None => {
                    warn!(
                        session = %vac_session_id,
                        sub = %session_id,
                        "opencode tap: SSE session.updated arrived but task_scope is empty; sub-tool will surface as top-level"
                    );
                }
            }
        }
        OpencodeServeEvent::ToolCallStarted {
            session_id,
            tool_call_id,
            name,
            input,
        } => {
            let parent_tc = match bindings.get(session_id) {
                Some(v) => v.clone(),
                None => {
                    debug!(
                        session = %vac_session_id,
                        sub_session = %session_id,
                        tool_call_id = %tool_call_id,
                        tool = %name,
                        "opencode tap: tool.call.started for unbound sub-session (skipped)"
                    );
                    return;
                }
            };
            let activity = build_activity(
                vac_session_id,
                agent_id,
                agent_kind,
                tool_call_id,
                name,
                input,
                None,
                ToolStatus::InProgress,
                Some(parent_tc),
            );
            let _ = event_tx.send(SubagentToolEvent {
                activity,
                discriminator: "tool_call",
            });
        }
        OpencodeServeEvent::ToolCallCompleted {
            session_id,
            tool_call_id,
            output,
            status,
        } => {
            let parent_tc = match bindings.get(session_id) {
                Some(v) => v.clone(),
                None => {
                    debug!(
                        session = %vac_session_id,
                        sub_session = %session_id,
                        tool_call_id = %tool_call_id,
                        "opencode tap: tool.call.completed for unbound sub-session (skipped)"
                    );
                    return;
                }
            };
            // Translate opencode status string → ToolStatus.
            let status_enum = match status.as_str() {
                "completed" | "success" | "ok" => ToolStatus::Completed,
                "error" | "failed" | "cancelled" => ToolStatus::Failed,
                _ => ToolStatus::Completed,
            };
            // We don't have the original input on the completion frame;
            // the activity DTO can carry an empty input + the output.
            let activity = build_activity(
                vac_session_id,
                agent_id,
                agent_kind,
                tool_call_id,
                // We don't get the tool name on completion frames in
                // every opencode version — fall back to "tool" so the
                // FE has something to render. The rich lane will
                // re-key on tool_call_id anyway.
                "tool",
                &Value::Null,
                Some(output),
                status_enum,
                Some(parent_tc),
            );
            let _ = event_tx.send(SubagentToolEvent {
                activity,
                discriminator: "tool_call_update",
            });
        }
        OpencodeServeEvent::MessagePartUpdated { .. } => {
            // High-volume — stay quiet.
        }
        OpencodeServeEvent::Other { event_type, .. } => {
            debug!(
                session = %vac_session_id,
                event_type = %event_type,
                "opencode tap: other event"
            );
        }
    }
}

/// Map an opencode tool name onto the bridge's `(ToolKind, title)`
/// pair. The mapping mirrors X.5h.2's queued plan:
///
/// - `bash` → `Execute`, title `"Bash"`
/// - `read` → `Read`, title `"Read"`
/// - `edit`/`write` → `Edit`, title `"Edit"`/`"Write"`
/// - `grep`/`glob`/`list`/`ls` → `Read`, title capitalised
/// - `webfetch`/`fetch` → `Read`, title `"Web fetch"`
/// - everything else → `Other`, title is the verbatim name
fn map_tool_kind(name: &str) -> (ToolKind, String) {
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "bash" => (ToolKind::Execute, "Bash".into()),
        "read" => (ToolKind::Read, "Read".into()),
        "edit" => (ToolKind::Edit, "Edit".into()),
        "write" => (ToolKind::Edit, "Write".into()),
        "grep" => (ToolKind::Read, "Grep".into()),
        "glob" => (ToolKind::Read, "Glob".into()),
        "list" | "ls" => (ToolKind::Read, "List".into()),
        "webfetch" | "fetch" => (ToolKind::Read, "Web fetch".into()),
        _ => (ToolKind::Other, name.to_string()),
    }
}

/// Best-effort `[ToolLocation]` extraction from opencode tool input.
/// Recognized keys: `filePath` / `file_path` / `path`. Optional
/// `offset` / `line` becomes the location's line. Empty otherwise.
fn extract_locations(input: &Value) -> Vec<ToolLocation> {
    let path = input
        .get("filePath")
        .or_else(|| input.get("file_path"))
        .or_else(|| input.get("path"))
        .and_then(|v| v.as_str());
    let Some(path) = path else {
        return Vec::new();
    };
    let line = input
        .get("line")
        .or_else(|| input.get("offset"))
        .and_then(|v| v.as_u64());
    vec![ToolLocation {
        path: path.to_string(),
        line,
    }]
}

/// Best-effort `[ToolDiff]` extraction for `edit`/`write` calls.
/// `edit`: `{ filePath, oldString, newString }`.
/// `write`: `{ filePath, content }` — old text is `None`.
fn extract_diffs(name: &str, input: &Value) -> Vec<ToolDiff> {
    let lower = name.to_ascii_lowercase();
    let path = input
        .get("filePath")
        .or_else(|| input.get("file_path"))
        .or_else(|| input.get("path"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let Some(path) = path else {
        return Vec::new();
    };
    match lower.as_str() {
        "edit" => {
            let new_text = input
                .get("newString")
                .or_else(|| input.get("new_string"))
                .and_then(|v| v.as_str())
                .map(String::from);
            let old_text = input
                .get("oldString")
                .or_else(|| input.get("old_string"))
                .and_then(|v| v.as_str())
                .map(String::from);
            vec![ToolDiff {
                path,
                new_text,
                old_text,
            }]
        }
        "write" => {
            let new_text = input
                .get("content")
                .and_then(|v| v.as_str())
                .map(String::from);
            vec![ToolDiff {
                path,
                new_text,
                old_text: None,
            }]
        }
        _ => Vec::new(),
    }
}

/// Cap + stringify an opencode tool output for the
/// `raw_output_redacted` field. Same byte cap as the canonical ACP
/// path so a noisy bash tail doesn't pour megabytes into the ring.
fn output_to_redacted(output: &Value) -> Option<Value> {
    use crate::agent_runtime::acp::{bound_raw_output, redact_raw_output};
    if output.is_null() {
        return None;
    }
    let s = match output {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let scrubbed = redact_raw_output(&s);
    Some(Value::String(bound_raw_output(
        &scrubbed,
        DEFAULT_RAW_OUTPUT_CAP_BYTES,
    )))
}

#[allow(clippy::too_many_arguments)]
fn build_activity(
    vac_session_id: &str,
    agent_id: &str,
    agent_kind: AgentKind,
    tool_call_id: &str,
    name: &str,
    input: &Value,
    output: Option<&Value>,
    status: ToolStatus,
    parent_tool_call_id: Option<String>,
) -> ObservedToolActivity {
    let (kind, title) = map_tool_kind(name);
    // Namespace tool_call_id so it cannot collide with the canonical
    // ACP-emitted tool_call_id space — the FE uses tool_call_id as a
    // primary key for tool cards.
    let namespaced_id = format!("oc_sub_{}", tool_call_id);
    let raw_input_hash = if input.is_null() || matches!(input, Value::Object(o) if o.is_empty()) {
        None
    } else {
        Some(sha256_hex_canonical(input))
    };
    let raw_input_redacted = if input.is_null() {
        Value::Null
    } else {
        redact_raw_input(input)
    };
    let locations = extract_locations(input);
    let diffs = extract_diffs(name, input);
    let raw_output_redacted = output.and_then(output_to_redacted);

    ObservedToolActivity {
        session_id: vac_session_id.to_string(),
        agent_id: agent_id.to_string(),
        agent_kind,
        tool_call_id: namespaced_id,
        kind,
        title: Some(title),
        status,
        locations,
        diffs,
        approval_tool_call_hash: None,
        raw_input_hash,
        raw_input_redacted,
        raw_output_redacted,
        approved_by_approval_id: None,
        ts: chrono::Utc::now(),
        // Hint downstream that this DTO came from the opencode HTTP
        // tap, not the canonical ACP `session/update` shape. The FE
        // can use this to badge sub-tools differently if it wants.
        raw_shape: Some("opencode_serve".into()),
        parent_tool_call_id,
        // The sub-tool itself isn't a Task; its parent is. Leave empty.
        subagent_type: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn binding_lookup_returns_inserted_value() {
        let bindings: DashMap<String, String> = DashMap::new();
        bindings.insert("ses_sub".into(), "tc_parent".into());
        assert_eq!(
            bindings.get("ses_sub").map(|v| v.clone()),
            Some("tc_parent".to_string())
        );
    }

    #[test]
    fn map_tool_kind_covers_known_tools() {
        assert!(matches!(map_tool_kind("bash").0, ToolKind::Execute));
        assert!(matches!(map_tool_kind("BASH").0, ToolKind::Execute));
        assert!(matches!(map_tool_kind("read").0, ToolKind::Read));
        assert!(matches!(map_tool_kind("edit").0, ToolKind::Edit));
        assert!(matches!(map_tool_kind("write").0, ToolKind::Edit));
        assert!(matches!(map_tool_kind("grep").0, ToolKind::Read));
        assert!(matches!(map_tool_kind("glob").0, ToolKind::Read));
        assert!(matches!(map_tool_kind("unknown_tool").0, ToolKind::Other));
    }

    #[test]
    fn build_activity_namespaces_tool_call_id_and_sets_parent() {
        let act = build_activity(
            "vac_1",
            "opencode",
            AgentKind::Acp,
            "call_xyz",
            "bash",
            &json!({"command":"ls"}),
            None,
            ToolStatus::InProgress,
            Some("tc_parent".into()),
        );
        assert_eq!(act.tool_call_id, "oc_sub_call_xyz");
        assert_eq!(act.kind, ToolKind::Execute);
        assert_eq!(act.title.as_deref(), Some("Bash"));
        assert_eq!(act.parent_tool_call_id.as_deref(), Some("tc_parent"));
        assert_eq!(act.raw_shape.as_deref(), Some("opencode_serve"));
        assert_eq!(act.raw_input_redacted["command"], json!("ls"));
        assert!(act.raw_input_hash.is_some());
    }

    #[test]
    fn extract_locations_pulls_filepath_and_line() {
        let locs = extract_locations(&json!({
            "filePath": "/repo/main.rs",
            "offset": 12,
            "limit": 50
        }));
        assert_eq!(locs.len(), 1);
        assert_eq!(locs[0].path, "/repo/main.rs");
        assert_eq!(locs[0].line, Some(12));
    }

    #[test]
    fn extract_diffs_for_edit_and_write() {
        let edit = extract_diffs(
            "edit",
            &json!({
                "filePath": "/repo/a.rs",
                "oldString": "foo",
                "newString": "bar"
            }),
        );
        assert_eq!(edit.len(), 1);
        assert_eq!(edit[0].path, "/repo/a.rs");
        assert_eq!(edit[0].new_text.as_deref(), Some("bar"));
        assert_eq!(edit[0].old_text.as_deref(), Some("foo"));
        let write = extract_diffs(
            "write",
            &json!({ "filePath": "/repo/b.rs", "content": "hi\n" }),
        );
        assert_eq!(write.len(), 1);
        assert!(write[0].old_text.is_none());
        assert_eq!(write[0].new_text.as_deref(), Some("hi\n"));
        let bash = extract_diffs("bash", &json!({"command":"x"}));
        assert!(bash.is_empty());
    }

    #[test]
    fn output_to_redacted_passes_string_through_within_cap() {
        let v = output_to_redacted(&json!("hello world"));
        assert_eq!(v, Some(json!("hello world")));
    }

    #[test]
    fn output_to_redacted_returns_none_for_null() {
        assert!(output_to_redacted(&Value::Null).is_none());
    }
}
