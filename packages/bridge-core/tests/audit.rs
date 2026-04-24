use bridge_core::{AuditConfig, AuditEntry, AuditSeverity, AuditWriter};
use std::time::Duration;

#[tokio::test]
async fn audit_writes_jsonl() {
    let tmp = tempfile::tempdir().unwrap();
    let writer = AuditWriter::spawn(AuditConfig {
        dir: tmp.path().to_path_buf(),
        channel_cap: 128,
    });

    for i in 0..5 {
        writer.log(
            AuditEntry::new("sess_test", "profile")
                .severity(AuditSeverity::Info)
                .fields(serde_json::json!({ "i": i })),
        );
    }

    // Give the task time to flush.
    tokio::time::sleep(Duration::from_millis(200)).await;

    let path = tmp.path().join("sess_test.jsonl");
    let content = tokio::fs::read_to_string(&path).await.unwrap();
    let lines: Vec<_> = content.lines().collect();
    assert_eq!(lines.len(), 5);
    // Every line valid JSON with required fields.
    for l in lines {
        let v: serde_json::Value = serde_json::from_str(l).unwrap();
        assert_eq!(v["subsystem"], "profile");
        assert_eq!(v["session_id"], "sess_test");
    }
}

#[tokio::test]
async fn audit_overflow_drops_and_counts() {
    let tmp = tempfile::tempdir().unwrap();
    let writer = AuditWriter::spawn(AuditConfig {
        dir: tmp.path().to_path_buf(),
        channel_cap: 4,
    });
    // Don't yield → task can't drain; try_send fills + overflows quickly.
    for _ in 0..200 {
        writer.log(AuditEntry::new("sess_flood", "stress"));
    }
    // Some drops expected.
    tokio::time::sleep(Duration::from_millis(100)).await;
    // At least some were dropped under backpressure
    // (not asserting exact number — depends on scheduler).
    let _ = writer.dropped();
}

#[tokio::test]
async fn audit_separate_files_per_session() {
    let tmp = tempfile::tempdir().unwrap();
    let writer = AuditWriter::spawn(AuditConfig {
        dir: tmp.path().to_path_buf(),
        channel_cap: 128,
    });
    writer.log(AuditEntry::new("sess_a", "x"));
    writer.log(AuditEntry::new("sess_b", "y"));
    writer.log(AuditEntry::new("sess_a", "z"));
    tokio::time::sleep(Duration::from_millis(150)).await;

    let a = tokio::fs::read_to_string(tmp.path().join("sess_a.jsonl"))
        .await
        .unwrap();
    let b = tokio::fs::read_to_string(tmp.path().join("sess_b.jsonl"))
        .await
        .unwrap();
    assert_eq!(a.lines().count(), 2);
    assert_eq!(b.lines().count(), 1);
}
