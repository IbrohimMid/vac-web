use crate::audit::log_tool_event;
use crate::gate;
use crate::server::AppStateHandle;
use crate::session::handle::SessionHandleRef;
use crate::session::persistence::{PersistedServerEvent, SessionPersistence};
use crate::translator::emit_session_event;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex as StdMutex};
use tracing::warn;
use ulid::Ulid;

const DEFAULT_TARGETS: &[(&str, &str, &str)] = &[
    ("staging", "Staging", "staging"),
    ("prod", "Production", "production"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeployTarget {
    pub id: String,
    pub label: String,
    pub environment: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    pub last_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_deployed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeployEvent {
    pub id: String,
    pub target_id: String,
    pub commit: String,
    pub status: String,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packet_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseNotesDraft {
    pub id: String,
    pub target_id: String,
    pub commit_range: String,
    pub markdown: String,
    pub source_refs: Vec<SourceRef>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRef {
    pub kind: String,
    pub ref_: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostDeployObservation {
    pub id: String,
    pub target_id: String,
    pub connector: String,
    pub severity: String,
    pub message: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct SessionReleaseState {
    targets: BTreeMap<String, DeployTarget>,
    deploys: BTreeMap<String, DeployEvent>,
    notes: BTreeMap<String, ReleaseNotesDraft>,
    observations: Vec<PostDeployObservation>,
}

impl SessionReleaseState {
    pub fn from_events(events: &[PersistedServerEvent]) -> Self {
        let mut state = Self::default();
        state.seed_default_targets();
        for ev in events {
            match ev.event_type.as_str() {
                "release.targets" => {
                    if let Some(targets) = ev.payload.get("targets").and_then(|v| v.as_array()) {
                        state.targets.clear();
                        for target in targets {
                            if let Some(parsed) = target_from_value(target) {
                                state.targets.insert(parsed.id.clone(), parsed);
                            }
                        }
                    }
                }
                "release.deploy_progress" => {
                    if let Some(event) = deploy_event_from_value(&ev.payload) {
                        state.apply_deploy(event);
                    }
                }
                "release.notes_draft" => {
                    if let Some(draft) = notes_draft_from_value(&ev.payload) {
                        state.notes.insert(draft.id.clone(), draft);
                    }
                }
                "release.post_deploy_observation" => {
                    if let Some(obs) = observation_from_value(&ev.payload) {
                        state.observations.push(obs);
                    }
                }
                _ => {}
            }
        }
        state
    }

    pub fn seed_default_targets(&mut self) {
        if self.targets.is_empty() {
            for (id, label, environment) in DEFAULT_TARGETS {
                self.targets.insert(
                    (*id).to_string(),
                    DeployTarget {
                        id: (*id).to_string(),
                        label: (*label).to_string(),
                        environment: (*environment).to_string(),
                        region: None,
                        last_status: "idle".into(),
                        last_commit: None,
                        last_deployed_at: None,
                    },
                );
            }
        }
    }

    pub fn targets(&self) -> Vec<DeployTarget> {
        DEFAULT_TARGETS
            .iter()
            .filter_map(|(id, _, _)| self.targets.get(*id).cloned())
            .collect()
    }

    pub fn get_target(&self, target_id: &str) -> Option<DeployTarget> {
        self.targets.get(target_id).cloned()
    }

    pub fn upsert_target(&mut self, target: DeployTarget) {
        self.targets.insert(target.id.clone(), target);
    }

    fn apply_deploy(&mut self, event: DeployEvent) {
        let target_id = event.target_id.clone();
        let finished_at = event.finished_at.clone();
        let status = event.status.clone();
        let commit = event.commit.clone();
        self.deploys.insert(event.id.clone(), event);
        if let Some(target) = self.targets.get_mut(&target_id) {
            target.last_status = status;
            target.last_commit = Some(commit);
            if let Some(finished_at) = finished_at {
                target.last_deployed_at = Some(finished_at);
            }
        }
    }

    pub fn add_note(&mut self, draft: ReleaseNotesDraft) {
        self.notes.insert(draft.id.clone(), draft);
    }

    pub fn append_observation(&mut self, observation: PostDeployObservation) {
        self.observations.push(observation);
        if self.observations.len() > 200 {
            let drop_count = self.observations.len() - 200;
            self.observations.drain(0..drop_count);
        }
    }
}

pub fn build_session_release_state(
    persistence: Option<&Arc<dyn SessionPersistence>>,
    session_id: &str,
) -> Arc<StdMutex<SessionReleaseState>> {
    let mut state = SessionReleaseState::default();
    if let Some(persistence) = persistence {
        match persistence.load_events(session_id, 0) {
            Ok(events) => state = SessionReleaseState::from_events(&events),
            Err(err) => {
                warn!(session = %session_id, error = %err, "failed to restore release state from persistence")
            }
        }
    } else {
        state.seed_default_targets();
    }
    Arc::new(StdMutex::new(state))
}

pub fn static_targets() -> Vec<DeployTarget> {
    DEFAULT_TARGETS
        .iter()
        .map(|(id, label, environment)| DeployTarget {
            id: (*id).to_string(),
            label: (*label).to_string(),
            environment: (*environment).to_string(),
            region: None,
            last_status: "idle".into(),
            last_commit: None,
            last_deployed_at: None,
        })
        .collect()
}

pub async fn handle_list_targets(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let targets = if cmd.session_id.is_empty() {
        static_targets()
    } else {
        let Some(handle) = state.sessions.get(&cmd.session_id) else {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "session.not_found".into(),
                        message: format!("session {} not found", cmd.session_id),
                    }),
                },
                Vec::new(),
            );
        };
        let guard = handle.release_state.lock().ok();
        guard
            .map(|state| state.targets())
            .unwrap_or_else(static_targets)
    };
    log_tool_event(
        state,
        &cmd.session_id,
        "release",
        json!({
            "command": "release.list_targets",
            "count": targets.len(),
            "decision": "allow",
        }),
    );
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        vec![ServerEvent {
            seq: 0,
            session_id: cmd.session_id.clone(),
            event_type: "release.targets".into(),
            payload: json!({ "targets": targets }),
            v: 1,
            ts: now_iso(),
        }],
    )
}

pub async fn handle_generate_notes(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(handle) = state.sessions.get(&cmd.session_id) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "session.not_found".into(),
                    message: format!("session {} not found", cmd.session_id),
                }),
            },
            Vec::new(),
        );
    };
    let Some(target_id) = cmd.payload.get("target_id").and_then(|v| v.as_str()) else {
        return release_target_error(cmd, "target id is required");
    };
    let draft = {
        let mut guard = match handle.release_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "persistence.write_failed".into(),
                            message: "release state lock poisoned".into(),
                        }),
                    },
                    Vec::new(),
                );
            }
        };
        guard.seed_default_targets();
        let Some(target) = guard.get_target(target_id) else {
            return release_target_error(cmd, format!("release target {target_id} not found"));
        };
        let commit_head =
            current_commit_short(&handle.project_root).unwrap_or_else(|| "unknown".into());
        let baseline = target
            .last_commit
            .clone()
            .or_else(|| previous_commit_short(&handle.project_root).ok())
            .unwrap_or_else(|| commit_head.clone());
        let commit_range = format!("{baseline}..{commit_head}");
        let notes_id = format!("notes_{}_{}", target_id, Ulid::new());
        let markdown = format!(
            "## What changed\n\n- Release notes draft for {label} ({target_id})\n- Generated from the bridge release plane\n- Commit range: {commit_range}\n",
            label = target.label
        );
        let draft = ReleaseNotesDraft {
            id: notes_id.clone(),
            target_id: target_id.to_string(),
            commit_range: commit_range.clone(),
            markdown: markdown.clone(),
            source_refs: vec![
                SourceRef {
                    kind: "commit".into(),
                    ref_: baseline.clone(),
                },
                SourceRef {
                    kind: "packet".into(),
                    ref_: format!("release:{target_id}"),
                },
            ],
            generated_at: now_iso(),
        };
        guard.add_note(draft.clone());
        draft
    };
    log_tool_event(
        state,
        &cmd.session_id,
        "release",
        json!({
            "command": "release.generate_notes",
            "target_id": target_id,
            "decision": "allow",
        }),
    );
    emit_session_event(
        &handle,
        ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "release.notes_draft".into(),
            payload: json!({
                "id": draft.id,
                "target_id": draft.target_id,
                "commit_range": draft.commit_range,
                "markdown": draft.markdown,
                "source_refs": draft.source_refs,
                "generated_at": draft.generated_at,
            }),
            v: 1,
            ts: now_iso(),
        },
    )
    .await;
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        Vec::new(),
    )
}

