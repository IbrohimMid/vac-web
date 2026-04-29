//! Stage X.5h.2 — Step 2 unit tests. Schema fixtures are best-effort
//! based on the live frame captured in Step 1
//! (`{"type":"server.connected","properties":{}}`); other shapes are
//! synthesized from the public opencode source review documented in
//! `.ci-logs/opencode-serve-api.md`. Step 5 will refine them against
//! real captures.

use super::client::SseParser;
use super::events::OpencodeServeEvent;
use serde_json::json;

#[test]
fn parses_server_connected() {
    let evt = OpencodeServeEvent::from_json_str(r#"{"type":"server.connected","properties":{}}"#)
        .unwrap();
    assert_eq!(evt, OpencodeServeEvent::ServerConnected);
}

#[test]
fn parses_session_updated_with_parent() {
    let payload = json!({
        "type": "session.updated",
        "properties": {
            "info": { "id": "ses_abc", "parentID": "ses_root", "title": "sub" }
        }
    });
    let evt = OpencodeServeEvent::from_json_str(&payload.to_string()).unwrap();
    assert_eq!(
        evt,
        OpencodeServeEvent::SessionUpdated {
            session_id: "ses_abc".into(),
            parent_id: Some("ses_root".into()),
        }
    );
}

#[test]
fn parses_session_updated_without_parent_inline_shape() {
    let payload = json!({
        "type": "session.updated",
        "properties": { "id": "ses_root", "title": "main" }
    });
    let evt = OpencodeServeEvent::from_json_str(&payload.to_string()).unwrap();
    assert_eq!(
        evt,
        OpencodeServeEvent::SessionUpdated {
            session_id: "ses_root".into(),
            parent_id: None,
        }
    );
}

#[test]
fn parses_tool_call_started_camel_and_snake_aliases() {
    for (sid, tcid, name_key) in [
        ("sessionID", "toolCallID", "name"),
        ("session_id", "tool_call_id", "tool"),
    ] {
        let payload = json!({
            "type": "tool.call.started",
            "properties": {
                sid: "ses_x",
                tcid: "tc_1",
                name_key: "bash",
                "input": { "command": "echo hi" }
            }
        });
        let evt = OpencodeServeEvent::from_json_str(&payload.to_string()).unwrap();
        assert_eq!(
            evt,
            OpencodeServeEvent::ToolCallStarted {
                session_id: "ses_x".into(),
                tool_call_id: "tc_1".into(),
                name: "bash".into(),
                input: json!({ "command": "echo hi" }),
            }
        );
    }
}

#[test]
fn parses_tool_call_completed_default_status() {
    let payload = json!({
        "type": "tool.call.completed",
        "properties": {
            "sessionID": "ses_x",
            "toolCallID": "tc_1",
            "output": { "stdout": "hi\n" }
        }
    });
    let evt = OpencodeServeEvent::from_json_str(&payload.to_string()).unwrap();
    match evt {
        OpencodeServeEvent::ToolCallCompleted { status, .. } => assert_eq!(status, "completed"),
        other => panic!("expected ToolCallCompleted, got {other:?}"),
    }
}

#[test]
fn unknown_type_falls_through_to_other() {
    let payload = json!({ "type": "future.frame", "properties": { "x": 1 } });
    let evt = OpencodeServeEvent::from_json_str(&payload.to_string()).unwrap();
    match evt {
        OpencodeServeEvent::Other {
            event_type,
            properties,
        } => {
            assert_eq!(event_type, "future.frame");
            assert_eq!(properties, json!({ "x": 1 }));
        }
        other => panic!("expected Other, got {other:?}"),
    }
}

#[test]
fn sse_parser_handles_chunked_boundary_and_skips_comment_frames() {
    let mut p = SseParser::default();
    // Heartbeat / comment frame (no data:) — should be skipped.
    p.feed(b":keep-alive\n\n");
    assert!(p.next_event().is_none());

    // First data frame split across two chunks.
    p.feed(b"data: {\"type\":\"server.");
    assert!(p.next_event().is_none());
    p.feed(b"connected\",\"properties\":{}}\n\n");
    let payload = p.next_event().expect("frame should be ready");
    assert_eq!(payload, r#"{"type":"server.connected","properties":{}}"#);

    // Multi-data lines concatenated with newline.
    p.feed(b"data: line1\ndata: line2\n\n");
    let payload = p.next_event().expect("frame should be ready");
    assert_eq!(payload, "line1\nline2");

    assert!(p.next_event().is_none());
}
