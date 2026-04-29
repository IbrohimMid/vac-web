//! Profile enforcement Layer 1 — bridge-side check before command reaches engine.

use crate::server::AppStateHandle;
use crate::ws::envelope::ClientCommand;
use profile_core::{enforce::enforce_tool, profile::CapabilityProfile, Decision};
use std::sync::OnceLock;

const SESSIONLESS_COMMANDS: &[&str] = &[
    "system.ping",
    "system.version",
    "system.capabilities",
    "session.create",
    "session.list",
    "session.snapshot",
    "registry.sync",
    "registry.add",
];

const KNOWN_COMMANDS: &[&str] = &[
    "system.ping",
    "system.version",
    "system.capabilities",
    "session.create",
    "session.resume",
    "session.list",
    "session.snapshot",
    "session.rename",
    "session.close",
    "session.authenticate",
    "message.submit",
    "message.cancel_stream",
    "message.retry",
    "approval.approve",
    "approval.approve_all",
    "approval.reject",
    "approval.inspect",
    "workbench.select_tab",
    "workbench.invoke",
    "review.open_file",
    "review.toggle_hunk",
    "review.revert_file",
    "review.revert_all",
    "runtime.list_jobs",
    "runtime.cancel_job",
    "runtime.inspect_job",
    "plan.open",
    "plan.edit",
    "plan.approve",
    "plan.reject",
    "shell.start",
    "shell.input",
    "shell.resize",
    "shell.kill",
    "context.attach_files",
    "context.mention_search",
    "palette.invoke_action",
    "overlay.open",
    "overlay.dismiss",
    "overlay.dismiss_all",
    "assessment.run",
    "assessment.list_runs",
    "assessment.fetch_report",
    "assessment.fetch_evidence_preview",
    "assessment.cancel",
    "assessment.replay",
    "assessment.diff",
    "handoff.create",
    "handoff.fetch",
    "handoff.approve",
    "handoff.reject",
    "handoff.dispatch_local",
    "handoff.dispatch_web_cli",
    "handoff.export_blueprint",
    "handoff.cancel",
    "gate.evaluate",
    "gate.override",
    "gate.signoff",
    "gate.revoke_override",
    "connector.list",
    "release.list_targets",
    "release.deploy",
    "release.publish",
    "release.generate_notes",
    "continuous.write_config",
    "migration.create_draft",
    "migration.dry_run",
    "migration.verify_reversibility",
    "migration.dispatch",
    "connector.connect",
    "connector.disconnect",
    "connector.capabilities",
    "connector.health",
    "registry.sync",
    "registry.add",
];

/// Map command type → required tool capability.
///
/// Only commands that explicitly name a target tool/action at the wire boundary
/// are enforced here:
///
/// - `palette.invoke_action { actionId }` — user invokes a named action.
/// - `workbench.invoke { action }` — workbench-scoped action.
/// - `shell.start { profile }` — spawns a shell under `profile`.
/// - `handoff.dispatch_*` — explicit mutation escalation.
/// - `gate.override` — governance escalation.
///
/// Protocol flows like `message.submit`, `approval.approve`, `assessment.run`,
/// `session.*` are **not** tool invocations at this boundary. Engine Layer 2
/// enforces the concrete tool calls the agent makes downstream.
fn required_tool_for(cmd: &str, payload: &serde_json::Value) -> Option<String> {
    match cmd {
        "palette.invoke_action" => payload
            .get("actionId")
            .and_then(|v| v.as_str())
            .map(String::from),
        "workbench.invoke" => payload
            .get("action")
            .and_then(|v| v.as_str())
            .map(String::from),
        "handoff.dispatch_local" | "handoff.dispatch_web_cli" => Some("handoff.dispatch".into()),
        "gate.override" | "gate.revoke_override" => Some("gate.override".into()),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnforceOutcome {
    Allowed,
    Denied { code: &'static str, reason: String },
    UnknownCommand,
}

pub fn enforce_action(cmd: &ClientCommand, state: &AppStateHandle) -> EnforceOutcome {
    if !KNOWN_COMMANDS.contains(&cmd.cmd_type.as_str()) {
        return EnforceOutcome::UnknownCommand;
    }
    if SESSIONLESS_COMMANDS.contains(&cmd.cmd_type.as_str()) {
        return EnforceOutcome::Allowed;
    }

    let Some(tool) = required_tool_for(&cmd.cmd_type, &cmd.payload) else {
        // Known protocol command without tool mapping: allow.
        return EnforceOutcome::Allowed;
    };

    let Some(handle) = state.sessions.get(&cmd.session_id) else {
        return EnforceOutcome::Denied {
            code: "session.not_found",
            reason: format!("session {} not found", cmd.session_id),
        };
    };

    let profile = match load_profile(&handle.profile_id, &state.profile_root) {
        Ok(p) => p,
        Err(e) => {
            return EnforceOutcome::Denied {
                code: "profile.load_failed",
                reason: e.to_string(),
            };
        }
    };

    match enforce_tool(&profile, &tool) {
        Decision::Allow => EnforceOutcome::Allowed,
        Decision::Deny { code, reason } => EnforceOutcome::Denied { code, reason },
    }
}

fn load_profile(
    profile_id: &str,
    profile_root: &std::path::Path,
) -> Result<CapabilityProfile, anyhow::Error> {
    use dashmap::DashMap;
    static CACHE: OnceLock<DashMap<String, CapabilityProfile>> = OnceLock::new();
    let cache = CACHE.get_or_init(DashMap::new);
    if let Some(p) = cache.get(profile_id) {
        return Ok(p.clone());
    }
    let p = CapabilityProfile::load(profile_id, profile_root)?;
    cache.insert(profile_id.to_string(), p.clone());
    Ok(p)
}