pub async fn handle_deploy(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(handle) = state.sessions.get(&cmd.session_id) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "session.not_found".into(),
                    message: format!("session {} not found", cmd.session_id),
                }),
            },
            Vec::new(),
        );
    };
    let Some(target_id) = cmd.payload.get("target_id").and_then(|v| v.as_str()) else {
        return release_target_error(cmd, "target id is required");
    };
    let (deploying, deployed, deploy_id, started_at, finished_at) = {
        let mut release_guard = match handle.release_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "persistence.write_failed".into(),
                            message: "release state lock poisoned".into(),
                        }),
                    },
                    Vec::new(),
                );
            }
        };
        release_guard.seed_default_targets();
        let target_environment = {
            let Some(target) = release_guard.get_target(target_id) else {
                return release_target_error(cmd, format!("release target {target_id} not found"));
            };
            target.environment.clone()
        };
        let gate_guard = match handle.gate_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "persistence.write_failed".into(),
                            message: "gate state lock poisoned".into(),
                        }),
                    },
                    Vec::new(),
                );
            }
        };
        let required = gate::required_gate_ids_for_environment(&target_environment);
        let (ready, missing) = gate::missing_gate_ids(&gate_guard, required);
        if !ready {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "release.gate_not_ready".into(),
                        message: format!("release gates not ready: {}", missing.join(", ")),
                    }),
                },
                Vec::new(),
            );
        }
        let commit = current_commit_short(&handle.project_root).unwrap_or_else(|| "unknown".into());
        let deploy_id = format!("dep_{}", Ulid::new());
        let packet_id = cmd.id.clone();
        let started_at = now_iso();
        let finished_at = (Utc::now() + Duration::seconds(8)).to_rfc3339();
        let deploying = DeployEvent {
            id: deploy_id.clone(),
            target_id: target_id.to_string(),
            commit: commit.clone(),
            status: "deploying".into(),
            started_at: started_at.clone(),
            finished_at: None,
            packet_id: Some(packet_id.clone()),
        };
        let deployed = DeployEvent {
            id: deploy_id.clone(),
            target_id: target_id.to_string(),
            commit: commit.clone(),
            status: "deployed".into(),
            started_at: started_at.clone(),
            finished_at: Some(finished_at.clone()),
            packet_id: Some(packet_id.clone()),
        };
        release_guard.apply_deploy(deploying.clone());
        if let Some(target) = release_guard.targets.get_mut(target_id) {
            target.last_status = "deploying".into();
            target.last_commit = Some(commit.clone());
        }
        (deploying, deployed, deploy_id, started_at, finished_at)
    };
    log_tool_event(
        state,
        &cmd.session_id,
        "release",
        json!({
            "command": "release.deploy",
            "target_id": target_id,
            "deploy_id": deploy_id,
            "decision": "allow",
        }),
    );
    emit_session_event(
        &handle,
        ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "release.deploy_progress".into(),
            payload: json!({
                "deploy_id": deploying.id,
                "target_id": deploying.target_id,
                "commit": deploying.commit,
                "status": deploying.status,
                "started_at": deploying.started_at,
                "packet_id": deploying.packet_id,
            }),
            v: 1,
            ts: started_at.clone(),
        },
    )
    .await;
    {
        let mut release_guard = match handle.release_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "persistence.write_failed".into(),
                            message: "release state lock poisoned".into(),
                        }),
                    },
                    Vec::new(),
                );
            }
        };
        release_guard.apply_deploy(deployed.clone());
        if let Some(target) = release_guard.targets.get_mut(target_id) {
            target.last_status = "deployed".into();
            target.last_commit = Some(deployed.commit.clone());
            target.last_deployed_at = Some(finished_at.clone());
        }
    }
    emit_session_event(
        &handle,
        ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "release.deploy_progress".into(),
            payload: json!({
                "deploy_id": deployed.id,
                "target_id": deployed.target_id,
                "commit": deployed.commit,
                "status": deployed.status,
                "started_at": deployed.started_at,
                "finished_at": deployed.finished_at,
                "packet_id": deployed.packet_id,
            }),
            v: 1,
            ts: finished_at.clone(),
        },
    )
    .await;
    emit_session_event(
        &handle,
        ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "release.post_deploy_observation".into(),
            payload: json!({
                "id": format!("obs_{}_1", deploy_id),
                "target_id": target_id,
                "connector": "sentry",
                "severity": "info",
                "message": "no new issues in 5-minute window",
                "observed_at": (Utc::now() + Duration::minutes(5)).to_rfc3339(),
            }),
            v: 1,
            ts: now_iso(),
        },
    )
    .await;
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        Vec::new(),
    )
}

