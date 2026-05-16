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

/// B8 — paired `bridge.mutation.requested` + `bridge.mutation.failed`
/// event for an ACP `fs/write_text_file` that did NOT land on disk
/// because the capability profile denied it (tool_denied, deny_glob,
/// out_of_root), the request exceeded `max_bytes_per_write`, or the
/// io path errored. The two events share a `request_id` so the inbox
/// renders a single row that transitions pending → failed in one
/// tick — the operator sees the denied attempt with its reason
/// instead of a silent JSON-RPC error.
pub struct AcpFsWriteFailureEvents {
    pub request_id: String,
    pub kind: &'static str,
    pub requested: ServerEvent,
    pub failed: ServerEvent,
}

/// Build the requested + failed event pair for a denied / errored
/// ACP `fs/write_text_file`.
///
/// - `path` / `new_content` come straight from `req.params`.
/// - `old_content_existed` distinguishes intended `edit` (file was
///   already on disk) from intended `write` (new file). Same
///   semantics as [`classify_fs_write_kind`], but driven by an
///   out-of-band probe in the caller because the failure path
///   never produces an [`FsWriteMeta`].
/// - `error_code` is a stable bridge-side classification (e.g.
///   `fs.tool_denied`, `fs.deny_glob`, `fs.size_exceeded`,
///   `fs.io_error`); `reason` is the human-readable display.
pub fn build_acp_fs_write_failure_events(
    path: &str,
    new_content: &str,
    old_content_existed: bool,
    error_code: &str,
    reason: &str,
    session_id: &str,
    agent_id: &str,
    ts: &str,
) -> AcpFsWriteFailureEvents {
    let request_id = format!("mut-{}", Ulid::new());
    let kind: &'static str = if old_content_existed { "edit" } else { "write" };
    let summary = match kind {
        "edit" => format!("Agent attempted to edit {} (blocked)", path),
        _ => format!("Agent attempted to write {} (blocked)", path),
    };
    let diff_preview =
        format!("(blocked: {error_code}) — agent would have {kind} {path}\nreason: {reason}");

    let requested_payload = json!({
        "request_id": request_id,
        "kind": kind,
        "summary": summary,
        "rationale": format!(
            "ACP fs/write_text_file from agent {agent_id} (rejected before disk)"
        ),
        "target_path": path,
        "path": path,
        "file_path": path,
        "diff_preview": diff_preview,
        "new_text": new_content,
        "originating_session_id": session_id,
        "originating_agent_id": agent_id,
        "auto_applied": false,
        "source": "acp.fs.write_text_file",
    });
    let failed_payload = json!({
        "request_id": request_id,
        "kind": kind,
        "error_code": error_code,
        "reason": reason,
        "message": reason,
        "path": path,
        "applied_path": path,
        "originating_session_id": session_id,
        "originating_agent_id": agent_id,
        "source": "acp.fs.write_text_file",
    });

    AcpFsWriteFailureEvents {
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
        failed: ServerEvent {
            seq: 0,
            session_id: session_id.to_string(),
            event_type: "bridge.mutation.failed".into(),
            payload: failed_payload,
            v: 1,
            ts: ts.to_string(),
        },
    }
}

/// B9 — paired `bridge.mutation.requested` + `bridge.mutation.applied`
/// event for an ACP `terminal/create` that successfully spawned a child
/// process under shell-allowlist policy. Mirrors
/// [`AcpFsWriteMutationEvents`]: both events share a `request_id` and
/// `kind: "bash"` so MutationInbox / AuditTrail reconcile the lifecycle
/// in a single row.
pub struct AcpTerminalCreateMutationEvents {
    pub request_id: String,
    pub kind: &'static str,
    pub requested: ServerEvent,
    pub applied: ServerEvent,
}

/// B9 — paired `bridge.mutation.requested` + `bridge.mutation.failed`
/// event for an ACP `terminal/create` rejected by the shell allowlist,
/// failed to spawn, or arrived with missing params. Lets MutationInbox
/// render a denied-attempt card with the command, args, and reason
/// instead of swallowing the JSON-RPC error.
pub struct AcpTerminalCreateFailureEvents {
    pub request_id: String,
    pub kind: &'static str,
    pub requested: ServerEvent,
    pub failed: ServerEvent,
}

