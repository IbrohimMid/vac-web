// AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: config/control-plane/event-catalog.yaml
//
// Run `node scripts/codegen-event-catalog.mjs` to regenerate.

export type EventStatus = 'implemented' | 'not_wired' | 'planned' | 'legacy_mock_only' | 'deprecated';
export type EventOwner = 'bridge' | 'web' | 'mock' | 'protocol' | 'tools';

export interface EventEntry {
  readonly id: EventId;
  readonly status: EventStatus;
  readonly owner?: EventOwner;
  readonly producer?: string;
  readonly consumers?: ReadonlyArray<string>;
  readonly replacement?: EventId;
  readonly internal?: boolean;
}

// Discriminated string-literal union of every classified event id.
export type EventId =
  | 'acp.debug_message'
  | 'activity.appended'
  | 'approval.pending'
  | 'approval.resolved'
  | 'assessment.candidate_received'
  | 'assessment.candidate_rejected'
  | 'assessment.completed'
  | 'assessment.evidence_attached'
  | 'assessment.failed'
  | 'assessment.finding_added'
  | 'assessment.index.rebuild_failed'
  | 'assessment.index.rebuild_progress'
  | 'assessment.index.rebuild_started'
  | 'assessment.index.rebuilt'
  | 'assessment.index.status_failed'
  | 'assessment.progress'
  | 'assessment.started'
  | 'assessment.sweep.progress'
  | 'assessment.sweep.started'
  | 'assessment.worker_output_rejected'
  | 'bridge.mutation.applied'
  | 'bridge.mutation.failed'
  | 'bridge.mutation.requested'
  | 'bridge.mutation.updated'
  | 'changeset.updated'
  | 'config.reload.started'
  | 'config.reload_failed'
  | 'config.reloaded'
  | 'config.validated'
  | 'extensions.approvals_list_response'
  | 'extensions.list_response'
  | 'extensions.promotion_approved'
  | 'extensions.promotion_denied'
  | 'extensions.promotion_requested'
  | 'extensions.update_trust.allowed'
  | 'extensions.update_trust.denied'
  | 'extensions.update_trust.save_failed'
  | 'extensions.updated'
  | 'gate.changed'
  | 'handoff.completed'
  | 'handoff.execution_progress'
  | 'notify.event'
  | 'pairing.exchange'
  | 'pairing.exchange_denied'
  | 'pairing.mint'
  | 'perf.run_completed'
  | 'plan.updated'
  | 'project.file.error'
  | 'project.file.loaded'
  | 'project.file.unsupported'
  | 'project.tree.error'
  | 'project.tree.unsupported'
  | 'project.tree.updated'
  | 'registry.added'
  | 'registry.reloaded'
  | 'registry.synced'
  | 'release.audit'
  | 'release.deploy_progress'
  | 'release.notes_draft'
  | 'release.post_deploy_observation'
  | 'release.targets'
  | 'review.changeset_updated'
  | 'review.file.action.updated'
  | 'review.file_diff_chunk'
  | 'review.hunk.action.updated'
  | 'runtime.job_completed'
  | 'runtime.job_log'
  | 'runtime.job_started'
  | 'session.auth_failed'
  | 'session.auth_requested'
  | 'session.auth_updated'
  | 'session.available_commands.updated'
  | 'session.closed'
  | 'session.config_options.updated'
  | 'session.context.updated'
  | 'session.history.forgotten'
  | 'session.history.listed'
  | 'session.list_response'
  | 'session.mcp_server_drift'
  | 'session.mode.updated'
  | 'session.persistence_degraded'
  | 'session.ready'
  | 'session.renamed'
  | 'session.replay.progress'
  | 'session.resume.failed'
  | 'session.resume.initializing'
  | 'session.resume.started'
  | 'session.resume.warning'
  | 'session.resumed'
  | 'session.started'
  | 'shell.output'
  | 'shell.started'
  | 'system.capabilities'
  | 'system_pulse.updated'
  | 'task.approval.required'
  | 'task.approval.resolved'
  | 'task.execution.blocked'
  | 'task.execution.completed'
  | 'task.execution.failed'
  | 'task.execution.started'
  | 'task.plan.proposed'
  | 'task.plan.updated'
  | 'terminal.activity'
  | 'terminal.lifecycle'
  | 'tool.diff.updated'
  | 'tool.failed'
  | 'tool.observed'
  | 'tool.terminal.updated'
  | 'tool.updated'
  | 'transcript.completed'
  | 'transcript.delta'
  | 'transcript.error'
  | 'transcript.thought_delta'
  | 'vac.session_resumed_native'
  | 'validation.run.updated'
  | 'workflow.artifact.created'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.input.message_submit'
  | 'workflow.started'
  | 'workflow.step.completed'
  | 'workflow.step.failed'
  | 'workflow.step.started'
  | 'workflow.step.updated'
  | 'workspace.branch.updated'
  | 'workspace.preview.console_error'
  | 'workspace.preview.error'
  | 'workspace.preview.network_failure'
  | 'workspace.preview.unsupported'
  | 'workspace.preview.updated'
  | 'ws.auth_failed'
  | 'ws.connected'
  | 'ws.disconnected';

