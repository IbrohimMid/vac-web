//! Pass E2 — integration tests for the bridge-owned executor spawn path.
//!
//! Covers the gates exposed by [`SessionRegistry::spawn_executor_for_handoff`]
//! and the surrounding [`HandoffService`] accounting that the WS
//! `handoff.dispatch` arm relies on.

use chrono::Utc;
use local_bridge::agent_runtime::{AgentRuntimeRegistry, AgentsConfig, ConfigSource};
use local_bridge::handoff::packet::Packet;
use local_bridge::handoff::{
    DispatchError, HandoffApproveOutcome, HandoffCreateOutcome, HandoffCreateParams,
    HandoffDispatchOutcome, HandoffExecutionBindOutcome, HandoffService,
};
use local_bridge::session::{ExecutorSpawnError, SessionRegistry};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn profiles_dir() -> PathBuf {
    repo_root().join("packages/protocol/v1/profiles")
}

fn mock_engine_bin() -> PathBuf {
    let target = repo_root().join("target");
    let release = target.join("release/mock-engine");
    let debug = target.join("debug/mock-engine");
    if release.exists() {
        release
    } else {
        debug
    }
}

fn run_git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .status()
        .expect("git command");
    assert!(status.success(), "git {args:?} failed");
}

fn init_repo() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_path_buf();
    run_git(&root, &["init", "-q", "--initial-branch=main"]);
    std::fs::write(root.join("README.md"), "hello\n").unwrap();
    run_git(&root, &["add", "-A"]);
    run_git(&root, &["commit", "-q", "-m", "init"]);
    (dir, root)
}

fn build_session_registry() -> SessionRegistry {
    let mock_bin = mock_engine_bin();
    assert!(
        mock_bin.exists(),
        "mock-engine binary not found at {:?}; run `cargo test -p mock-engine` first",
        mock_bin
    );
    let toml_src = format!(
        "default_agent_id = \"alpha\"\n[agents.alpha]\nlabel = \"Alpha\"\nkind = \"mock\"\ncommand = \"{}\"\n",
        mock_bin.display()
    );
    let cfg = AgentsConfig::from_toml_str(&toml_src, Path::new("<test>")).unwrap();
    let agents = Arc::new(AgentRuntimeRegistry::from_config(
        cfg,
        ConfigSource::Embedded,
    ));
    SessionRegistry::with_runtime_and_profiles(agents, profiles_dir())
}

fn sample_payload() -> serde_json::Value {
    json!({
        "created_by": "alice",
        "title": "Patch executor wiring",
        "accepted_finding_ids": ["f1"],
        "tasks": [{
            "id": "task_1",
            "title": "Apply patch",
            "source_finding_ids": ["f1"],
            "evidence_refs": ["f1"],
            "touches_paths": ["src/a.rs"],
            "requires_approval_per_step": false
        }],
        "target": {
            "kind": "dispatch_to_local_vac",
            "executor_profile_id": "executor.code@1.0.0"
        },
        "pin": { "invalidation_policy": "strict" }
    })
}

fn create_and_approve(svc: &HandoffService, root: &Path) -> Packet {
    let outcome = svc.create_handoff(HandoffCreateParams {
        payload: &sample_payload(),
        project_root: root,
        session_id: "sess_test",
        author: "alice",
        now: Utc::now(),
    });
    let packet = match outcome {
        HandoffCreateOutcome::Ok { packet, .. } => packet,
        HandoffCreateOutcome::Err { code, message } => {
            panic!("create failed: code={code} message={message}")
        }
    };

    let approve = svc.approve_handoff(&packet.id, "bob", "approver", None, "sess_test", Utc::now());
    let HandoffApproveOutcome::Ok { packet, .. } = approve else {
        panic!("approve failed");
    };
    packet
}

#[tokio::test]
async fn dispatch_spawns_executor_session_for_approved_packet() {
    let (_tmp, root) = init_repo();
    let svc = HandoffService::new();
    let packet = create_and_approve(&svc, &root);
    let registry = build_session_registry();

    let handle = registry
        .spawn_executor_for_handoff(&packet, root.clone(), Some("alpha".to_string()))
        .await
        .expect("spawn ok");

    assert_eq!(handle.project_root, root);
}

#[tokio::test]
async fn dispatch_rejects_non_approved_packet() {
    let (_tmp, root) = init_repo();
    let svc = HandoffService::new();
    let HandoffCreateOutcome::Ok { packet, .. } = svc.create_handoff(HandoffCreateParams {
        payload: &sample_payload(),
        project_root: &root,
        session_id: "sess_test",
        author: "alice",
        now: Utc::now(),
    }) else {
        panic!("create failed");
    };

    let registry = build_session_registry();
    let outcome = registry
        .spawn_executor_for_handoff(&packet, root.clone(), None)
        .await;
    let err = match outcome {
        Ok(_) => panic!("expected NotApproved, got Ok"),
        Err(e) => e,
    };
    match err {
        ExecutorSpawnError::NotApproved { actual } => {
            assert_eq!(actual, "pending_approval");
        }
        other => panic!("expected NotApproved, got {other:?}"),
    }
}

#[tokio::test]
async fn dispatch_rejects_executor_busy() {
    let (_tmp, root) = init_repo();
    let svc = HandoffService::new();
    let packet1 = create_and_approve(&svc, &root);
    let packet2 = create_and_approve(&svc, &root);

    let HandoffDispatchOutcome::Ok { .. } =
        svc.mark_dispatched(&packet1.id, "sess_test", Utc::now())
    else {
        panic!("mark_dispatched failed");
    };
    let HandoffExecutionBindOutcome::Ok { .. } =
        svc.bind_executor_session(&packet1.id, "sess_executor_1", "sess_test", Utc::now())
    else {
        panic!("bind failed");
    };

    let project_key = format!("{}::{}", packet2.pin.repo_ref, packet2.pin.base_commit_sha);
    let active = svc
        .active_executor_packet(&packet2.target.executor_profile_id, &project_key)
        .expect("expected active executor packet for busy slot");
    assert_eq!(active.id, packet1.id);
}

#[tokio::test]
async fn dispatch_rejects_pin_drift_strict() {
    let (_tmp, root) = init_repo();
    let svc = HandoffService::new();
    let packet = create_and_approve(&svc, &root);

    std::fs::write(root.join("drift.txt"), "drifted\n").unwrap();
    run_git(&root, &["add", "-A"]);
    run_git(&root, &["commit", "-q", "-m", "drift"]);

    let err = svc
        .check_dispatch(&packet.id, &root, Utc::now())
        .expect_err("expected PinDrift");
    match err {
        DispatchError::PinDrift { reason } => {
            assert!(
                reason.contains("drift")
                    || reason.contains("base_sha")
                    || reason.contains("repo_ref"),
                "drift reason should mention drift/base_sha/repo_ref, got {reason}"
            );
        }
        other => panic!("expected PinDrift, got {:?}", other),
    }
}
