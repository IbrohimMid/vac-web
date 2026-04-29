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

use super::hash::{
    sha256_hex_canonical, sha256_hex_canonical_excluding, TOOL_CALL_HASH_DROP_FIELDS,
};
use crate::agent_runtime::AgentKind;
use serde::Serialize;
use serde_json::{json, Value};

/// Default cap for `rawOutput` payloads (64 KiB). Matches the
/// `output_cap_bytes` default in `shell_allowlist`. Truncated content
/// is suffixed with the marker below.
pub const DEFAULT_RAW_OUTPUT_CAP_BYTES: usize = 64 * 1024;
pub const TRUNCATION_MARKER: &str = "\n…[truncated by VAC bridge]";
pub const SECRET_REDACTION: &str = "<REDACTED-SECRET>";

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
    /// Hint about the wire shape this DTO was extracted from.
    /// `None` for the canonical ACP shape (camelCase `toolCallId`
    /// well-formed). `Some("gemini")` when we had to fall back to
    /// snake_case `tool_call_id` / a bare `id`, or synthesize the
    /// id from the payload hash. Lets the FE label provider quirks
    /// without re-parsing the wire payload, and lets the X.5f.3
    /// dogfood test assert that Gemini-shape tool calls were
    /// successfully normalized rather than silently dropped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_shape: Option<String>,
    /// X.5h.1 — parent sub-agent task tool_call_id when this tool was
    /// dispatched inside an OpenCode-style `task` (sub-agent). Set by
    /// [`SessionHandle::map_tool_activity`] from the AcpRuntime task
    /// scope stack; left `None` for the canonical top-level case.
    /// The FE uses this to render a Trae-style nested tree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_call_id: Option<String>,
    /// X.5h.1 — for `task` parent tool calls, the dispatched
    /// subagent kind (e.g. `"explore"`, `"code"`, `"search"`).
    /// Mirrors `raw_input.subagent_type`. Lets the FE render the
    /// agent badge (`Sub Coding Agent`, `Search Agent`, …) without
    /// re-parsing the redacted input on the FE side.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_type: Option<String>,
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
    // Tolerate provider variants. ACP canonical shape uses
    // camelCase `toolCallId`; the X.5f.3 dogfood report showed
    // Gemini CLI ACP emitting `tool_call` / `tool_call_update`
    // discriminators whose normalized tool count stayed at 0,
    // which means this extractor was returning `None` on real
    // Gemini payloads. We now also accept snake_case
    // `tool_call_id` and a bare `id`, and as a last resort
    // synthesize a stable id from the payload hash so the rest
    // of the pipeline still gets a tool card. The `raw_shape`
    // hint propagates downstream so the FE can label provider
    // quirks.
    let (tool_call_id, raw_shape) = resolve_tool_call_id(update);
    let kind = update
        .get("kind")
        .and_then(|v| v.as_str())
        .map(ToolKind::from_acp)
        .unwrap_or(ToolKind::Other);
    let title_from_payload = update
        .get("title")
        .and_then(|v| v.as_str())
        .map(String::from);
    // Non-canonical shapes that don't carry a title get a
    // meaningful default so the FE never renders an empty header.
    let title = match (title_from_payload, raw_shape.as_deref()) {
        (Some(t), _) => Some(t),
        (None, Some("gemini")) => Some("Gemini tool call".to_string()),
        (None, _) => None,
    };
    // `tool_call` without an explicit status defaults to pending;
    // `tool_call_update` without an explicit status defaults to
    // in_progress (an incremental update with no status field
    // must NOT silently downgrade a previously completed/failed
    // state to pending).
    let status = match update.get("status").and_then(|v| v.as_str()) {
        Some(s) => ToolStatus::from_acp(Some(s)),
        None if disc == "tool_call_update" => ToolStatus::InProgress,
        None => ToolStatus::Pending,
    };
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

    // `approval_tool_call_hash` hashes the toolCall envelope with
    // runtime-only fields (toolCallId, status, rawOutput) stripped at
    // the top level. Same helper as the X.5c.1 audit `args_hash`
    // computation, so a tool_call_update whose only diff from the
    // approved permission is its toolCallId/status hashes identically
    // and the X.5c.2 fallback correlation can hit.
    let synthesized = synthesize_tool_call(&tool_call_id, update);
    let approval_tool_call_hash = synthesized
        .as_ref()
        .map(|tc| sha256_hex_canonical_excluding(tc, TOOL_CALL_HASH_DROP_FIELDS));

    let raw_output_redacted = update.get("rawOutput").cloned().map(|v| match v {
        Value::String(s) => {
            // Redact-then-bound: secret patterns get masked first so a
            // long secret near the cap doesn't end up half-masked /
            // half-leaked at the truncation boundary.
            let scrubbed = redact_raw_output(&s);
            Value::String(bound_raw_output(&scrubbed, raw_output_cap_bytes))
        }
        other => other,
    });

    // X.5h.1 — if the agent's redacted input still carries a
    // `subagent_type` field (OpenCode `task` tool shape:
    // `{ description, subagent_type, prompt }`), surface it on the DTO
    // so the FE can render the right sub-agent badge. Other providers
    // and other tool kinds typically don't carry this key, so it stays
    // `None`.
    let subagent_type = raw_input_redacted
        .get("subagent_type")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

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
        raw_shape,
        parent_tool_call_id: None,
        subagent_type,
    })
}