export const EVENT_CATALOG: ReadonlyArray<EventEntry> = Object.freeze([
  Object.freeze({ id: 'acp.debug_message', status: 'implemented', owner: 'bridge', producer: "agent_runtime.acp.debug", consumers: Object.freeze(["domain.agentSession.handlers"]) }),
  Object.freeze({ id: 'activity.appended', status: 'implemented', owner: 'bridge', producer: "translator.activity_appended", consumers: Object.freeze(["capabilities.notifyAttention"]) }),
  Object.freeze({ id: 'approval.pending', status: 'implemented', owner: 'bridge', producer: "session.handle.approvals", consumers: Object.freeze(["domain.approvals.handlers", "WorkflowRail"]) }),
  Object.freeze({ id: 'approval.resolved', status: 'implemented', owner: 'bridge', producer: "session.handle.approvals", consumers: Object.freeze(["domain.approvals.handlers", "WorkflowRail"]) }),
  Object.freeze({ id: 'assessment.candidate_received', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.candidate_rejected', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.completed', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.evidence_attached', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.failed', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.finding_added', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.rebuild_failed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.rebuild_progress', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.rebuild_started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.rebuilt', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.status_failed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.progress', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.started', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.sweep.progress', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.sweep.started', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.worker_output_rejected', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'bridge.mutation.applied', status: 'implemented', owner: 'bridge', producer: "translate_mutation_approve", consumers: Object.freeze(["domain.bridge.handlers", "MutationInbox"]) }),
  Object.freeze({ id: 'bridge.mutation.failed', status: 'implemented', owner: 'bridge', producer: "translate_mutation_approve", consumers: Object.freeze(["domain.bridge.handlers", "MutationInbox"]) }),
  Object.freeze({ id: 'bridge.mutation.requested', status: 'implemented', owner: 'bridge', producer: "translate_mutation_approve", consumers: Object.freeze(["domain.bridge.handlers", "MutationInbox"]) }),
  Object.freeze({ id: 'bridge.mutation.updated', status: 'implemented', owner: 'bridge', producer: "translate_mutation_approve", consumers: Object.freeze(["domain.bridge.handlers", "MutationInbox"]) }),
  Object.freeze({ id: 'changeset.updated', status: 'legacy_mock_only', owner: 'mock', consumers: Object.freeze(["tools.mock_engine.scenarios"]), replacement: 'review.changeset_updated' }),
  Object.freeze({ id: 'config.reload.started', status: 'implemented', owner: 'bridge', producer: "translator.config_reload", consumers: Object.freeze(["capabilities.configLifecycle", "ConfigPanel"]) }),
  Object.freeze({ id: 'config.reload_failed', status: 'implemented', owner: 'bridge', producer: "translator.config_reload", consumers: Object.freeze(["capabilities.configLifecycle", "ConfigPanel", "NotifyLane"]) }),
  Object.freeze({ id: 'config.reloaded', status: 'implemented', owner: 'bridge', producer: "translator.config_reload", consumers: Object.freeze(["capabilities.configLifecycle", "ConfigPanel"]) }),
  Object.freeze({ id: 'config.validated', status: 'implemented', owner: 'bridge', producer: "translator.config_validate", consumers: Object.freeze(["capabilities.configLifecycle", "ConfigPanel"]) }),
  Object.freeze({ id: 'extensions.approvals_list_response', status: 'implemented', owner: 'bridge', producer: "extensions.handlers.handle_list_approvals", consumers: Object.freeze(["ExtensionsList"]) }),
  Object.freeze({ id: 'extensions.list_response', status: 'implemented', owner: 'bridge', producer: "translator.extensions_list", consumers: Object.freeze(["domain.extensions.handlers", "ExtensionsList"]) }),
  Object.freeze({ id: 'extensions.promotion_approved', status: 'implemented', owner: 'bridge', producer: "extensions.handlers.handle_approve_promotion", consumers: Object.freeze(["audit", "ExtensionsList"]) }),
  Object.freeze({ id: 'extensions.promotion_denied', status: 'implemented', owner: 'bridge', producer: "extensions.handlers.handle_approve_promotion", consumers: Object.freeze(["audit", "ExtensionsList"]) }),
  Object.freeze({ id: 'extensions.promotion_requested', status: 'implemented', owner: 'bridge', producer: "extensions.handlers.handle_request_promotion", consumers: Object.freeze(["audit", "ExtensionsList"]) }),
  Object.freeze({ id: 'extensions.update_trust.allowed', status: 'implemented', owner: 'bridge', producer: "extensions.handlers.handle_update_trust", consumers: Object.freeze(["audit"]) }),
  Object.freeze({ id: 'extensions.update_trust.denied', status: 'implemented', owner: 'bridge', producer: "extensions.handlers.handle_update_trust", consumers: Object.freeze(["audit"]) }),
  Object.freeze({ id: 'extensions.update_trust.save_failed', status: 'implemented', owner: 'bridge', producer: "extensions.handlers.handle_update_trust", consumers: Object.freeze(["audit"]) }),
  Object.freeze({ id: 'extensions.updated', status: 'implemented', owner: 'bridge', producer: "translator.extensions_update_trust", consumers: Object.freeze(["domain.extensions.handlers", "ExtensionsList"]) }),
  Object.freeze({ id: 'gate.changed', status: 'implemented', owner: 'bridge', producer: "gate.handlers", consumers: Object.freeze(["domain.gates.handlers", "GateDetail", "ReleaseTab"]) }),
  Object.freeze({ id: 'handoff.completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.handoffErrors"]) }),
  Object.freeze({ id: 'handoff.execution_progress', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.handoffErrors"]) }),
  Object.freeze({ id: 'notify.event', status: 'implemented', owner: 'bridge', producer: "notify", consumers: Object.freeze(["domain.notify.handlers", "NotifyLane"]) }),
  Object.freeze({ id: 'pairing.exchange', status: 'implemented', owner: 'bridge', producer: "auth.exchange_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'pairing.exchange_denied', status: 'implemented', owner: 'bridge', producer: "auth.exchange_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'pairing.mint', status: 'implemented', owner: 'bridge', producer: "auth.mint_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'perf.run_completed', status: 'implemented', owner: 'bridge', producer: "perf.handle_latest_run", consumers: Object.freeze(["PerfBadge"]) }),
  Object.freeze({ id: 'plan.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.plan", consumers: Object.freeze(["domain.agentSession.handlers"]) }),
  Object.freeze({ id: 'project.file.error', status: 'implemented', owner: 'bridge', producer: "translator.project_file_request", consumers: Object.freeze(["domain.project.handlers", "CodePanel"]) }),
  Object.freeze({ id: 'project.file.loaded', status: 'implemented', owner: 'bridge', producer: "translator.project_file_request", consumers: Object.freeze(["domain.project.handlers", "CodePanel"]) }),
  Object.freeze({ id: 'project.file.unsupported', status: 'implemented', owner: 'bridge', producer: "translator.project_file_request", consumers: Object.freeze(["domain.project.handlers", "CodePanel"]) }),
  Object.freeze({ id: 'project.tree.error', status: 'implemented', owner: 'bridge', producer: "translator.project_tree_request", consumers: Object.freeze(["domain.project.handlers", "ProjectExplorer"]) }),
  Object.freeze({ id: 'project.tree.unsupported', status: 'implemented', owner: 'bridge', producer: "translator.project_tree_request", consumers: Object.freeze(["domain.project.handlers", "ProjectExplorer"]) }),
  Object.freeze({ id: 'project.tree.updated', status: 'implemented', owner: 'bridge', producer: "translator.project_tree_request", consumers: Object.freeze(["domain.project.handlers", "ProjectExplorer"]) }),
  Object.freeze({ id: 'registry.added', status: 'implemented', owner: 'bridge', producer: "translator.registry_add", consumers: Object.freeze(["capabilities.registryEvents", "RegistryPanel"]) }),
  Object.freeze({ id: 'registry.reloaded', status: 'implemented', owner: 'bridge', producer: "translator.registry_reload", consumers: Object.freeze(["capabilities.registryEvents", "RegistryPanel"]) }),
  Object.freeze({ id: 'registry.synced', status: 'implemented', owner: 'bridge', producer: "translator.registry_sync", consumers: Object.freeze(["capabilities.registryEvents", "RegistryPanel"]) }),
  Object.freeze({ id: 'release.audit', status: 'implemented', owner: 'bridge', producer: "release.handle_deploy_publish", consumers: Object.freeze(["audit", "domain.release.audit"]) }),
  Object.freeze({ id: 'release.deploy_progress', status: 'implemented', owner: 'bridge', producer: "release.handlers", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.notes_draft', status: 'implemented', owner: 'bridge', producer: "release.handlers", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.post_deploy_observation', status: 'implemented', owner: 'bridge', producer: "release.handlers", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.targets', status: 'implemented', owner: 'bridge', producer: "release.handlers", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'review.changeset_updated', status: 'implemented', owner: 'bridge', producer: "translator.review_changeset_updated", consumers: Object.freeze(["domain.review.handlers"]) }),
  Object.freeze({ id: 'review.file.action.updated', status: 'implemented', owner: 'bridge', producer: "translator.review_action_request", consumers: Object.freeze(["ReviewQueue"]) }),
  Object.freeze({ id: 'review.file_diff_chunk', status: 'implemented', owner: 'bridge', producer: "translator.review_file_diff_chunk", consumers: Object.freeze(["domain.review.handlers"]) }),
  Object.freeze({ id: 'review.hunk.action.updated', status: 'implemented', owner: 'bridge', producer: "translator.review_action_request", consumers: Object.freeze(["ReviewQueue"]) }),
  Object.freeze({ id: 'runtime.job_completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.runtimeJobs"]) }),
  Object.freeze({ id: 'runtime.job_log', status: 'implemented', owner: 'bridge', producer: "session.handle.runtime_jobs", consumers: Object.freeze(["domain.runtime.handlers", "domain.toolActivity.handlers"]) }),
  Object.freeze({ id: 'runtime.job_started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.runtimeJobs"]) }),
  Object.freeze({ id: 'session.auth_failed', status: 'implemented', owner: 'bridge', producer: "translator.session_auth", consumers: Object.freeze(["capabilities.sessionLifecycle", "NotifyLane"]) }),
  Object.freeze({ id: 'session.auth_requested', status: 'implemented', owner: 'bridge', producer: "translator.session_auth", consumers: Object.freeze(["capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.auth_updated', status: 'implemented', owner: 'bridge', producer: "translator.session_auth", consumers: Object.freeze(["capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.available_commands.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.available_commands", consumers: Object.freeze(["domain.sessions.handlers", "CommandPalette"]) }),
  Object.freeze({ id: 'session.closed', status: 'implemented', owner: 'bridge', producer: "translator.session_closed", consumers: Object.freeze(["domain.sessions.handlers", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.config_options.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.config_options", consumers: Object.freeze(["domain.sessions.handlers", "ConfigPanel"]) }),
  Object.freeze({ id: 'session.context.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.prompt_response_usage", consumers: Object.freeze(["domain.sessions.handlers", "Topbar.ModelContextChip"]) }),
  Object.freeze({ id: 'session.history.forgotten', status: 'implemented', owner: 'bridge', producer: "translator.session_history_forget", consumers: Object.freeze(["domain.sessions.history", "SessionPicker"]) }),
  Object.freeze({ id: 'session.history.listed', status: 'implemented', owner: 'bridge', producer: "translator.session_history_list", consumers: Object.freeze(["domain.sessions.history", "SessionPicker"]) }),
  Object.freeze({ id: 'session.list_response', status: 'implemented', owner: 'bridge', producer: "translator.session_list", consumers: Object.freeze(["SessionPicker", "domain.sessions.handlers"]) }),
  Object.freeze({ id: 'session.mcp_server_drift', status: 'implemented', owner: 'bridge', producer: "translator.session_resume", consumers: Object.freeze(["capabilities.registryEvents", "domain.sessions.history", "ResumeStatus", "PersistentSessions"]) }),
  Object.freeze({ id: 'session.mode.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.mode", consumers: Object.freeze(["domain.sessions.handlers"]) }),
  Object.freeze({ id: 'session.persistence_degraded', status: 'implemented', owner: 'bridge', producer: "session.persistence.sink", consumers: Object.freeze(["capabilities.persistenceEvents", "domain.sessions.history", "NotifyLane"]) }),
  Object.freeze({ id: 'session.ready', status: 'implemented', owner: 'bridge', producer: "translator.session_ready", consumers: Object.freeze(["domain.sessions.handlers", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.renamed', status: 'implemented', owner: 'bridge', producer: "translator.session_renamed", consumers: Object.freeze(["SessionPicker", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.replay.progress', status: 'implemented', owner: 'bridge', producer: "translator.session_replay", consumers: Object.freeze(["capabilities.persistenceEvents", "ResumeStatus"]) }),
  Object.freeze({ id: 'session.resume.failed', status: 'implemented', owner: 'bridge', producer: "translator.session_resume", consumers: Object.freeze(["capabilities.sessionLifecycle", "NotifyLane"]) }),
  Object.freeze({ id: 'session.resume.initializing', status: 'implemented', owner: 'bridge', producer: "session.handle.resume_native", consumers: Object.freeze(["capabilities.sessionLifecycle", "ResumeStatus"]) }),
  Object.freeze({ id: 'session.resume.started', status: 'implemented', owner: 'bridge', producer: "translator.session_resume", consumers: Object.freeze(["capabilities.sessionLifecycle", "ResumeStatus"]) }),
  Object.freeze({ id: 'session.resume.warning', status: 'implemented', owner: 'bridge', producer: "translator.session_resume", consumers: Object.freeze(["capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.resumed', status: 'implemented', owner: 'bridge', producer: "translator.session_resume", consumers: Object.freeze(["capabilities.sessionLifecycle", "ResumeStatus", "SessionPicker"]) }),
  Object.freeze({ id: 'session.started', status: 'implemented', owner: 'bridge', producer: "translator.session_started", consumers: Object.freeze(["domain.sessions.handlers", "SessionPicker", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'shell.output', status: 'not_wired', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'shell.started', status: 'not_wired', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'system.capabilities', status: 'implemented', owner: 'bridge', producer: "translator.session_ready", consumers: Object.freeze(["domain.capabilities.handlers", "actions.registry"]) }),
  Object.freeze({ id: 'system_pulse.updated', status: 'implemented', owner: 'bridge', producer: "notify", consumers: Object.freeze(["capabilities.notifyAttention"]) }),
  Object.freeze({ id: 'task.approval.required', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.approval.resolved', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.execution.blocked', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.execution.completed', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.execution.failed', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.execution.started', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.plan.proposed', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.plan.updated', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'terminal.activity', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'terminal.lifecycle', status: 'implemented', owner: 'bridge', producer: "session.handle.terminal", consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'tool.diff.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.tool_activity", consumers: Object.freeze(["domain.toolActivity.handlers"]) }),
  Object.freeze({ id: 'tool.failed', status: 'implemented', owner: 'bridge', producer: "session.handle.tool_activity", consumers: Object.freeze(["domain.toolActivity.handlers", "stores.toolActivity", "workflows.adapters"]) }),
  Object.freeze({ id: 'tool.observed', status: 'implemented', owner: 'bridge', producer: "session.handle.tool_activity", consumers: Object.freeze(["domain.toolActivity.handlers", "stores.toolActivity", "workflows.adapters"]) }),
  Object.freeze({ id: 'tool.terminal.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.tool_activity", consumers: Object.freeze(["domain.toolActivity.handlers"]) }),
  Object.freeze({ id: 'tool.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.tool_activity", consumers: Object.freeze(["domain.toolActivity.handlers", "stores.toolActivity", "workflows.adapters"]) }),
  Object.freeze({ id: 'transcript.completed', status: 'implemented', owner: 'bridge', producer: "session.handle.transcript", consumers: Object.freeze(["domain.transcript.handlers"]) }),
  Object.freeze({ id: 'transcript.delta', status: 'implemented', owner: 'bridge', producer: "session.handle.transcript", consumers: Object.freeze(["domain.transcript.handlers", "domain.agentSession.handlers"]) }),
  Object.freeze({ id: 'transcript.error', status: 'implemented', owner: 'bridge', producer: "session.handle.transcript", consumers: Object.freeze(["domain.transcript.handlers"]) }),
  Object.freeze({ id: 'transcript.thought_delta', status: 'implemented', owner: 'bridge', producer: "session.handle.transcript", consumers: Object.freeze(["domain.transcript.handlers"]) }),
  Object.freeze({ id: 'vac.session_resumed_native', status: 'implemented', owner: 'bridge', producer: "session.handle.resume_native", consumers: Object.freeze(["capabilities.sessionLifecycle", "ResumeStatus"]) }),
  Object.freeze({ id: 'validation.run.updated', status: 'implemented', owner: 'bridge', producer: "translator.validation_run_request", consumers: Object.freeze(["domain.validation.handlers", "ValidationPanel", "domain.tasks.handlers"]) }),
  Object.freeze({ id: 'workflow.artifact.created', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.failed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.input.message_submit', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]), internal: true }),
  Object.freeze({ id: 'workflow.started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.step.completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.step.failed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.step.started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.step.updated', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workspace.branch.updated', status: 'implemented', owner: 'bridge', producer: "translator.workspace_branch_request", consumers: Object.freeze(["WorkspaceTopbar"]) }),
  Object.freeze({ id: 'workspace.preview.console_error', status: 'implemented', owner: 'bridge', producer: "translator.workspace_preview", consumers: Object.freeze(["domain.preview.handlers", "PreviewPanel"]) }),
  Object.freeze({ id: 'workspace.preview.error', status: 'implemented', owner: 'bridge', producer: "translator.workspace_preview", consumers: Object.freeze(["domain.preview.handlers", "PreviewPanel"]) }),
  Object.freeze({ id: 'workspace.preview.network_failure', status: 'implemented', owner: 'bridge', producer: "translator.workspace_preview", consumers: Object.freeze(["domain.preview.handlers", "PreviewPanel"]) }),
  Object.freeze({ id: 'workspace.preview.unsupported', status: 'implemented', owner: 'bridge', producer: "translator.workspace_preview", consumers: Object.freeze(["domain.preview.handlers", "PreviewPanel"]) }),
  Object.freeze({ id: 'workspace.preview.updated', status: 'implemented', owner: 'bridge', producer: "translator.workspace_preview", consumers: Object.freeze(["domain.preview.handlers", "PreviewPanel"]) }),
  Object.freeze({ id: 'ws.auth_failed', status: 'implemented', owner: 'bridge', producer: "ws.handler.run_socket", consumers: Object.freeze(["audit.ws_shard"]) }),
  Object.freeze({ id: 'ws.connected', status: 'implemented', owner: 'bridge', producer: "ws.handler.run_socket", consumers: Object.freeze(["audit.ws_shard"]) }),
  Object.freeze({ id: 'ws.disconnected', status: 'implemented', owner: 'bridge', producer: "ws.handler.run_socket", consumers: Object.freeze(["audit.ws_shard"]) }),
]);

export const EVENT_BY_ID: ReadonlyMap<EventId, EventEntry> = new Map(EVENT_CATALOG.map((e) => [e.id, e]));

export function eventStatus(id: string): EventStatus | undefined {
  return EVENT_BY_ID.get(id as EventId)?.status;
}

export function isKnownEvent(id: string): id is EventId {
  return EVENT_BY_ID.has(id as EventId);
}

export function isLegacyMockOnly(id: string): boolean {
  return eventStatus(id) === 'legacy_mock_only';
}

export function replacementFor(id: string): EventId | undefined {
  return EVENT_BY_ID.get(id as EventId)?.replacement;
}