pub async fn handle_publish(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(handle) = state.sessions.get(&cmd.session_id) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "session.not_found".into(),
                    message: format!("session {} not found", cmd.session_id),
                }),
            },
            Vec::new(),
        );
    };
    let Some(target_id) = cmd.payload.get("target_id").and_then(|v| v.as_str()) else {
        return release_target_error(cmd, "target id is required");
    };
    let (event, deploy_id, finished_at) = {
        let mut release_guard = match handle.release_state.lock() {
            Ok(g) => g,
            Err(_) => return release_target_error(cmd, "release state lock poisoned"),
        };
        release_guard.seed_default_targets();
        if release_guard.get_target(target_id).is_none() {
            return release_target_error(cmd, format!("release target {target_id} not found"));
        }
        let gate_guard = match handle.gate_state.lock() {
            Ok(g) => g,
            Err(_) => {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "persistence.write_failed".into(),
                            message: "gate state lock poisoned".into(),
                        }),
                    },
                    Vec::new(),
                );
            }
        };
        let required = gate::required_publish_gate_ids();
        let (ready, missing) = gate::missing_gate_ids(&gate_guard, required);
        drop(gate_guard);
        if !ready {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "release.gate_not_ready".into(),
                        message: format!("release gates not ready: {}", missing.join(", ")),
                    }),
                },
                Vec::new(),
            );
        }
        let commit = current_commit_short(&handle.project_root).unwrap_or_else(|| "unknown".into());
        let deploy_id = format!("pub_{}_{}", target_id, Ulid::new());
        let started_at = now_iso();
        let finished_at = (Utc::now() + Duration::seconds(5)).to_rfc3339();
        let event = DeployEvent {
            id: deploy_id.clone(),
            target_id: target_id.to_string(),
            commit: commit.clone(),
            status: "deployed".into(),
            started_at: started_at.clone(),
            finished_at: Some(finished_at.clone()),
            packet_id: Some(cmd.id.clone()),
        };
        release_guard.apply_deploy(event.clone());
        if let Some(target) = release_guard.targets.get_mut(target_id) {
            target.last_status = "deployed".into();
            target.last_commit = Some(commit.clone());
            target.last_deployed_at = Some(finished_at.clone());
        }
        (event, deploy_id, finished_at)
    };
    log_tool_event(
        state,
        &cmd.session_id,
        "release",
        json!({
            "command": "release.publish",
            "target_id": target_id,
            "deploy_id": deploy_id,
            "decision": "allow",
        }),
    );
    emit_session_event(
        &handle,
        ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "release.deploy_progress".into(),
            payload: json!({
                "deploy_id": event.id,
                "target_id": event.target_id,
                "commit": event.commit,
                "status": event.status,
                "started_at": event.started_at,
                "finished_at": event.finished_at,
                "packet_id": event.packet_id,
            }),
            v: 1,
            ts: finished_at,
        },
    )
    .await;
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        Vec::new(),
    )
}

