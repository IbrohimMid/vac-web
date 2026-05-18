use protocol_rs::v1::command::{Command, CommandType, CommandVersion};
use protocol_rs::v1::event::{Event, EventType, EventVersion};
use serde_json::json;

#[test]
fn command_type_is_typed_and_roundtrips() {
    let raw = json!({
        "id": "cmd_01J00000000000000000000001",
        "session_id": "sess_01J00000000000000000000002",
        "type": "message.submit",
        "payload": { "text": "hello" },
        "v": 1
    });

    let cmd: Command = serde_json::from_value(raw).expect("valid command");
    assert_eq!(cmd.r#type, CommandType::MessageSubmit);
    assert_eq!(cmd.v, CommandVersion);

    let out = serde_json::to_value(&cmd).expect("serialize command");
    assert_eq!(out["type"], "message.submit");
    assert_eq!(out["v"], 1);
}

#[test]
fn command_rejects_unknown_type_and_wrong_version() {
    let unknown = json!({
        "id": "cmd_01J00000000000000000000001",
        "session_id": "sess_01J00000000000000000000002",
        "type": "message.explode",
        "payload": {},
        "v": 1
    });
    assert!(serde_json::from_value::<Command>(unknown).is_err());

    let wrong_version = json!({
        "id": "cmd_01J00000000000000000000001",
        "session_id": "sess_01J00000000000000000000002",
        "type": "message.submit",
        "payload": {},
        "v": 2
    });
    assert!(serde_json::from_value::<Command>(wrong_version).is_err());
}

#[test]
fn event_type_is_typed_and_roundtrips() {
    let raw = json!({
        "seq": 7,
        "session_id": "sess_01J00000000000000000000002",
        "type": "transcript.delta",
        "payload": { "delta": "hello" },
        "v": 1,
        "ts": "2026-05-18T06:00:00Z"
    });

    let event: Event = serde_json::from_value(raw).expect("valid event");
    assert_eq!(event.r#type, EventType::TranscriptDelta);
    assert_eq!(event.v, EventVersion);

    let out = serde_json::to_value(&event).expect("serialize event");
    assert_eq!(out["type"], "transcript.delta");
    assert_eq!(out["v"], 1);
}

#[test]
fn event_rejects_unknown_type_and_wrong_version() {
    let unknown = json!({
        "seq": 7,
        "session_id": "sess_01J00000000000000000000002",
        "type": "transcript.unknown",
        "payload": {},
        "v": 1,
        "ts": "2026-05-18T06:00:00Z"
    });
    assert!(serde_json::from_value::<Event>(unknown).is_err());

    let wrong_version = json!({
        "seq": 7,
        "session_id": "sess_01J00000000000000000000002",
        "type": "transcript.delta",
        "payload": {},
        "v": 2,
        "ts": "2026-05-18T06:00:00Z"
    });
    assert!(serde_json::from_value::<Event>(wrong_version).is_err());
}
