// AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: config/control-plane/command-manifest.yaml
//
// Run `node scripts/codegen-command-catalog.mjs` to regenerate.

export type CommandStatus = 'implemented' | 'not_wired' | 'frontend_owned' | 'protocol_only' | 'internal' | 'deprecated';
export type CommandScope = 'sessionless' | 'session' | 'either';
export type CommandSideEffect = 'none' | 'read_only' | 'state' | 'external';

export interface CommandEntry {
  readonly id: CommandId;
  readonly status: CommandStatus;
  readonly scope: CommandScope;
  readonly sideEffect: CommandSideEffect;
  readonly requiresProfileTool?: string;
  readonly runtime?: string;
  readonly summary?: string;
  readonly ui?: { readonly gate?: string; readonly reason?: string };
}

// Discriminated string-literal union of every classified command id.
export type CommandId =
  | 'approval.approve'
  | 'approval.approve_all'
  | 'approval.inspect'
  | 'approval.reject'
  | 'assessment.cancel'
  | 'assessment.diff'
  | 'assessment.fetch_evidence_preview'
  | 'assessment.fetch_report'
  | 'assessment.index.rebuild'
  | 'assessment.index.status'
  | 'assessment.list_runs'
  | 'assessment.replay'
  | 'assessment.run'
  | 'assessment.sweep.cancel'
  | 'assessment.sweep.run'
  | 'config.policy.get'
  | 'config.reload'
  | 'config.validate'
  | 'connector.capabilities'
  | 'connector.connect'
  | 'connector.disconnect'
  | 'connector.health'
  | 'connector.list'
  | 'context.attach_files'
  | 'context.mention_search'
  | 'continuous.write_config'
  | 'extensions.approve_promotion'
  | 'extensions.list'
  | 'extensions.list_approvals'
  | 'extensions.request_promotion'
  | 'extensions.update_trust'
  | 'gate.evaluate'
  | 'gate.override'
  | 'gate.revoke_override'
  | 'gate.signoff'
  | 'handoff.approve'
  | 'handoff.cancel'
  | 'handoff.create'
  | 'handoff.dispatch_local'
  | 'handoff.dispatch_web_cli'
  | 'handoff.export_blueprint'
  | 'handoff.fetch'
  | 'handoff.reject'
  | 'handoff.status'
  | 'message.cancel_stream'
  | 'message.retry'
  | 'message.submit'
  | 'migration.create_draft'
  | 'migration.dispatch'
  | 'migration.dry_run'
  | 'migration.verify_reversibility'
  | 'overlay.dismiss'
  | 'overlay.dismiss_all'
  | 'overlay.open'
  | 'palette.invoke_action'
  | 'perf.latest_run'
  | 'plan.approve'
  | 'plan.edit'
  | 'plan.open'
  | 'plan.reject'
  | 'registry.add'
  | 'registry.reload'
  | 'registry.sync'
  | 'release.deploy'
  | 'release.generate_notes'
  | 'release.list_targets'
  | 'release.publish'
  | 'review.open_file'
  | 'review.revert_all'
  | 'review.revert_file'
  | 'review.toggle_hunk'
  | 'runtime.cancel_job'
  | 'runtime.inspect_job'
  | 'runtime.list_jobs'
  | 'session.authenticate'
  | 'session.close'
  | 'session.config_option.set'
  | 'session.create'
  | 'session.history.forget'
  | 'session.history.list'
  | 'session.list'
  | 'session.mode.set'
  | 'session.rename'
  | 'session.resume'
  | 'session.snapshot'
  | 'shell.input'
  | 'shell.kill'
  | 'shell.resize'
  | 'shell.start'
  | 'system.capabilities'
  | 'system.ping'
  | 'system.version'
  | 'transcript.completed'
  | 'transcript.error'
  | 'workbench.invoke'
  | 'workbench.select_tab';