pub fn current_targets(handle: &SessionHandleRef) -> Vec<DeployTarget> {
    let guard = handle.release_state.lock().ok();
    guard
        .map(|state| state.targets())
        .unwrap_or_else(static_targets)
}

fn release_target_error(
    cmd: &ClientCommand,
    message: impl Into<String>,
) -> (ServerAck, Vec<ServerEvent>) {
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: false,
            error: Some(ErrorInfo {
                code: "release.target_not_found".into(),
                message: message.into(),
            }),
        },
        Vec::new(),
    )
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn target_from_value(value: &serde_json::Value) -> Option<DeployTarget> {
    Some(DeployTarget {
        id: value.get("id")?.as_str()?.to_string(),
        label: value.get("label")?.as_str()?.to_string(),
        environment: value.get("environment")?.as_str()?.to_string(),
        region: value
            .get("region")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_status: value
            .get("last_status")
            .or_else(|| value.get("lastStatus"))
            .and_then(|v| v.as_str())
            .unwrap_or("idle")
            .to_string(),
        last_commit: value
            .get("last_commit")
            .or_else(|| value.get("lastCommit"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_deployed_at: value
            .get("last_deployed_at")
            .or_else(|| value.get("lastDeployedAt"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

fn deploy_event_from_value(value: &serde_json::Value) -> Option<DeployEvent> {
    Some(DeployEvent {
        id: value.get("deploy_id")?.as_str()?.to_string(),
        target_id: value.get("target_id")?.as_str()?.to_string(),
        commit: value.get("commit")?.as_str()?.to_string(),
        status: value.get("status")?.as_str()?.to_string(),
        started_at: value.get("started_at")?.as_str()?.to_string(),
        finished_at: value
            .get("finished_at")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        packet_id: value
            .get("packet_id")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

fn notes_draft_from_value(value: &serde_json::Value) -> Option<ReleaseNotesDraft> {
    Some(ReleaseNotesDraft {
        id: value.get("id")?.as_str()?.to_string(),
        target_id: value.get("target_id")?.as_str()?.to_string(),
        commit_range: value.get("commit_range")?.as_str()?.to_string(),
        markdown: value.get("markdown")?.as_str()?.to_string(),
        source_refs: value
            .get("source_refs")
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        Some(SourceRef {
                            kind: item.get("kind")?.as_str()?.to_string(),
                            ref_: item
                                .get("ref")
                                .or_else(|| item.get("ref_"))?
                                .as_str()?
                                .to_string(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        generated_at: value.get("generated_at")?.as_str()?.to_string(),
    })
}

fn observation_from_value(value: &serde_json::Value) -> Option<PostDeployObservation> {
    Some(PostDeployObservation {
        id: value.get("id")?.as_str()?.to_string(),
        target_id: value.get("target_id")?.as_str()?.to_string(),
        connector: value.get("connector")?.as_str()?.to_string(),
        severity: value.get("severity")?.as_str()?.to_string(),
        message: value.get("message")?.as_str()?.to_string(),
        observed_at: value.get("observed_at")?.as_str()?.to_string(),
    })
}

fn current_commit_short(project_root: &Path) -> Option<String> {
    git_rev_parse(project_root, &["rev-parse", "--short=8", "HEAD"])
}

fn previous_commit_short(project_root: &Path) -> Result<String, ()> {
    git_rev_parse(project_root, &["rev-parse", "--short=8", "HEAD^"]).ok_or(())
}

fn git_rev_parse(project_root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(project_root)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}
