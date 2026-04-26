//! Stage X.5c.2 — observe-only tool-activity DTO + redaction helpers.
//!
//! See [`docs/plans/stage-x5c2-tool-activity-observation.md`](../../../../../docs/plans/stage-x5c2-tool-activity-observation.md)
//! for the full design. This module defines:
//!
//! - [`ObservedToolActivity`] — the bridge-internal normalized shape
//!   that web stores see (never the agent's raw `_meta` payload).
//! - [`extract_observed_tool_activity`] — builds the DTO from a raw
//!   `session/update` notification of variant `tool_call` or
//!   `tool_call_update`.
//! - [`bound_raw_output`] — caps `rawOutput` so a noisy Bash run
//!   doesn't pour megabytes into the audit log.
//! - [`redact_raw_input`] — masks env/secret-shaped keys.
//!
//! **Observe-only.** Nothing here enables fs/terminal capabilities or
//! blocks tool execution — that's X.5c.3 territory.

use super::hash::sha256_hex_canonical;
use crate::agent_runtime::AgentKind;
use serde::Serialize;
use serde_json::{json, Value};

/// Default cap for `rawOutput` payloads (64 KiB). Matches the
/// `output_cap_bytes` default in `shell_allowlist`. Truncated content
/// is suffixed with the marker below.
pub const DEFAULT_RAW_OUTPUT_CAP_BYTES: usize = 64 * 1024;
pub const TRUNCATION_MARKER: &str = "\n…[truncated by VAC bridge]";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Read,
    Edit,
    Execute,
    Other,
}

