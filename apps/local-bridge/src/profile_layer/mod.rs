//! Profile enforcement Layer 1 — bridge-side check before command reaches engine.
//!
//! The set of accepted command ids is sourced from the generated command
//! catalog (`crate::generated::command_catalog`), which itself derives from
//! `config/control-plane/command-manifest.yaml`. New commands must be added
//! to the manifest and codegen re-run; the catalog is the source of truth.
//!
//! R08-F02 default-deny: every Implemented Session command MUST declare
//! `requires_profile_tool` (Tool mode) or an explicit `tool_enforcement`
//! variant (`protocol_only`, `payload_action_id`, `payload_action`) in the
//! manifest. Commands lacking both are denied with
//! `profile.tool_mapping_missing` so a missing mapping never becomes an
//! implicit allow.

use crate::generated::command_catalog::{self, CommandStatus, ToolEnforcement};
use crate::server::AppStateHandle;
use crate::ws::envelope::ClientCommand;
use profile_core::{enforce::enforce_tool, profile::CapabilityProfile, Decision};
use std::sync::OnceLock;

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

/// Resolve the profile tool name to enforce for `cmd`, based on the
/// manifest-declared `tool_enforcement` and `requires_profile_tool` on the
/// catalog entry. Returns:
///
/// - `Ok(Some(tool))` — enforce this tool against the session's profile.
/// - `Ok(None)` — protocol-only flow; bypass profile enforcement.
/// - `Err(outcome)` — denied due to missing mapping or missing payload field.
fn resolve_tool(cmd: &ClientCommand) -> Result<Option<String>, EnforceOutcome> {
    let entry = match command_catalog::lookup(cmd.cmd_type.as_str()) {
        Some(e) => e,
        None => return Err(EnforceOutcome::UnknownCommand),
    };
    let mode = command_catalog::tool_enforcement_of(cmd.cmd_type.as_str());
    match mode {
        Some(ToolEnforcement::ProtocolOnly) => Ok(None),
        Some(ToolEnforcement::Tool) => match entry.requires_profile_tool {
            Some(t) => Ok(Some(t.to_string())),
            None => Err(EnforceOutcome::Denied {
                code: "profile.tool_mapping_missing",
                reason: format!(
                    "command '{}' declares tool_enforcement=tool but no requires_profile_tool",
                    cmd.cmd_type
                ),
            }),
        },
        Some(ToolEnforcement::PayloadActionId) => {
            match cmd.payload.get("actionId").and_then(|v| v.as_str()) {
                Some(s) if !s.is_empty() => Ok(Some(s.to_string())),
                _ => Err(EnforceOutcome::Denied {
                    code: "profile.tool_payload_missing",
                    reason: format!(
                        "command '{}' requires payload.actionId for profile enforcement",
                        cmd.cmd_type
                    ),
                }),
            }
        }
        Some(ToolEnforcement::PayloadAction) => {
            match cmd.payload.get("action").and_then(|v| v.as_str()) {
                Some(s) if !s.is_empty() => Ok(Some(s.to_string())),
                _ => Err(EnforceOutcome::Denied {
                    code: "profile.tool_payload_missing",
                    reason: format!(
                        "command '{}' requires payload.action for profile enforcement",
                        cmd.cmd_type
                    ),
                }),
            }
        }
        None => Err(EnforceOutcome::Denied {
            code: "profile.tool_mapping_missing",
            reason: format!(
                "command '{}' has no profile tool mapping in manifest (R08-F02 default-deny)",
                cmd.cmd_type
            ),
        }),
    }
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

    let tool = match resolve_tool(cmd) {
        Ok(None) => return EnforceOutcome::Allowed,
        Ok(Some(t)) => t,
        Err(outcome) => return outcome,
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

    /// R08-F02 default-deny invariant: every Implemented Session command in
    /// the catalog must declare either `requires_profile_tool` (Tool mode)
    /// or an explicit non-Tool `tool_enforcement` variant in the manifest.
    /// The runtime denies anything else with `profile.tool_mapping_missing`,
    /// so this test guards against a forgotten manifest entry slipping past
    /// review and reverting the layer to an implicit-allow posture.
    #[test]
    fn every_implemented_session_command_has_tool_enforcement() {
        use command_catalog::CommandScope;
        let mut missing: Vec<&'static str> = vec![];
        for entry in command_catalog::COMMAND_CATALOG {
            if !matches!(entry.status, CommandStatus::Implemented) {
                continue;
            }
            if !matches!(entry.scope, CommandScope::Session) {
                continue;
            }
            if command_catalog::tool_enforcement_of(entry.id).is_none() {
                missing.push(entry.id);
            }
        }
        assert!(
            missing.is_empty(),
            "every Implemented Session command must declare requires_profile_tool or tool_enforcement (R08-F02 default-deny). Missing: {:?}",
            missing
        );
    }
}