export const COMMAND_CATALOG: ReadonlyArray<CommandEntry> = Object.freeze([
  Object.freeze({ id: 'approval.approve', status: 'implemented', scope: 'session', sideEffect: 'state', summary: "Approve a pending approval; ACP intercepted and resolved without forwarding." }),
  Object.freeze({ id: 'approval.approve_all', status: 'not_wired', scope: 'session', sideEffect: 'state', summary: "Bulk approval requires explicit scope+audit; not wired.", ui: Object.freeze({ gate: 'disabled', reason: "Bulk approval is not enabled until scope and audit are real." }) }),
  Object.freeze({ id: 'approval.inspect', status: 'not_wired', scope: 'session', sideEffect: 'read_only', summary: "Approval inspect endpoint is held until persistence model is finalized." }),
  Object.freeze({ id: 'approval.reject', status: 'implemented', scope: 'session', sideEffect: 'state', summary: "Reject a pending approval." }),
  Object.freeze({ id: 'assessment.cancel', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'assessment.diff', status: 'implemented', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'assessment.fetch_evidence_preview', status: 'implemented', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'assessment.fetch_report', status: 'implemented', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'assessment.index.rebuild', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'assessment.index.status', status: 'implemented', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'assessment.list_runs', status: 'implemented', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'assessment.replay', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'assessment.run', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'assessment.sweep.cancel', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'assessment.sweep.run', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'config.policy.get', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only' }),
  Object.freeze({ id: 'config.reload', status: 'implemented', scope: 'sessionless', sideEffect: 'state' }),
  Object.freeze({ id: 'config.validate', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only' }),
  Object.freeze({ id: 'connector.capabilities', status: 'not_wired', scope: 'sessionless', sideEffect: 'read_only' }),
  Object.freeze({ id: 'connector.connect', status: 'not_wired', scope: 'sessionless', sideEffect: 'external', ui: Object.freeze({ gate: 'disabled', reason: "OAuth/connect path is held until real auth exists." }) }),
  Object.freeze({ id: 'connector.disconnect', status: 'not_wired', scope: 'sessionless', sideEffect: 'external', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'connector.health', status: 'not_wired', scope: 'sessionless', sideEffect: 'read_only' }),
  Object.freeze({ id: 'connector.list', status: 'not_wired', scope: 'sessionless', sideEffect: 'read_only', summary: "Connector registry surface is held until v0 local registry lands." }),
  Object.freeze({ id: 'context.attach_files', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.read', ui: Object.freeze({ gate: 'disabled', reason: "File attach respects project-root/profile policy; not wired." }) }),
  Object.freeze({ id: 'context.mention_search', status: 'not_wired', scope: 'session', sideEffect: 'read_only', summary: "Mention search is held until local indexes are wired." }),
  Object.freeze({ id: 'continuous.write_config', status: 'not_wired', scope: 'sessionless', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled', reason: "Continuous config write is held until validate+rollback exist." }) }),
  Object.freeze({ id: 'extensions.approve_promotion', status: 'implemented', scope: 'session', sideEffect: 'state', summary: "Slice" }),
  Object.freeze({ id: 'extensions.list', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "List declared extensions with their enforced trust tier." }),
  Object.freeze({ id: 'extensions.list_approvals', status: 'implemented', scope: 'session', sideEffect: 'read_only', summary: "Slice" }),
  Object.freeze({ id: 'extensions.request_promotion', status: 'implemented', scope: 'session', sideEffect: 'state', summary: "Slice" }),
  Object.freeze({ id: 'extensions.update_trust', status: 'implemented', scope: 'session', sideEffect: 'state', summary: "Mutate the trust tier of a declared extension and persist to disk. Session-bound; profile-layer enforces tool 'extensions.update_trust' (Slice" }),
  Object.freeze({ id: 'gate.evaluate', status: 'not_wired', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'gate.override', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'gate.override', ui: Object.freeze({ gate: 'disabled', reason: "Gate override requires reason+expiry+audit; not wired." }) }),
  Object.freeze({ id: 'gate.revoke_override', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'gate.override', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'gate.signoff', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled', reason: "Gate signoff requires persistence + audit; not wired." }) }),
  Object.freeze({ id: 'handoff.approve', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'handoff.cancel', status: 'not_wired', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'handoff.create', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'handoff.dispatch_local', status: 'implemented', scope: 'session', sideEffect: 'external', requiresProfileTool: 'handoff.dispatch' }),
  Object.freeze({ id: 'handoff.dispatch_web_cli', status: 'not_wired', scope: 'session', sideEffect: 'external', requiresProfileTool: 'handoff.dispatch', ui: Object.freeze({ gate: 'disabled', reason: "Web-CLI dispatch is held until tunnel/auth is wired." }) }),
  Object.freeze({ id: 'handoff.export_blueprint', status: 'not_wired', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'handoff.fetch', status: 'not_wired', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'handoff.reject', status: 'implemented', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'handoff.status', status: 'implemented', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'message.cancel_stream', status: 'implemented', scope: 'session', sideEffect: 'state', runtime: 'agent_forwarded', summary: "Cancel the in-flight assistant response." }),
  Object.freeze({ id: 'message.retry', status: 'implemented', scope: 'session', sideEffect: 'state', runtime: 'agent_forwarded', summary: "Retry the last submission." }),
  Object.freeze({ id: 'message.submit', status: 'implemented', scope: 'session', sideEffect: 'state', runtime: 'agent_forwarded', summary: "Submit a user message to the active agent (ACP/native)." }),
  Object.freeze({ id: 'migration.create_draft', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'migration.dispatch', status: 'not_wired', scope: 'session', sideEffect: 'external', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'migration.dry_run', status: 'not_wired', scope: 'session', sideEffect: 'read_only', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'migration.verify_reversibility', status: 'not_wired', scope: 'session', sideEffect: 'read_only', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'overlay.dismiss', status: 'frontend_owned', scope: 'session', sideEffect: 'none' }),
  Object.freeze({ id: 'overlay.dismiss_all', status: 'frontend_owned', scope: 'session', sideEffect: 'none' }),
  Object.freeze({ id: 'overlay.open', status: 'frontend_owned', scope: 'session', sideEffect: 'none' }),
  Object.freeze({ id: 'palette.invoke_action', status: 'not_wired', scope: 'session', sideEffect: 'state', summary: "Generic palette invoke must map to a concrete command before execution.", ui: Object.freeze({ gate: 'disabled', reason: "Palette actions must be classified before they execute." }) }),
  Object.freeze({ id: 'perf.latest_run', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "Slice" }),
  Object.freeze({ id: 'plan.approve', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'plan.edit', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled', reason: "Plan editing requires bridge plan state; not wired." }) }),
  Object.freeze({ id: 'plan.open', status: 'frontend_owned', scope: 'session', sideEffect: 'none' }),
  Object.freeze({ id: 'plan.reject', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'registry.add', status: 'implemented', scope: 'sessionless', sideEffect: 'state' }),
  Object.freeze({ id: 'registry.reload', status: 'implemented', scope: 'sessionless', sideEffect: 'state' }),
  Object.freeze({ id: 'registry.sync', status: 'implemented', scope: 'sessionless', sideEffect: 'state' }),
  Object.freeze({ id: 'release.deploy', status: 'not_wired', scope: 'session', sideEffect: 'external', ui: Object.freeze({ gate: 'disabled', reason: "Deploy is disabled until gate readiness + audit + executor exist." }) }),
  Object.freeze({ id: 'release.generate_notes', status: 'not_wired', scope: 'session', sideEffect: 'read_only', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'release.list_targets', status: 'not_wired', scope: 'either', sideEffect: 'read_only', ui: Object.freeze({ gate: 'disabled', reason: "Release targets surface is held until config-driven read lands." }) }),
  Object.freeze({ id: 'release.publish', status: 'not_wired', scope: 'session', sideEffect: 'external', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'review.open_file', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.read', summary: "File-open executor with project-root scope is not implemented.", ui: Object.freeze({ gate: 'disabled', reason: "File-open is not wired to bridge fs scope yet." }) }),
  Object.freeze({ id: 'review.revert_all', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.write', ui: Object.freeze({ gate: 'disabled', reason: "Bulk revert requires bridge fs executor + audit; not wired." }) }),
  Object.freeze({ id: 'review.revert_file', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.write', ui: Object.freeze({ gate: 'disabled', reason: "Revert requires bridge fs executor + audit; not wired." }) }),
  Object.freeze({ id: 'review.toggle_hunk', status: 'frontend_owned', scope: 'session', sideEffect: 'none', summary: "Hunk toggle is local UI state." }),
  Object.freeze({ id: 'runtime.cancel_job', status: 'not_wired', scope: 'session', sideEffect: 'state', summary: "Provider-observed jobs are not bridge-cancellable.", ui: Object.freeze({ gate: 'disabled', reason: "Cancel requires a bridge-owned job; observed provider jobs are read-only." }) }),
  Object.freeze({ id: 'runtime.inspect_job', status: 'not_wired', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'runtime.list_jobs', status: 'not_wired', scope: 'session', sideEffect: 'read_only', summary: "Bridge job registry is read-only via runtime.* events; list endpoint not wired." }),
  Object.freeze({ id: 'session.authenticate', status: 'implemented', scope: 'session', sideEffect: 'state', runtime: 'acp', summary: "Forwards an ACP authenticate.method request to the active provider." }),
  Object.freeze({ id: 'session.close', status: 'implemented', scope: 'session', sideEffect: 'state', summary: "Terminate the active session and release ACP resources." }),
  Object.freeze({ id: 'session.config_option.set', status: 'implemented', scope: 'session', sideEffect: 'state', runtime: 'acp', summary: "ACP-only — update an active session config option." }),
  Object.freeze({ id: 'session.create', status: 'implemented', scope: 'sessionless', sideEffect: 'state', summary: "Create a new session under a profile/agent/workflow." }),
  Object.freeze({ id: 'session.history.forget', status: 'implemented', scope: 'sessionless', sideEffect: 'state', summary: "Forget a persisted session row." }),
  Object.freeze({ id: 'session.history.list', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "List persisted session history rows." }),
  Object.freeze({ id: 'session.list', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "List the bridge's active sessions." }),
  Object.freeze({ id: 'session.mode.set', status: 'implemented', scope: 'session', sideEffect: 'state', runtime: 'acp', summary: "ACP-only — switch active session mode/model." }),
  Object.freeze({ id: 'session.rename', status: 'not_wired', scope: 'session', sideEffect: 'state', summary: "Persistence-backed rename is not wired; SessionsTab is gated." }),
  Object.freeze({ id: 'session.resume', status: 'implemented', scope: 'sessionless', sideEffect: 'state', summary: "Resume a previously-created session by id." }),
  Object.freeze({ id: 'session.snapshot', status: 'not_wired', scope: 'session', sideEffect: 'state', summary: "Snapshotting is held until persistence/replay v2 lands." }),
  Object.freeze({ id: 'shell.input', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'shell.exec' }),
  Object.freeze({ id: 'shell.kill', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'shell.exec' }),
  Object.freeze({ id: 'shell.resize', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'shell.exec' }),
  Object.freeze({ id: 'shell.start', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'shell.exec', ui: Object.freeze({ gate: 'disabled', reason: "Shell backend is not implemented yet." }) }),
  Object.freeze({ id: 'system.capabilities', status: 'protocol_only', scope: 'sessionless', sideEffect: 'none', summary: "Bridge emits system.capabilities as an event on session.ready; not accepted as a command." }),
  Object.freeze({ id: 'system.ping', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "Health check that returns pong from the bridge." }),
  Object.freeze({ id: 'system.version', status: 'not_wired', scope: 'sessionless', sideEffect: 'read_only', summary: "Bridge version metadata is not exposed as a request yet.", ui: Object.freeze({ gate: 'hidden', reason: "Bridge version is read from the WebSocket banner." }) }),
  Object.freeze({ id: 'transcript.completed', status: 'protocol_only', scope: 'session', sideEffect: 'none', summary: "Session-internal completion signal; not a client command." }),
  Object.freeze({ id: 'transcript.error', status: 'protocol_only', scope: 'session', sideEffect: 'none', summary: "Session-internal error signal; not a client command." }),
  Object.freeze({ id: 'workbench.invoke', status: 'not_wired', scope: 'session', sideEffect: 'state', summary: "Generic workbench invoke is not implemented as a bridge executor.", ui: Object.freeze({ gate: 'disabled', reason: "Workbench invoke is not wired to a concrete backend command." }) }),
  Object.freeze({ id: 'workbench.select_tab', status: 'frontend_owned', scope: 'session', sideEffect: 'none', summary: "UI-only tab selection; should not cross WebSocket." }),
]);

export const COMMAND_BY_ID: ReadonlyMap<CommandId, CommandEntry> = new Map(COMMAND_CATALOG.map((e) => [e.id, e]));

export function commandStatus(id: string): CommandStatus | undefined {
  return COMMAND_BY_ID.get(id as CommandId)?.status;
}

export function isKnownCommand(id: string): id is CommandId {
  return COMMAND_BY_ID.has(id as CommandId);
}

export function isImplemented(id: string): boolean {
  return commandStatus(id) === 'implemented';
}

export function isNotWired(id: string): boolean {
  return commandStatus(id) === 'not_wired';
}
