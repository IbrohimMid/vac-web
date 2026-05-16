//! B6 — emit `bridge.mutation.*` events for agent-driven ACP fs writes.
//!
//! The browser-initiated path lives in `translator/mod.rs` (mutation
//! approve / reject / refine). This module mirrors the same event
//! shapes for writes that originate inside the agent runtime, so
//! MutationInbox + AuditTrail see one consistent mutation lifecycle
//! regardless of whether the request came from a user-approved browser
//! action or from an ACP `fs/write_text_file` already gated by the
//! capability profile.

use crate::agent_runtime::acp::fs_handler::FsWriteMeta;
use crate::ws::envelope::ServerEvent;
use serde_json::json;
use ulid::Ulid;

const DIFF_PREVIEW_MAX_BYTES: usize = 4096;

/// Paired `bridge.mutation.requested` + `bridge.mutation.applied` event
/// produced for one ACP `fs/write_text_file` mutation. The two events
/// share a `request_id` and a `kind` so MutationInbox / AuditTrail can
/// reconcile the lifecycle in a single row.
pub struct AcpFsWriteMutationEvents {
    pub request_id: String,
    pub kind: &'static str,
    pub requested: ServerEvent,
    pub applied: ServerEvent,
}

/// Classify an ACP `fs/write_text_file` mutation as `edit` (file already
/// existed) or `write` (new file).
pub fn classify_fs_write_kind(meta: &FsWriteMeta) -> &'static str {
    if meta.old_content.is_some() {
        "edit"
    } else {
        "write"
    }
}

/// Build the request + applied event pair for an agent-driven write
/// that already succeeded on disk. The bridge emits both in the same
/// instant because the agent both proposed and executed the write
/// under capability-profile policy — there is no operator-mediated
/// approval gap to model with a separate `approve` step. The pair
/// keeps the MutationInbox / AuditTrail lifecycle consistent with
/// browser-initiated mutations.
pub fn build_acp_fs_write_mutation_events(
    meta: &FsWriteMeta,
    session_id: &str,
    agent_id: &str,
    ts: &str,
) -> AcpFsWriteMutationEvents {
    let request_id = format!("mut-{}", Ulid::new());
    let kind = classify_fs_write_kind(meta);
    let summary = match kind {
        "edit" => format!("Agent edited {}", meta.path),
        _ => format!("Agent wrote {}", meta.path),
    };
    let diff_preview = build_diff_preview(meta);

    let requested_payload = json!({
        "request_id": request_id,
        "kind": kind,
        "summary": summary,
        "rationale": format!("ACP fs/write_text_file from agent {agent_id}"),
        "target_path": meta.path,
        "path": meta.path,
        "file_path": meta.path,
        "diff_preview": diff_preview,
        "old_text": meta.old_content,
        "new_text": meta.new_content,
        "originating_session_id": session_id,
        "originating_agent_id": agent_id,
        "auto_applied": true,
        "source": "acp.fs.write_text_file",
    });
    let applied_payload = json!({
        "request_id": request_id,
        "kind": kind,
        "applied_path": meta.path,
        "applied_at": ts,
        "originating_session_id": session_id,
        "originating_agent_id": agent_id,
        "source": "acp.fs.write_text_file",
    });

    AcpFsWriteMutationEvents {
        request_id: request_id.clone(),
        kind,
        requested: ServerEvent {
            seq: 0,
            session_id: session_id.to_string(),
            event_type: "bridge.mutation.requested".into(),
            payload: requested_payload,
            v: 1,
            ts: ts.to_string(),
        },
        applied: ServerEvent {
            seq: 0,
            session_id: session_id.to_string(),
            event_type: "bridge.mutation.applied".into(),
            payload: applied_payload,
            v: 1,
            ts: ts.to_string(),
        },
    }
}

fn build_diff_preview(meta: &FsWriteMeta) -> String {
    let preview = match meta.old_content.as_deref() {
        Some(old) if old != meta.new_content => format!(
            "--- {p}\n+++ {p}\n-{old_line}\n+{new_line}",
            p = meta.path,
            old_line = first_line(old),
            new_line = first_line(&meta.new_content),
        ),
        Some(_) => format!("(no textual change to {})", meta.path),
        None => format!("(new file {})", meta.path),
    };
    if preview.len() > DIFF_PREVIEW_MAX_BYTES {
        let mut idx = DIFF_PREVIEW_MAX_BYTES;
        while idx > 0 && !preview.is_char_boundary(idx) {
            idx -= 1;
        }
        let (head, _) = preview.split_at(idx);
        let mut truncated = head.to_string();
        truncated.push_str("\n\u{2026}(truncated)");
        truncated
    } else {
        preview
    }
}

fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta_for(path: &str, old: Option<&str>, new: &str) -> FsWriteMeta {
        FsWriteMeta {
            path: path.to_string(),
            old_content: old.map(|s| s.to_string()),
            new_content: new.to_string(),
        }
    }

    #[test]
    fn classify_new_file_is_write() {
        let meta = meta_for("a.txt", None, "hello");
        assert_eq!(classify_fs_write_kind(&meta), "write");
    }

    #[test]
    fn classify_existing_file_is_edit() {
        let meta = meta_for("a.txt", Some("old"), "new");
        assert_eq!(classify_fs_write_kind(&meta), "edit");
    }

    #[test]
    fn build_events_share_request_id_and_carry_path() {
        let meta = meta_for("notes.md", Some("v1"), "v2");
        let evt = build_acp_fs_write_mutation_events(
            &meta,
            "sess-1",
            "claude-acp",
            "2026-05-16T00:00:00Z",
        );
        assert_eq!(evt.kind, "edit");
        assert!(evt.request_id.starts_with("mut-"));
        assert_eq!(evt.requested.event_type, "bridge.mutation.requested");
        assert_eq!(evt.applied.event_type, "bridge.mutation.applied");
        assert_eq!(
            evt.requested.payload["request_id"],
            evt.applied.payload["request_id"]
        );
        assert_eq!(evt.requested.payload["target_path"], "notes.md");
        assert_eq!(evt.applied.payload["applied_path"], "notes.md");
        assert_eq!(evt.requested.payload["source"], "acp.fs.write_text_file");
        assert_eq!(evt.requested.payload["auto_applied"], true);
        assert_eq!(evt.requested.payload["originating_session_id"], "sess-1");
        assert_eq!(evt.applied.payload["originating_agent_id"], "claude-acp");
    }

    #[test]
    fn new_file_diff_preview_says_new_file() {
        let meta = meta_for("brand.txt", None, "hello");
        let evt = build_acp_fs_write_mutation_events(&meta, "s", "a", "t");
        let preview = evt.requested.payload["diff_preview"].as_str().unwrap_or("");
        assert!(preview.contains("new file"));
    }

    #[test]
    fn diff_preview_truncates_when_huge() {
        let huge_old = "a".repeat(50_000);
        let huge_new = "b".repeat(50_000);
        let meta = meta_for("big.txt", Some(&huge_old), &huge_new);
        let preview = build_diff_preview(&meta);
        assert!(preview.len() <= DIFF_PREVIEW_MAX_BYTES + 32);
    }
}