/// Build the requested + applied event pair for an agent-driven
/// `terminal/create` that already spawned a child. The bash command
/// runs under capability-profile policy, so emission mirrors the B6
/// fs/write path: both events emit in the same instant because the
/// agent both proposed and executed the spawn — there is no operator
/// approval gap to model.
pub fn build_acp_terminal_create_mutation_events(
    command: &str,
    args: &[String],
    terminal_id: &str,
    session_id: &str,
    agent_id: &str,
    ts: &str,
) -> AcpTerminalCreateMutationEvents {
    let request_id = format!("mut-{}", Ulid::new());
    let kind = "bash";
    let command_line = render_command_line(command, args);
    let summary = format!("Agent ran {command_line}");
    let diff_preview = format!("(spawn) — agent ran {command_line}");

    let requested_payload = json!({
        "request_id": request_id,
        "kind": kind,
        "summary": summary,
        "rationale": format!("ACP terminal/create from agent {agent_id}"),
        "command": command,
        "args": args,
        "command_line": command_line,
        "terminal_id": terminal_id,
        "diff_preview": diff_preview,
        "originating_session_id": session_id,
        "originating_agent_id": agent_id,
        "auto_applied": true,
        "source": "acp.terminal.create",
    });
    let applied_payload = json!({
        "request_id": request_id,
        "kind": kind,
        "command": command,
        "args": args,
        "command_line": command_line,
        "terminal_id": terminal_id,
        "applied_at": ts,
        "originating_session_id": session_id,
        "originating_agent_id": agent_id,
        "source": "acp.terminal.create",
    });

    AcpTerminalCreateMutationEvents {
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

/// Build the requested + failed event pair for a denied / errored ACP
/// `terminal/create`. `error_code` is the bridge-side stable
/// classification (e.g. `shell.deny`, `shell.not_allowlisted`,
/// `terminal.spawn_failed`); `reason` is the human-readable display.
pub fn build_acp_terminal_create_failure_events(
    command: &str,
    args: &[String],
    error_code: &str,
    reason: &str,
    session_id: &str,
    agent_id: &str,
    ts: &str,
) -> AcpTerminalCreateFailureEvents {
    let request_id = format!("mut-{}", Ulid::new());
    let kind = "bash";
    let command_line = render_command_line(command, args);
    let summary = format!("Agent attempted to run {command_line} (blocked)");
    let diff_preview = format!(
        "(blocked: {error_code}) — agent would have run {command_line}
reason: {reason}"
    );

    let requested_payload = json!({
        "request_id": request_id,
        "kind": kind,
        "summary": summary,
        "rationale": format!(
            "ACP terminal/create from agent {agent_id} (rejected before spawn)"
        ),
        "command": command,
        "args": args,
        "command_line": command_line,
        "diff_preview": diff_preview,
        "originating_session_id": session_id,
        "originating_agent_id": agent_id,
        "auto_applied": false,
        "source": "acp.terminal.create",
    });
    let failed_payload = json!({
        "request_id": request_id,
        "kind": kind,
        "error_code": error_code,
        "reason": reason,
        "message": reason,
        "command": command,
        "args": args,
        "command_line": command_line,
        "originating_session_id": session_id,
        "originating_agent_id": agent_id,
        "source": "acp.terminal.create",
    });

    AcpTerminalCreateFailureEvents {
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
        failed: ServerEvent {
            seq: 0,
            session_id: session_id.to_string(),
            event_type: "bridge.mutation.failed".into(),
            payload: failed_payload,
            v: 1,
            ts: ts.to_string(),
        },
    }
}

fn render_command_line(command: &str, args: &[String]) -> String {
    if args.is_empty() {
        command.to_string()
    } else {
        format!("{} {}", command, args.join(" "))
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

    #[test]
    fn failure_events_share_request_id_and_carry_error_code() {
        let evt = build_acp_fs_write_failure_events(
            "secrets/key.txt",
            "AKIA...",
            false,
            "fs.deny_glob",
            "denied: matches deny_glob '**/secrets/**'",
            "sess-1",
            "claude-acp",
            "2026-05-16T00:00:00Z",
        );
        assert!(evt.request_id.starts_with("mut-"));
        assert_eq!(evt.requested.event_type, "bridge.mutation.requested");
        assert_eq!(evt.failed.event_type, "bridge.mutation.failed");
        assert_eq!(
            evt.requested.payload["request_id"],
            evt.failed.payload["request_id"]
        );
        assert_eq!(evt.failed.payload["error_code"], "fs.deny_glob");
        assert_eq!(evt.requested.payload["auto_applied"], false);
    }

    #[test]
    fn failure_kind_is_edit_when_old_existed() {
        let evt = build_acp_fs_write_failure_events(
            "src/lib.rs",
            "new",
            true,
            "fs.tool_denied",
            "blocked",
            "s",
            "a",
            "t",
        );
        assert_eq!(evt.kind, "edit");
        assert_eq!(evt.requested.payload["kind"], "edit");
        assert!(evt.requested.payload["summary"]
            .as_str()
            .unwrap_or("")
            .contains("edit"));
    }

    #[test]
    fn failure_kind_is_write_when_new_file() {
        let evt = build_acp_fs_write_failure_events(
            "brand.txt",
            "hi",
            false,
            "fs.size_exceeded",
            "too big",
            "s",
            "a",
            "t",
        );
        assert_eq!(evt.kind, "write");
        assert_eq!(evt.requested.payload["kind"], "write");
        assert!(evt.requested.payload["summary"]
            .as_str()
            .unwrap_or("")
            .contains("write"));
    }

    #[test]
    fn failure_payload_carries_reason_and_path() {
        let evt = build_acp_fs_write_failure_events(
            "outside/etc.txt",
            "x",
            false,
            "fs.out_of_root",
            "path escapes project_root",
            "s",
            "a",
            "t",
        );
        assert_eq!(evt.failed.payload["reason"], "path escapes project_root");
        assert_eq!(evt.failed.payload["path"], "outside/etc.txt");
        assert_eq!(evt.requested.payload["target_path"], "outside/etc.txt");
        let preview = evt.requested.payload["diff_preview"].as_str().unwrap_or("");
        assert!(preview.contains("fs.out_of_root"));
    }

    #[test]
    fn terminal_create_events_share_request_id_and_carry_command() {
        let evt = build_acp_terminal_create_mutation_events(
            "cargo",
            &[
                "test".to_string(),
                "-p".to_string(),
                "local-bridge".to_string(),
            ],
            "trm_01ABC",
            "sess-1",
            "claude-acp",
            "2026-05-16T00:00:00Z",
        );
        assert!(evt.request_id.starts_with("mut-"));
        assert_eq!(evt.kind, "bash");
        assert_eq!(evt.requested.event_type, "bridge.mutation.requested");
        assert_eq!(evt.applied.event_type, "bridge.mutation.applied");
        assert_eq!(
            evt.requested.payload["request_id"],
            evt.applied.payload["request_id"]
        );
        assert_eq!(evt.requested.payload["command"], "cargo");
        assert_eq!(evt.applied.payload["terminal_id"], "trm_01ABC");
        assert_eq!(evt.requested.payload["auto_applied"], true);
        assert_eq!(evt.requested.payload["source"], "acp.terminal.create");
    }

    #[test]
    fn terminal_create_summary_contains_command_line() {
        let evt = build_acp_terminal_create_mutation_events(
            "echo",
            &["hello".to_string()],
            "trm_1",
            "s",
            "a",
            "t",
        );
        let summary = evt.requested.payload["summary"].as_str().unwrap_or("");
        assert!(summary.contains("echo hello"), "got {summary:?}");
        let cmdline = evt.applied.payload["command_line"].as_str().unwrap_or("");
        assert_eq!(cmdline, "echo hello");
    }

    #[test]
    fn terminal_create_with_no_args_still_renders() {
        let evt = build_acp_terminal_create_mutation_events("uname", &[], "trm_z", "s", "a", "t");
        assert_eq!(evt.applied.payload["command_line"], "uname");
        let summary = evt.requested.payload["summary"].as_str().unwrap_or("");
        assert!(summary.contains("uname"));
    }

    #[test]
    fn terminal_create_failure_events_share_request_id_and_carry_error_code() {
        let evt = build_acp_terminal_create_failure_events(
            "rm",
            &["-rf".to_string(), "/".to_string()],
            "shell.deny",
            "denied: rm is not on shell allowlist",
            "sess-1",
            "claude-acp",
            "2026-05-16T00:00:00Z",
        );
        assert!(evt.request_id.starts_with("mut-"));
        assert_eq!(evt.kind, "bash");
        assert_eq!(evt.requested.event_type, "bridge.mutation.requested");
        assert_eq!(evt.failed.event_type, "bridge.mutation.failed");
        assert_eq!(
            evt.requested.payload["request_id"],
            evt.failed.payload["request_id"]
        );
        assert_eq!(evt.failed.payload["error_code"], "shell.deny");
        assert_eq!(evt.requested.payload["auto_applied"], false);
    }

    #[test]
    fn terminal_create_failure_diff_preview_carries_command_and_error() {
        let evt = build_acp_terminal_create_failure_events(
            "curl",
            &["http://evil.example".to_string()],
            "shell.not_allowlisted",
            "binary 'curl' not in allowlist",
            "s",
            "a",
            "t",
        );
        let preview = evt.requested.payload["diff_preview"].as_str().unwrap_or("");
        assert!(preview.contains("shell.not_allowlisted"), "got {preview:?}");
        assert!(
            preview.contains("curl http://evil.example"),
            "got {preview:?}"
        );
        assert!(
            preview.contains("binary 'curl' not in allowlist"),
            "got {preview:?}"
        );
    }
}