impl ToolKind {
    pub fn from_acp(kind: &str) -> Self {
        match kind {
            "read" => Self::Read,
            "edit" => Self::Edit,
            "execute" => Self::Execute,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

impl ToolStatus {
    pub fn from_acp(status: Option<&str>) -> Self {
        match status {
            Some("pending") => Self::Pending,
            Some("in_progress") | Some("running") => Self::InProgress,
            Some("completed") => Self::Completed,
            Some("failed") => Self::Failed,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolLocation {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
}

/// One file-edit diff carried by a `tool_call_update`'s `content[]`
/// when the entry has `type:"diff"`. Fields mirror the agent payload
/// so the Review lane can render the change directly.
#[derive(Debug, Clone, Serialize)]
pub struct ToolDiff {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObservedToolActivity {
    pub session_id: String,
    pub agent_id: String,
    #[serde(serialize_with = "ser_agent_kind")]
    pub agent_kind: AgentKind,
    pub tool_call_id: String,
    pub kind: ToolKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub status: ToolStatus,
    pub locations: Vec<ToolLocation>,
    /// File-edit diffs extracted from `update.content[]` entries
    /// whose `type` is `"diff"`. Empty unless `kind:"edit"`.
    pub diffs: Vec<ToolDiff>,
    /// `sha256(canonical(full toolCall))` — same input the X.5c.1
    /// `sha256_hex_canonical(&resolution.tool_call)` audit line
    /// records as `args_hash`. Joinable byte-for-byte.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_tool_call_hash: Option<String>,
    /// `sha256(canonical(toolCall.rawInput))`. Activity-level dedupe
    /// only — never the approval correlation key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input_hash: Option<String>,
    pub raw_input_redacted: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output_redacted: Option<Value>,
    /// Filled by [`crate::session::AcpRuntime`] correlation cache when
    /// a recent X.5c.1 approval matches by toolCallId or
    /// approval_tool_call_hash. Left `None` for non-correlated
    /// activity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_by_approval_id: Option<String>,
    pub ts: chrono::DateTime<chrono::Utc>,
}

fn ser_agent_kind<S: serde::Serializer>(k: &AgentKind, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(k.as_str())
}

/// Build an `ObservedToolActivity` from a raw `session/update`
/// notification whose `update.sessionUpdate` is `tool_call` or
/// `tool_call_update`. Returns `None` for any other variant so the
/// caller can fall through to its default ignore branch.
///
/// `session_id` / `agent_id` / `agent_kind` come from the bridge's
/// SessionHandle, not the agent payload.
pub fn extract_observed_tool_activity(
    session_id: &str,
    agent_id: &str,
    agent_kind: AgentKind,
    notif_params: &Value,
    raw_output_cap_bytes: usize,
) -> Option<ObservedToolActivity> {
    let update = notif_params.get("update")?;
    let disc = update.get("sessionUpdate").and_then(|v| v.as_str())?;
    if disc != "tool_call" && disc != "tool_call_update" {
        return None;
    }
    let tool_call_id = update
        .get("toolCallId")
        .and_then(|v| v.as_str())?
        .to_string();
    let kind = update
        .get("kind")
        .and_then(|v| v.as_str())
        .map(ToolKind::from_acp)
        .unwrap_or(ToolKind::Other);
    let title = update
        .get("title")
        .and_then(|v| v.as_str())
        .map(String::from);
    let status = ToolStatus::from_acp(update.get("status").and_then(|v| v.as_str()));
    let locations = extract_locations(update);
    let diffs = extract_diffs(update);

    // `tool_call` (pending shape) typically carries an empty
    // rawInput; later `tool_call_update`s fill it. Hashes are present
    // only when the source field is.
    let raw_input = update.get("rawInput").cloned();
    let raw_input_hash = raw_input.as_ref().and_then(|v| {
        if v.is_null() || matches!(v, Value::Object(o) if o.is_empty()) {
            None
        } else {
            Some(sha256_hex_canonical(v))
        }
    });
    let raw_input_redacted = raw_input
        .as_ref()
        .map(redact_raw_input)
        .unwrap_or(Value::Null);

    // `approval_tool_call_hash` hashes the *full* toolCall envelope
    // — same input the X.5c.1 audit row uses for `args_hash`. We
    // synthesize the toolCall object from the update fields the
    // agent sent, omitting `sessionUpdate` itself so the hash matches
    // what `session/request_permission.params.toolCall` would carry.
    let synthesized = synthesize_tool_call(&tool_call_id, update);
    let approval_tool_call_hash = synthesized.as_ref().map(sha256_hex_canonical);

    let raw_output_redacted = update.get("rawOutput").cloned().map(|v| match v {
        Value::String(s) => Value::String(bound_raw_output(&s, raw_output_cap_bytes)),
        other => other,
    });

    Some(ObservedToolActivity {
        session_id: session_id.to_string(),
        agent_id: agent_id.to_string(),
        agent_kind,
        tool_call_id,
        kind,
        title,
        status,
        locations,
        diffs,
        approval_tool_call_hash,
        raw_input_hash,
        raw_input_redacted,
        raw_output_redacted,
        approved_by_approval_id: None,
        ts: chrono::Utc::now(),
    })
}

fn extract_diffs(update: &Value) -> Vec<ToolDiff> {
    update
        .get("content")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let ty = c.get("type").and_then(|v| v.as_str())?;
                    if ty != "diff" {
                        return None;
                    }
                    let path = c.get("path").and_then(|v| v.as_str())?.to_string();
                    let new_text = c.get("newText").and_then(|v| v.as_str()).map(String::from);
                    let old_text = c.get("oldText").and_then(|v| v.as_str()).map(String::from);
                    Some(ToolDiff {
                        path,
                        new_text,
                        old_text,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn extract_locations(update: &Value) -> Vec<ToolLocation> {
    update
        .get("locations")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|loc| {
                    let path = loc.get("path").and_then(|v| v.as_str())?.to_string();
                    let line = loc.get("line").and_then(|v| v.as_u64());
                    Some(ToolLocation { path, line })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Build a toolCall-shaped object from a `session/update` payload so
/// `approval_tool_call_hash` matches the X.5c.1 audit row's
/// `args_hash` for the same logical tool. The shape mirrors what the
/// agent originally sent on `session/request_permission.params.toolCall`:
///
/// `{ toolCallId, kind?, title?, content?, locations?, rawInput? }`
///
/// Returns `None` if no recognizable tool fields are present.
fn synthesize_tool_call(tool_call_id: &str, update: &Value) -> Option<Value> {
    let mut obj = serde_json::Map::new();
    obj.insert("toolCallId".into(), json!(tool_call_id));
    let mut any_field = false;
    for f in [
        "kind",
        "title",
        "content",
        "locations",
        "rawInput",
        "status",
    ] {
        if let Some(v) = update.get(f).cloned() {
            obj.insert(f.into(), v);
            any_field = true;
        }
    }
    if any_field {
        Some(Value::Object(obj))
    } else {
        None
    }
}

/// Truncate `s` to `cap_bytes` (rounded up to the next char boundary)
/// and append [`TRUNCATION_MARKER`]. Strings under the cap pass
/// through unchanged.
pub fn bound_raw_output(s: &str, cap_bytes: usize) -> String {
    if s.len() <= cap_bytes {
        return s.to_string();
    }
    let mut end = cap_bytes;
    while end < s.len() && !s.is_char_boundary(end) {
        end += 1;
    }
    let mut out = String::with_capacity(end + TRUNCATION_MARKER.len());
    out.push_str(&s[..end]);
    out.push_str(TRUNCATION_MARKER);
    out
}

/// Mask values whose key looks like a credential. Recursive across
/// objects + arrays. Strings only — numeric/bool secrets stay (they
/// shouldn't exist; if they do, the calling code has bigger issues).
pub fn redact_raw_input(value: &Value) -> Value {
    fn is_secret_key(k: &str) -> bool {
        let upper = k.to_ascii_uppercase();
        upper == "ENV"
            || upper.contains("API_KEY")
            || upper.contains("APIKEY")
            || upper.contains("TOKEN")
            || upper.contains("SECRET")
            || upper.ends_with("_KEY")
            || upper == "KEY"
            || upper == "PASSWORD"
            || upper == "PASSWD"
    }
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::with_capacity(map.len());
            for (k, v) in map {
                if is_secret_key(k) {
                    out.insert(k.clone(), Value::String("<REDACTED>".into()));
                } else {
                    out.insert(k.clone(), redact_raw_input(v));
                }
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(redact_raw_input).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redact_masks_env_and_secret_keys() {
        let raw = json!({
            "command": "deploy",
            "env": { "DB_URL": "postgres://x" },
            "API_KEY": "sk-abc",
            "auth_token": "abc",
            "github_secret": "xxx",
            "MY_SERVICE_KEY": "yy",
            "nested": [{ "password": "p" }],
            "harmless": "ok"
        });
        let red = redact_raw_input(&raw);
        assert_eq!(red["command"], json!("deploy"));
        assert_eq!(red["env"], json!("<REDACTED>"));
        assert_eq!(red["API_KEY"], json!("<REDACTED>"));
        assert_eq!(red["auth_token"], json!("<REDACTED>"));
        assert_eq!(red["github_secret"], json!("<REDACTED>"));
        assert_eq!(red["MY_SERVICE_KEY"], json!("<REDACTED>"));
        assert_eq!(red["nested"][0]["password"], json!("<REDACTED>"));
        assert_eq!(red["harmless"], json!("ok"));
    }

    #[test]
    fn bound_raw_output_truncates() {
        let s = "x".repeat(200);
        let bounded = bound_raw_output(&s, 50);
        assert!(bounded.starts_with(&"x".repeat(50)));
        assert!(bounded.ends_with(TRUNCATION_MARKER));
    }

    #[test]
    fn bound_raw_output_passthrough_under_cap() {
        let s = "small";
        assert_eq!(bound_raw_output(s, 64), "small");
    }

    #[test]
    fn extract_returns_none_for_non_tool_variant() {
        let n = json!({
            "sessionId": "sid",
            "update": { "sessionUpdate": "agent_message_chunk", "content": {} }
        });
        assert!(extract_observed_tool_activity(
            "sid",
            "claude",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES
        )
        .is_none());
    }

    #[test]
    fn extract_edit_tool_update_with_diff() {
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc-1",
                "kind": "edit",
                "title": "Write hello.md",
                "status": "pending",
                "locations": [{ "path": "/repo/hello.md" }],
                "content": [{
                    "type": "diff",
                    "path": "/repo/hello.md",
                    "newText": "hi\n",
                    "oldText": null
                }],
                "rawInput": { "file_path": "/repo/hello.md", "content": "hi\n" }
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "claude",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .unwrap();
        assert_eq!(dto.tool_call_id, "tc-1");
        assert_eq!(dto.kind, ToolKind::Edit);
        assert_eq!(dto.status, ToolStatus::Pending);
        assert_eq!(dto.locations.len(), 1);
        assert_eq!(dto.locations[0].path, "/repo/hello.md");
        assert!(dto.raw_input_hash.is_some());
        assert!(dto.approval_tool_call_hash.is_some());
        // The two hashes must NOT be the same value.
        assert_ne!(dto.raw_input_hash, dto.approval_tool_call_hash);
    }

    #[test]
    fn approval_tool_call_hash_matches_audit_input_byte_for_byte() {
        // Build a tool_call_update with a known toolCall surface, then
        // separately build the toolCall object the X.5c.1 audit row
        // would hash via `sha256_hex_canonical(&resolution.tool_call)`.
        // Both must produce the same hash.
        let update_payload = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc-1",
                "kind": "edit",
                "title": "Write hello.md",
                "locations": [{ "path": "/repo/hello.md" }],
                "content": [{
                    "type": "diff",
                    "path": "/repo/hello.md",
                    "newText": "hi\n",
                    "oldText": null
                }],
                "rawInput": { "file_path": "/repo/hello.md", "content": "hi\n" }
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "claude",
            AgentKind::Acp,
            &update_payload,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .unwrap();

        // The X.5c.1 path hashes the toolCall the agent originally sent
        // on session/request_permission.params.toolCall.
        let x5c1_tool_call = json!({
            "toolCallId": "tc-1",
            "kind": "edit",
            "title": "Write hello.md",
            "locations": [{ "path": "/repo/hello.md" }],
            "content": [{
                "type": "diff",
                "path": "/repo/hello.md",
                "newText": "hi\n",
                "oldText": null
            }],
            "rawInput": { "file_path": "/repo/hello.md", "content": "hi\n" }
        });
        let x5c1_hash = sha256_hex_canonical(&x5c1_tool_call);
        assert_eq!(
            dto.approval_tool_call_hash.as_deref(),
            Some(x5c1_hash.as_str())
        );
    }

    #[test]
    fn extract_redacts_env_in_raw_input() {
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc-1",
                "kind": "execute",
                "rawInput": {
                    "command": "deploy",
                    "API_KEY": "leaky"
                }
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "claude",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .unwrap();
        assert_eq!(dto.raw_input_redacted["API_KEY"], json!("<REDACTED>"));
        assert_eq!(dto.raw_input_redacted["command"], json!("deploy"));
        // The raw_input_hash must be computed BEFORE redaction so the
        // hash stays stable across redaction policy changes — verify
        // by re-computing the hash on the un-redacted payload.
        let unredacted_hash = sha256_hex_canonical(&n["update"]["rawInput"]);
        assert_eq!(
            dto.raw_input_hash.as_deref(),
            Some(unredacted_hash.as_str())
        );
    }

    #[test]
    fn diffs_extracted_from_edit_content() {
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc-1",
                "kind": "edit",
                "locations": [{ "path": "/repo/a.txt" }, { "path": "/repo/b.txt" }],
                "content": [
                    { "type": "diff", "path": "/repo/a.txt", "newText": "A", "oldText": null },
                    { "type": "diff", "path": "/repo/b.txt", "newText": "B", "oldText": "old" },
                    { "type": "content", "content": { "type":"text", "text": "noise" } }
                ]
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "claude",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .unwrap();
        assert_eq!(dto.diffs.len(), 2, "non-diff entries must be filtered out");
        assert_eq!(dto.diffs[0].path, "/repo/a.txt");
        assert_eq!(dto.diffs[0].new_text.as_deref(), Some("A"));
        assert!(dto.diffs[0].old_text.is_none());
        assert_eq!(dto.diffs[1].path, "/repo/b.txt");
        assert_eq!(dto.diffs[1].old_text.as_deref(), Some("old"));
    }

    #[test]
    fn raw_output_truncated_in_dto() {
        let big = "x".repeat(200_000);
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc-1",
                "kind": "execute",
                "status": "completed",
                "rawOutput": big
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "claude",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .unwrap();
        let s = dto
            .raw_output_redacted
            .as_ref()
            .and_then(|v| v.as_str())
            .unwrap();
        assert!(s.len() < 100_000);
        assert!(s.ends_with(TRUNCATION_MARKER));
    }
}
