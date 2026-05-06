//! AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: config/control-plane/command-manifest.yaml
//!
//! Run `node scripts/codegen-command-catalog.mjs` to regenerate.

#![allow(dead_code)]

/// Classification status for every protocol/bridge command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CommandStatus {
    Implemented,
    NotWired,
    FrontendOwned,
    ProtocolOnly,
    Internal,
    Deprecated,
}

impl CommandStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Implemented => "implemented",
            Self::NotWired => "not_wired",
            Self::FrontendOwned => "frontend_owned",
            Self::ProtocolOnly => "protocol_only",
            Self::Internal => "internal",
            Self::Deprecated => "deprecated",
        }
    }
}

/// Classification scope: when does the command need a session?
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandScope {
    Sessionless,
    Session,
    Either,
}

/// Side-effect classification for every command.
///
/// - `None` — no observable bridge state change (frontend_owned, protocol_only).
/// - `ReadOnly` — queries/fetches; safe to retry, does not mutate bridge state.
/// - `State` — mutates bridge / session / agent state; default for implemented & not_wired.
/// - `External` — effects outside the bridge process (deploys, dispatches, connector handshakes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CommandSideEffect {
    None,
    ReadOnly,
    State,
    External,
}

impl CommandSideEffect {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::ReadOnly => "read_only",
            Self::State => "state",
            Self::External => "external",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CommandEntry {
    pub id: &'static str,
    pub status: CommandStatus,
    pub scope: CommandScope,
    pub side_effect: CommandSideEffect,
}

#[rustfmt::skip]
pub const COMMAND_CATALOG: &[CommandEntry] = &[
    CommandEntry { id: "approval.approve", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "approval.approve_all", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "approval.inspect", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "approval.reject", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "assessment.cancel", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "assessment.diff", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "assessment.fetch_evidence_preview", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "assessment.fetch_report", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "assessment.index.rebuild", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "assessment.index.status", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "assessment.list_runs", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "assessment.replay", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "assessment.run", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "assessment.sweep.cancel", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "assessment.sweep.run", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "config.policy.get", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "config.reload", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "config.validate", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "connector.capabilities", status: CommandStatus::NotWired, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "connector.connect", status: CommandStatus::NotWired, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::External },
    CommandEntry { id: "connector.disconnect", status: CommandStatus::NotWired, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::External },
    CommandEntry { id: "connector.health", status: CommandStatus::NotWired, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "connector.list", status: CommandStatus::NotWired, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "context.attach_files", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "context.mention_search", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "continuous.write_config", status: CommandStatus::NotWired, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "extensions.list", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "extensions.update_trust", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "gate.evaluate", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "gate.override", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "gate.revoke_override", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "gate.signoff", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "handoff.approve", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "handoff.cancel", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "handoff.create", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "handoff.dispatch_local", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::External },
    CommandEntry { id: "handoff.dispatch_web_cli", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::External },
    CommandEntry { id: "handoff.export_blueprint", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "handoff.fetch", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "handoff.reject", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "handoff.status", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "message.cancel_stream", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "message.retry", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "message.submit", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "migration.create_draft", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "migration.dispatch", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::External },
    CommandEntry { id: "migration.dry_run", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "migration.verify_reversibility", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "overlay.dismiss", status: CommandStatus::FrontendOwned, scope: CommandScope::Session, side_effect: CommandSideEffect::None },
    CommandEntry { id: "overlay.dismiss_all", status: CommandStatus::FrontendOwned, scope: CommandScope::Session, side_effect: CommandSideEffect::None },
    CommandEntry { id: "overlay.open", status: CommandStatus::FrontendOwned, scope: CommandScope::Session, side_effect: CommandSideEffect::None },
    CommandEntry { id: "palette.invoke_action", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "plan.approve", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "plan.edit", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "plan.open", status: CommandStatus::FrontendOwned, scope: CommandScope::Session, side_effect: CommandSideEffect::None },
    CommandEntry { id: "plan.reject", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "registry.add", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "registry.reload", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "registry.sync", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "release.deploy", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::External },
    CommandEntry { id: "release.generate_notes", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "release.list_targets", status: CommandStatus::NotWired, scope: CommandScope::Either, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "release.publish", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::External },
    CommandEntry { id: "review.open_file", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "review.revert_all", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "review.revert_file", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "review.toggle_hunk", status: CommandStatus::FrontendOwned, scope: CommandScope::Session, side_effect: CommandSideEffect::None },
    CommandEntry { id: "runtime.cancel_job", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "runtime.inspect_job", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "runtime.list_jobs", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "session.authenticate", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "session.close", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "session.config_option.set", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "session.create", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "session.history.forget", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "session.history.list", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "session.list", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "session.mode.set", status: CommandStatus::Implemented, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "session.rename", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "session.resume", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::State },
    CommandEntry { id: "session.snapshot", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "shell.input", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "shell.kill", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "shell.resize", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "shell.start", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "system.capabilities", status: CommandStatus::ProtocolOnly, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::None },
    CommandEntry { id: "system.ping", status: CommandStatus::Implemented, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "system.version", status: CommandStatus::NotWired, scope: CommandScope::Sessionless, side_effect: CommandSideEffect::ReadOnly },
    CommandEntry { id: "transcript.completed", status: CommandStatus::ProtocolOnly, scope: CommandScope::Session, side_effect: CommandSideEffect::None },
    CommandEntry { id: "transcript.error", status: CommandStatus::ProtocolOnly, scope: CommandScope::Session, side_effect: CommandSideEffect::None },
    CommandEntry { id: "workbench.invoke", status: CommandStatus::NotWired, scope: CommandScope::Session, side_effect: CommandSideEffect::State },
    CommandEntry { id: "workbench.select_tab", status: CommandStatus::FrontendOwned, scope: CommandScope::Session, side_effect: CommandSideEffect::None },
];

/// Every command id the bridge accepts on the WebSocket boundary
/// (implemented + not_wired). frontend_owned/protocol_only ids are excluded.
pub const KNOWN_COMMANDS: &[&str] = &[
    "approval.approve",
    "approval.approve_all",
    "approval.inspect",
    "approval.reject",
    "assessment.cancel",
    "assessment.diff",
    "assessment.fetch_evidence_preview",
    "assessment.fetch_report",
    "assessment.index.rebuild",
    "assessment.index.status",
    "assessment.list_runs",
    "assessment.replay",
    "assessment.run",
    "assessment.sweep.cancel",
    "assessment.sweep.run",
    "config.policy.get",
    "config.reload",
    "config.validate",
    "connector.capabilities",
    "connector.connect",
    "connector.disconnect",
    "connector.health",
    "connector.list",
    "context.attach_files",
    "context.mention_search",
    "continuous.write_config",
    "extensions.list",
    "extensions.update_trust",
    "gate.evaluate",
    "gate.override",
    "gate.revoke_override",
    "gate.signoff",
    "handoff.approve",
    "handoff.cancel",
    "handoff.create",
    "handoff.dispatch_local",
    "handoff.dispatch_web_cli",
    "handoff.export_blueprint",
    "handoff.fetch",
    "handoff.reject",
    "handoff.status",
    "message.cancel_stream",
    "message.retry",
    "message.submit",
    "migration.create_draft",
    "migration.dispatch",
    "migration.dry_run",
    "migration.verify_reversibility",
    "palette.invoke_action",
    "plan.approve",
    "plan.edit",
    "plan.reject",
    "registry.add",
    "registry.reload",
    "registry.sync",
    "release.deploy",
    "release.generate_notes",
    "release.list_targets",
    "release.publish",
    "review.open_file",
    "review.revert_all",
    "review.revert_file",
    "runtime.cancel_job",
    "runtime.inspect_job",
    "runtime.list_jobs",
    "session.authenticate",
    "session.close",
    "session.config_option.set",
    "session.create",
    "session.history.forget",
    "session.history.list",
    "session.list",
    "session.mode.set",
    "session.rename",
    "session.resume",
    "session.snapshot",
    "shell.input",
    "shell.kill",
    "shell.resize",
    "shell.start",
    "system.ping",
    "system.version",
    "workbench.invoke",
];

/// Commands acceptable without an active session.
pub const SESSIONLESS_COMMANDS: &[&str] = &[
    "config.policy.get",
    "config.reload",
    "config.validate",
    "connector.capabilities",
    "connector.connect",
    "connector.disconnect",
    "connector.health",
    "connector.list",
    "continuous.write_config",
    "extensions.list",
    "extensions.update_trust",
    "registry.add",
    "registry.reload",
    "registry.sync",
    "release.list_targets",
    "session.create",
    "session.history.forget",
    "session.history.list",
    "session.list",
    "session.resume",
    "system.ping",
    "system.version",
];

/// Commands declared but not yet implemented; the bridge intercepts
/// them before forwarding to the agent and returns feature.not_wired.
pub const NOT_WIRED_COMMANDS: &[&str] = &[
    "approval.approve_all",
    "approval.inspect",
    "connector.capabilities",
    "connector.connect",
    "connector.disconnect",
    "connector.health",
    "connector.list",
    "context.attach_files",
    "context.mention_search",
    "continuous.write_config",
    "gate.evaluate",
    "gate.override",
    "gate.revoke_override",
    "gate.signoff",
    "handoff.cancel",
    "handoff.dispatch_web_cli",
    "handoff.export_blueprint",
    "handoff.fetch",
    "migration.create_draft",
    "migration.dispatch",
    "migration.dry_run",
    "migration.verify_reversibility",
    "palette.invoke_action",
    "plan.approve",
    "plan.edit",
    "plan.reject",
    "release.deploy",
    "release.generate_notes",
    "release.list_targets",
    "release.publish",
    "review.open_file",
    "review.revert_all",
    "review.revert_file",
    "runtime.cancel_job",
    "runtime.inspect_job",
    "runtime.list_jobs",
    "session.rename",
    "session.snapshot",
    "shell.input",
    "shell.kill",
    "shell.resize",
    "shell.start",
    "system.version",
    "workbench.invoke",
];

pub fn lookup(cmd: &str) -> Option<&'static CommandEntry> {
    COMMAND_CATALOG.iter().find(|e| e.id == cmd)
}

pub fn status_of(cmd: &str) -> Option<CommandStatus> {
    lookup(cmd).map(|e| e.status)
}

pub fn is_known(cmd: &str) -> bool {
    KNOWN_COMMANDS.contains(&cmd)
}

pub fn is_sessionless(cmd: &str) -> bool {
    SESSIONLESS_COMMANDS.contains(&cmd)
}

pub fn is_not_wired(cmd: &str) -> bool {
    NOT_WIRED_COMMANDS.contains(&cmd)
}
