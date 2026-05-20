// AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: config/control-plane/command-manifest.yaml
//
// Run `node scripts/codegen-command-catalog.mjs` to regenerate.

export type CommandStatus = 'implemented' | 'not_wired' | 'frontend_owned' | 'protocol_only' | 'internal' | 'deprecated';
export type CommandScope = 'sessionless' | 'session' | 'either';
export type CommandSideEffect = 'none' | 'read_only' | 'state' | 'external';
export type ToolEnforcement = 'tool' | 'protocol_only' | 'payload_action_id' | 'payload_action';

export interface CommandEntry {
  readonly id: CommandId;
  readonly status: CommandStatus;
  readonly scope: CommandScope;
  readonly sideEffect: CommandSideEffect;
  readonly requiresProfileTool?: string;
  readonly toolEnforcement?: ToolEnforcement;
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
  | 'bridge.mutation.approve'
  | 'bridge.mutation.refine_request'
  | 'bridge.mutation.reject'
  | 'coding.context.ask_about_file'
  | 'coding.context.ask_about_selection'
  | 'coding.context.request_edit'
  | 'coding.context.request_tests'
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
  | 'gate.sync_mutation_audit'
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
  | 'project.file.request'
  | 'project.tree.request'
  | 'registry.add'
  | 'registry.reload'
  | 'registry.sync'
  | 'release.deploy'
  | 'release.generate_notes'
  | 'release.list_targets'
  | 'release.publish'
  | 'review.hunk.action.request'
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
  | 'task.execution.continue'
  | 'task.plan.request_changes'
  | 'transcript.completed'
  | 'transcript.error'
  | 'validation.failure.send_context'
  | 'validation.run.request'
  | 'workbench.invoke'
  | 'workbench.select_tab'
  | 'workspace.branch.request'
  | 'workspace.preview.open'
  | 'workspace.preview.refresh'
  | 'workspace.preview.run_e2e'
  | 'workspace.preview.send_context'
  | 'workspace.preview.stop';

export const COMMAND_CATALOG: ReadonlyArray<CommandEntry> = Object.freeze([
  Object.freeze({ id: 'approval.approve', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Approve a pending approval; ACP intercepted and resolved without forwarding." }),
  Object.freeze({ id: 'approval.approve_all', status: 'not_wired', scope: 'session', sideEffect: 'state', summary: "Bulk approval requires explicit scope+audit; not wired.", ui: Object.freeze({ gate: 'disabled', reason: "Bulk approval is not enabled until scope and audit are real." }) }),
  Object.freeze({ id: 'approval.inspect', status: 'not_wired', scope: 'session', sideEffect: 'read_only', summary: "Approval inspect endpoint is held until persistence model is finalized." }),
  Object.freeze({ id: 'approval.reject', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Reject a pending approval." }),
  Object.freeze({ id: 'assessment.cancel', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.diff', status: 'implemented', scope: 'session', sideEffect: 'read_only', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.fetch_evidence_preview', status: 'implemented', scope: 'session', sideEffect: 'read_only', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.fetch_report', status: 'implemented', scope: 'session', sideEffect: 'read_only', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.index.rebuild', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.index.status', status: 'implemented', scope: 'session', sideEffect: 'read_only', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.list_runs', status: 'implemented', scope: 'session', sideEffect: 'read_only', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.replay', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.run', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.sweep.cancel', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'assessment.sweep.run', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'bridge.mutation.approve', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.write', summary: "Approve a pending bridge mutation; the bridge applies on disk and emits the audited lifecycle event." }),
  Object.freeze({ id: 'bridge.mutation.refine_request', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Ask the local AI to refine a pending bridge mutation; the intent stays pending until a new request_id replaces it." }),
  Object.freeze({ id: 'bridge.mutation.reject', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Reject a pending bridge mutation; the bridge discards the intent without touching disk." }),
  Object.freeze({ id: 'coding.context.ask_about_file', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Forward file context to the active agent as a structured prompt." }),
  Object.freeze({ id: 'coding.context.ask_about_selection', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Forward selected lines to the active agent as a structured prompt." }),
  Object.freeze({ id: 'coding.context.request_edit', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Ask the active agent to edit a file using current workspace context." }),
  Object.freeze({ id: 'coding.context.request_tests', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Ask the active agent to generate or update tests for a file." }),
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
  Object.freeze({ id: 'extensions.approve_promotion', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'extensions.approve_promotion', summary: "Slice" }),
  Object.freeze({ id: 'extensions.list', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "List declared extensions with their enforced trust tier." }),
  Object.freeze({ id: 'extensions.list_approvals', status: 'implemented', scope: 'session', sideEffect: 'read_only', requiresProfileTool: 'extensions.list_approvals', summary: "Slice" }),
  Object.freeze({ id: 'extensions.request_promotion', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'extensions.request_promotion', summary: "Slice" }),
  Object.freeze({ id: 'extensions.update_trust', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'extensions.update_trust', summary: "Mutate the trust tier of a declared extension and persist to disk. Session-bound; profile-layer enforces tool 'extensions.update_trust' (Slice" }),
  Object.freeze({ id: 'gate.evaluate', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Emit the current gate snapshot for a session." }),
  Object.freeze({ id: 'gate.override', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'gate.override', summary: "Persist an audit-logged gate override with expiry." }),
  Object.freeze({ id: 'gate.revoke_override', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'gate.override', summary: "Revoke an active gate override." }),
  Object.freeze({ id: 'gate.signoff', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'gate.signoff', summary: "Record a gate sign-off and persist it." }),
  Object.freeze({ id: 'gate.sync_mutation_audit', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Replay outstanding bridge.mutation lifecycle events for the active session." }),
  Object.freeze({ id: 'handoff.approve', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'handoff.cancel', status: 'not_wired', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'handoff.create', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'handoff.dispatch_local', status: 'implemented', scope: 'session', sideEffect: 'external', requiresProfileTool: 'handoff.dispatch' }),
  Object.freeze({ id: 'handoff.dispatch_web_cli', status: 'not_wired', scope: 'session', sideEffect: 'external', requiresProfileTool: 'handoff.dispatch', ui: Object.freeze({ gate: 'disabled', reason: "Web-CLI dispatch is held until tunnel/auth is wired." }) }),
  Object.freeze({ id: 'handoff.export_blueprint', status: 'not_wired', scope: 'session', sideEffect: 'state' }),
  Object.freeze({ id: 'handoff.fetch', status: 'not_wired', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'handoff.reject', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'handoff.status', status: 'implemented', scope: 'session', sideEffect: 'read_only', toolEnforcement: 'protocol_only' }),
  Object.freeze({ id: 'message.cancel_stream', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Cancel the in-flight assistant response." }),
  Object.freeze({ id: 'message.retry', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Retry the last submission." }),
  Object.freeze({ id: 'message.submit', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Submit a user message to the active agent (ACP/native)." }),
  Object.freeze({ id: 'migration.create_draft', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'migration.dispatch', status: 'not_wired', scope: 'session', sideEffect: 'external', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'migration.dry_run', status: 'not_wired', scope: 'session', sideEffect: 'read_only', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'migration.verify_reversibility', status: 'not_wired', scope: 'session', sideEffect: 'read_only', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'overlay.dismiss', status: 'frontend_owned', scope: 'session', sideEffect: 'none' }),
  Object.freeze({ id: 'overlay.dismiss_all', status: 'frontend_owned', scope: 'session', sideEffect: 'none' }),
  Object.freeze({ id: 'overlay.open', status: 'frontend_owned', scope: 'session', sideEffect: 'none' }),
  Object.freeze({ id: 'palette.invoke_action', status: 'not_wired', scope: 'session', sideEffect: 'state', toolEnforcement: 'payload_action_id', summary: "Generic palette invoke must map to a concrete command before execution.", ui: Object.freeze({ gate: 'disabled', reason: "Palette actions must be classified before they execute." }) }),
  Object.freeze({ id: 'perf.latest_run', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "Slice" }),
  Object.freeze({ id: 'plan.approve', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'plan.edit', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled', reason: "Plan editing requires bridge plan state; not wired." }) }),
  Object.freeze({ id: 'plan.open', status: 'frontend_owned', scope: 'session', sideEffect: 'none' }),
  Object.freeze({ id: 'plan.reject', status: 'not_wired', scope: 'session', sideEffect: 'state', ui: Object.freeze({ gate: 'disabled' }) }),
  Object.freeze({ id: 'project.file.request', status: 'implemented', scope: 'session', sideEffect: 'read_only', requiresProfileTool: 'fs.read', summary: "Return UTF-8 text file contents with binary and size guards." }),
  Object.freeze({ id: 'project.tree.request', status: 'implemented', scope: 'session', sideEffect: 'read_only', requiresProfileTool: 'fs.read', summary: "Return a safe project tree rooted at the active session project." }),
  Object.freeze({ id: 'registry.add', status: 'implemented', scope: 'sessionless', sideEffect: 'state' }),
  Object.freeze({ id: 'registry.reload', status: 'implemented', scope: 'sessionless', sideEffect: 'state' }),
  Object.freeze({ id: 'registry.sync', status: 'implemented', scope: 'sessionless', sideEffect: 'state' }),
  Object.freeze({ id: 'release.deploy', status: 'implemented', scope: 'session', sideEffect: 'external', requiresProfileTool: 'deploy.*', summary: "Start a bridge-managed deployment and emit progress events." }),
  Object.freeze({ id: 'release.generate_notes', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'release_notes.write', summary: "Generate a draft release notes event for the selected target." }),
  Object.freeze({ id: 'release.list_targets', status: 'implemented', scope: 'either', sideEffect: 'read_only', toolEnforcement: 'protocol_only', summary: "Return the current deploy targets for a session or workspace." }),
  Object.freeze({ id: 'release.publish', status: 'implemented', scope: 'session', sideEffect: 'external', requiresProfileTool: 'publish.*', summary: "Publish the selected target through the bridge release plane." }),
  Object.freeze({ id: 'review.hunk.action.request', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.write', runtime: 'agent_forwarded', summary: "Agent-mediated hunk rework/revert request with audit-visible acknowledgement." }),
  Object.freeze({ id: 'review.open_file', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.read', summary: "File-open executor with project-root scope is not implemented.", ui: Object.freeze({ gate: 'disabled', reason: "File-open is not wired to bridge fs scope yet." }) }),
  Object.freeze({ id: 'review.revert_all', status: 'not_wired', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.write', ui: Object.freeze({ gate: 'disabled', reason: "Bulk revert requires bridge fs executor + audit; not wired." }) }),
  Object.freeze({ id: 'review.revert_file', status: 'implemented', scope: 'session', sideEffect: 'state', requiresProfileTool: 'fs.write', runtime: 'agent_forwarded', summary: "Agent-mediated file revert request with audit-visible acknowledgement." }),
  Object.freeze({ id: 'review.toggle_hunk', status: 'frontend_owned', scope: 'session', sideEffect: 'none', summary: "Hunk toggle is local UI state." }),
  Object.freeze({ id: 'runtime.cancel_job', status: 'not_wired', scope: 'session', sideEffect: 'state', summary: "Provider-observed jobs are not bridge-cancellable.", ui: Object.freeze({ gate: 'disabled', reason: "Cancel requires a bridge-owned job; observed provider jobs are read-only." }) }),
  Object.freeze({ id: 'runtime.inspect_job', status: 'not_wired', scope: 'session', sideEffect: 'read_only' }),
  Object.freeze({ id: 'runtime.list_jobs', status: 'not_wired', scope: 'session', sideEffect: 'read_only', summary: "Bridge job registry is read-only via runtime.* events; list endpoint not wired." }),
  Object.freeze({ id: 'session.authenticate', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'acp', summary: "Forwards an ACP authenticate.method request to the active provider." }),
  Object.freeze({ id: 'session.close', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Terminate the active session and release ACP resources." }),
  Object.freeze({ id: 'session.config_option.set', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'acp', summary: "ACP-only — update an active session config option." }),
  Object.freeze({ id: 'session.create', status: 'implemented', scope: 'sessionless', sideEffect: 'state', summary: "Create a new session under a profile/agent/workflow." }),
  Object.freeze({ id: 'session.history.forget', status: 'implemented', scope: 'sessionless', sideEffect: 'state', summary: "Forget a persisted session row." }),
  Object.freeze({ id: 'session.history.list', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "List persisted session history rows." }),
  Object.freeze({ id: 'session.list', status: 'implemented', scope: 'sessionless', sideEffect: 'read_only', summary: "List the bridge's active sessions." }),
  Object.freeze({ id: 'session.mode.set', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'acp', summary: "ACP-only — switch active session mode/model." }),
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
  Object.freeze({ id: 'task.execution.continue', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Continue the active coding task through the agent." }),
  Object.freeze({ id: 'task.plan.request_changes', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Ask the agent to revise the active task plan." }),
  Object.freeze({ id: 'transcript.completed', status: 'protocol_only', scope: 'session', sideEffect: 'none', summary: "Session-internal completion signal; not a client command." }),
  Object.freeze({ id: 'transcript.error', status: 'protocol_only', scope: 'session', sideEffect: 'none', summary: "Session-internal error signal; not a client command." }),
  Object.freeze({ id: 'validation.failure.send_context', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Send a selected validation failure context to the active agent." }),
  Object.freeze({ id: 'validation.run.request', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Record a validation run request and forward validation intent to the active agent." }),
  Object.freeze({ id: 'workbench.invoke', status: 'not_wired', scope: 'session', sideEffect: 'state', toolEnforcement: 'payload_action', summary: "Generic workbench invoke is not implemented as a bridge executor.", ui: Object.freeze({ gate: 'disabled', reason: "Workbench invoke is not wired to a concrete backend command." }) }),
  Object.freeze({ id: 'workbench.select_tab', status: 'frontend_owned', scope: 'session', sideEffect: 'none', summary: "UI-only tab selection; should not cross WebSocket." }),
  Object.freeze({ id: 'workspace.branch.request', status: 'implemented', scope: 'session', sideEffect: 'read_only', toolEnforcement: 'protocol_only', summary: "Return the active git branch for the session project root." }),
  Object.freeze({ id: 'workspace.preview.open', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Record a local preview URL and emit workspace.preview.updated." }),
  Object.freeze({ id: 'workspace.preview.refresh', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Refresh the current preview state." }),
  Object.freeze({ id: 'workspace.preview.run_e2e', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Record an E2E validation request for the current preview." }),
  Object.freeze({ id: 'workspace.preview.send_context', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', runtime: 'agent_forwarded', summary: "Forward explicit preview context to the active agent." }),
  Object.freeze({ id: 'workspace.preview.stop', status: 'implemented', scope: 'session', sideEffect: 'state', toolEnforcement: 'protocol_only', summary: "Mark the preview as stopped." }),
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
