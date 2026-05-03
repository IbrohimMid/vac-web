//! Profile enforcement Layer 1 — bridge-side check before command reaches engine.
//!
//! The set of accepted command ids is sourced from the generated command
//! catalog (`crate::generated::command_catalog`), which itself derives from
//! `config/control-plane/command-manifest.yaml`. New commands must be added
//! to the manifest and codegen re-run; the catalog is the source of truth.

use crate::generated::command_catalog::{self, CommandStatus};
use crate::server::AppStateHandle;
use crate::ws::envelope::ClientCommand;
use profile_core::{enforce::enforce_tool, profile::CapabilityProfile, Decision};
use std::sync::OnceLock;

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
    Denied {
        code: &'static str,
        reason: String,
    },
    UnknownCommand,
    /// Command is declared in the implementation manifest but has no
    /// bridge executor wired yet. The translator returns a deterministic
    /// `feature.not_wired` ack so external/stale clients see a stable
    /// error code instead of being silently forwarded to the agent.
    NotWired {
        command: String,
        reason: String,
    },
}

pub fn enforce_action(cmd: &ClientCommand, state: &AppStateHandle) -> EnforceOutcome {
    let entry = match command_catalog::lookup(cmd.cmd_type.as_str()) {
        Some(e) => e,
        None => return EnforceOutcome::UnknownCommand,
    };

    match entry.status {
        CommandStatus::FrontendOwned | CommandStatus::ProtocolOnly | CommandStatus::Internal => {
            // These should never be sent over the wire as client commands.
            return EnforceOutcome::UnknownCommand;
        }
        CommandStatus::Deprecated => {
            return EnforceOutcome::NotWired {
                command: cmd.cmd_type.clone(),
                reason: format!(
                    "command '{}' is deprecated and no longer accepted",
                    cmd.cmd_type
                ),
            };
        }
        CommandStatus::NotWired => {
            return EnforceOutcome::NotWired {
                command: cmd.cmd_type.clone(),
                reason: format!(
                    "command '{}' is declared but not wired to a bridge executor yet",
                    cmd.cmd_type
                ),
            };
        }
        CommandStatus::Implemented => {}
    }

    if command_catalog::is_sessionless(cmd.cmd_type.as_str()) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_commands_set_matches_catalog() {
        let from_catalog: Vec<&'static str> = command_catalog::KNOWN_COMMANDS.to_vec();
        // No duplicates, all classified.
        let mut sorted = from_catalog.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            sorted.len(),
            from_catalog.len(),
            "duplicate command id in KNOWN_COMMANDS"
        );
        for id in from_catalog {
            let st = command_catalog::status_of(id).expect("known command must have a status");
            assert!(
                matches!(st, CommandStatus::Implemented | CommandStatus::NotWired),
                "known command {id} must be Implemented or NotWired, got {:?}",
                st
            );
        }
    }

    #[test]
    fn frontend_owned_commands_are_not_known_to_bridge() {
        for entry in command_catalog::COMMAND_CATALOG {
            if matches!(
                entry.status,
                CommandStatus::FrontendOwned
                    | CommandStatus::ProtocolOnly
                    | CommandStatus::Internal
            ) {
                assert!(
                    !command_catalog::is_known(entry.id),
                    "{} should not be in KNOWN_COMMANDS",
                    entry.id
                );
            }
        }
    }

    #[test]
    fn not_wired_commands_route_through_not_wired_outcome() {
        // shell.start is canonical not_wired in the manifest.
        assert!(command_catalog::is_not_wired("shell.start"));
        assert_eq!(
            command_catalog::status_of("shell.start"),
            Some(CommandStatus::NotWired)
        );
    }
}