/// Resolve the tool-call id from an ACP `session/update` payload,
/// tolerating provider-specific spellings.
///
/// Order of preference:
///
/// 1. Canonical ACP camelCase `toolCallId` → `(id, None)`.
/// 2. Snake_case `tool_call_id` → `(id, Some("gemini"))`.
/// 3. Bare `id` → `(id, Some("gemini"))`.
/// 4. Synthesize `synth_<short_hash>` from a stable subset of the
///    update payload (drops `status` and any `rawOutput*` field so
///    the eventual `tool_call_update` from the same logical call
///    hashes to the same id) → `(synth, Some("gemini"))`.
///
/// The synthesized fallback is intentionally *deterministic* so
/// `tool_call` and a follow-up `tool_call_update` from the same
/// logical call still correlate, and `tool.diff.updated` /
/// `tool.terminal.updated` events still attach to the same card.
fn resolve_tool_call_id(update: &Value) -> (String, Option<String>) {
    if let Some(id) = update.get("toolCallId").and_then(|v| v.as_str()) {
        if !id.is_empty() {
            return (id.to_string(), None);
        }
    }
    if let Some(id) = update.get("tool_call_id").and_then(|v| v.as_str()) {
        if !id.is_empty() {
            return (id.to_string(), Some("gemini".to_string()));
        }
    }
    if let Some(id) = update.get("id").and_then(|v| v.as_str()) {
        if !id.is_empty() {
            return (id.to_string(), Some("gemini".to_string()));
        }
    }
    // Stable synthetic id: hash the update payload with the
    // runtime-only fields (`status`, `rawOutput`, snake_case
    // variants) stripped so an in_progress→completed pair from the
    // same logical call hashes identically.
    let mut for_hash = update.clone();
    if let Value::Object(ref mut m) = for_hash {
        m.remove("status");
        m.remove("rawOutput");
        m.remove("raw_output");
        m.remove("sessionUpdate");
        m.remove("session_update");
    }
    let h = sha256_hex_canonical(&for_hash);
    let synth = format!("synth_{}", &h[..16.min(h.len())]);
    (synth, Some("gemini".to_string()))
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
/// Runtime-only fields (`status`, `rawOutput`, `_meta`) are
/// **deliberately excluded** so a `tool_call_update` whose only diff
/// from the original is `status:"completed"` still hashes identically.
/// Without this exclusion the X.5c.2 fallback correlation would never
/// hit, breaking the BLOCKER-2 contract.
///
/// Returns `None` if no recognizable tool fields are present.
fn synthesize_tool_call(tool_call_id: &str, update: &Value) -> Option<Value> {
    let mut obj = serde_json::Map::new();
    obj.insert("toolCallId".into(), json!(tool_call_id));
    let mut any_field = false;
    for f in ["kind", "title", "content", "locations", "rawInput"] {
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

/// Mask known secret-shaped substrings in `rawOutput`. Anchored
/// patterns:
///
/// - Anthropic / OpenAI-style API keys: `sk-…` followed by 16+ tokens
///   chars (hex / dash / underscore).
/// - GitHub tokens: `ghp_…` / `gho_…` / `ghu_…` / `ghs_…` / `ghr_…`
///   followed by 30+ chars.
/// - Slack bot tokens: `xoxb-…`, `xoxp-…`, `xoxa-…`, `xoxr-…` followed
///   by structured `-`-separated chunks.
/// - HTTP `Authorization: Bearer <opaque>` headers.
/// - AWS access keys: `AKIA[A-Z0-9]{16}`.
///
/// This is best-effort — it can't catch arbitrary secrets, only the
/// well-known shapes most likely to leak through Bash output. Apply
/// before [`bound_raw_output`] so a half-truncated secret never ends
/// up unmasked.
pub fn redact_raw_output(s: &str) -> String {
    use std::sync::OnceLock;
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    let regexes = PATTERNS.get_or_init(|| {
        [
            // sk-... (Anthropic/OpenAI-style). 16+ chars after sk-
            // (anchor on word boundary so middle-of-word "sk-" doesn't
            // false-positive).
            r"\bsk-[A-Za-z0-9_-]{16,}",
            // GitHub token prefixes.
            r"\bgh[opusr]_[A-Za-z0-9]{30,}",
            // Slack tokens.
            r"\bxox[baprs]-[A-Za-z0-9-]{10,}",
            // AWS access key id.
            r"\bAKIA[A-Z0-9]{16}\b",
            // Authorization: Bearer <token>
            r"(?i)\bAuthorization:\s*Bearer\s+\S+",
        ]
        .iter()
        .filter_map(|p| regex::Regex::new(p).ok())
        .collect()
    });
    let mut out = s.to_string();
    for re in regexes {
        out = re.replace_all(&out, SECRET_REDACTION).into_owned();
    }
    out
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
        let x5c1_hash = sha256_hex_canonical_excluding(&x5c1_tool_call, TOOL_CALL_HASH_DROP_FIELDS);
        assert_eq!(
            dto.approval_tool_call_hash.as_deref(),
            Some(x5c1_hash.as_str())
        );
    }

    #[test]
    fn approval_tool_call_hash_invariant_under_id_rotation() {
        // The whole point of dropping toolCallId from the hash:
        // permission's toolCall and a later tool_call_update with a
        // rotated id hash to the same value.
        let perm_tool_call = json!({
            "toolCallId": "tc_perm",
            "kind": "edit",
            "title": "Mock Tool",
            "content": [{ "type":"diff", "path":"/tmp/mock", "newText":"x", "oldText":null }],
            "locations": [{ "path": "/tmp/mock" }],
            "rawInput": { "file_path": "/tmp/mock", "content": "x" }
        });
        let permission_hash =
            sha256_hex_canonical_excluding(&perm_tool_call, TOOL_CALL_HASH_DROP_FIELDS);

        let update_payload = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc_after",      // rotated
                "kind": "edit",
                "title": "Mock Tool",
                "status": "completed",         // runtime-only — must drop
                "content": [{ "type":"diff", "path":"/tmp/mock", "newText":"x", "oldText":null }],
                "locations": [{ "path": "/tmp/mock" }],
                "rawInput": { "file_path": "/tmp/mock", "content": "x" },
                "rawOutput": "File written"    // runtime-only — must drop
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
        assert_eq!(dto.tool_call_id, "tc_after");
        assert_eq!(
            dto.approval_tool_call_hash.as_deref(),
            Some(permission_hash.as_str()),
            "rotated toolCallId + runtime status/rawOutput must NOT \
             change the approval_tool_call_hash"
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
    fn redact_raw_output_masks_known_secret_shapes() {
        let s = "leaked sk-ant-1234567890abcdef and ghp_aabbccddeeff112233445566778899AABB \
                 plus AKIAABCDEFGHIJKLMNOP and Authorization: Bearer eyJhbGciOiJI \
                 plus xoxb-12345-67890-abcdefghij";
        let red = redact_raw_output(s);
        assert!(!red.contains("sk-ant-1234"));
        assert!(!red.contains("ghp_aabbcc"));
        assert!(!red.contains("AKIAABCDEFGHIJKLMNOP"));
        assert!(!red.contains("eyJhbGciOiJI"));
        assert!(!red.contains("xoxb-12345-67890"));
        assert!(red.contains(SECRET_REDACTION));
        // Surrounding "leaked" / "and" stay so log context is preserved.
        assert!(red.contains("leaked"));
        assert!(red.contains("and"));
    }

    #[test]
    fn redact_then_bound_in_dto() {
        // 70 KB of `x` followed by an API key — bound the input so
        // truncation never strips the masked secret.
        let mut s = "x".repeat(70 * 1024);
        s.push_str(" sk-ant-1234567890abcdef0000");
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc-1",
                "kind": "execute",
                "status": "completed",
                "rawInput": { "command": "echo …" },
                "rawOutput": s
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
        let out = dto
            .raw_output_redacted
            .as_ref()
            .and_then(|v| v.as_str())
            .unwrap();
        // Truncation kicks in on the (now-redacted) string.
        assert!(out.ends_with(TRUNCATION_MARKER) || out.len() <= DEFAULT_RAW_OUTPUT_CAP_BYTES);
        assert!(!out.contains("sk-ant-1234567890"));
    }

    // ---------- X.5f.3 Patch A — Gemini-shape tolerance ----------

    /// Canonical ACP shape (camelCase `toolCallId`, full fields)
    /// must continue to extract with `raw_shape == None` so the
    /// existing Claude-agent-acp acceptance contract is unchanged.
    #[test]
    fn canonical_camel_case_shape_has_no_raw_shape_hint() {
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "tc-1",
                "kind": "read",
                "title": "Read File",
                "status": "pending"
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "claude-agent-acp",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .unwrap();
        assert_eq!(dto.tool_call_id, "tc-1");
        assert_eq!(dto.kind, ToolKind::Read);
        assert_eq!(dto.status, ToolStatus::Pending);
        assert_eq!(dto.title.as_deref(), Some("Read File"));
        assert!(
            dto.raw_shape.is_none(),
            "canonical shape must not be tagged as gemini"
        );
    }

    /// Gemini-style snake_case `tool_call_id` must extract with
    /// `raw_shape == Some("gemini")` and a sane default title so
    /// the FE renders a non-empty card.
    #[test]
    fn gemini_shape_snake_case_tool_call_id_extracts() {
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call",
                "tool_call_id": "tc_gemini_1"
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "gemini-acp",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .expect("snake_case tool_call_id must not be silently dropped");
        assert_eq!(dto.tool_call_id, "tc_gemini_1");
        assert_eq!(dto.kind, ToolKind::Other);
        assert_eq!(dto.status, ToolStatus::Pending);
        assert_eq!(dto.title.as_deref(), Some("Gemini tool call"));
        assert_eq!(dto.raw_shape.as_deref(), Some("gemini"));
    }

    /// A Gemini `tool_call_update` lacking an explicit status must
    /// default to `in_progress`, never silently downgrade a real
    /// completed/failed state to pending.
    #[test]
    fn gemini_shape_tool_call_update_without_status_defaults_in_progress() {
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "tool_call_id": "tc_gemini_1",
                "locations": [{ "path": "/repo/file.rs" }]
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "gemini-acp",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .expect("snake_case tool_call_update must extract");
        assert_eq!(dto.status, ToolStatus::InProgress);
        assert_eq!(dto.locations.len(), 1);
        assert_eq!(dto.raw_shape.as_deref(), Some("gemini"));
    }

    /// Bare `id` field (no `toolCallId` of any case) extracts via
    /// the third fallback rung.
    #[test]
    fn gemini_shape_bare_id_extracts() {
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call",
                "id": "call_abc123"
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "gemini-acp",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .expect("bare `id` must not be silently dropped");
        assert_eq!(dto.tool_call_id, "call_abc123");
        assert_eq!(dto.raw_shape.as_deref(), Some("gemini"));
    }

    /// A Gemini `tool_call` with NO recognizable id field must
    /// still produce a normalized DTO via the synthetic-id rung,
    /// and a follow-up `tool_call_update` with the same body
    /// (modulo `status` / `rawOutput`) must hash to the same id
    /// so diff/terminal/review correlation still works.
    #[test]
    fn gemini_shape_missing_id_synthesizes_stable_id_across_pair() {
        let create = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call",
                "kind": "execute",
                "title": "Run command",
                "rawInput": { "command": "ls -la" }
            }
        });
        let update = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call_update",
                "kind": "execute",
                "title": "Run command",
                "status": "completed",
                "rawInput": { "command": "ls -la" },
                "rawOutput": "total 0\n"
            }
        });
        let dto_create = extract_observed_tool_activity(
            "sid",
            "gemini-acp",
            AgentKind::Acp,
            &create,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .expect("missing id must synthesize, not drop");
        let dto_update = extract_observed_tool_activity(
            "sid",
            "gemini-acp",
            AgentKind::Acp,
            &update,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .expect("follow-up update must also synthesize");
        assert!(dto_create.tool_call_id.starts_with("synth_"));
        assert_eq!(
            dto_create.tool_call_id, dto_update.tool_call_id,
            "create+update of same logical call must hash to same synthesized id"
        );
        assert_eq!(dto_create.status, ToolStatus::Pending);
        assert_eq!(dto_update.status, ToolStatus::Completed);
        assert_eq!(dto_create.raw_shape.as_deref(), Some("gemini"));
        assert_eq!(dto_update.raw_shape.as_deref(), Some("gemini"));
    }

    /// Empty `toolCallId` must not be treated as a valid id.
    /// Without this guard, `"".to_string()` would propagate as
    /// the tool_call_id and break correlation across the pair.
    #[test]
    fn empty_canonical_id_falls_through_to_fallback_rungs() {
        let n = json!({
            "sessionId": "sid",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "",
                "tool_call_id": "tc_real"
            }
        });
        let dto = extract_observed_tool_activity(
            "sid",
            "gemini-acp",
            AgentKind::Acp,
            &n,
            DEFAULT_RAW_OUTPUT_CAP_BYTES,
        )
        .expect("empty canonical id must fall through, not panic");
        assert_eq!(dto.tool_call_id, "tc_real");
        assert_eq!(dto.raw_shape.as_deref(), Some("gemini"));
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
