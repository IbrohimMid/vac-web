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
  | 'activity.appended'
  | 'assessment.candidate_received'
  | 'assessment.candidate_rejected'
  | 'assessment.evidence_attached'
  | 'assessment.finding_added'
  | 'assessment.index.rebuild_failed'
  | 'assessment.index.rebuild_progress'
  | 'assessment.index.rebuild_started'
  | 'assessment.index.rebuilt'
  | 'assessment.index.status_failed'
  | 'assessment.progress'
  | 'assessment.sweep.progress'
  | 'assessment.sweep.started'
  | 'assessment.worker_output_rejected'
  | 'changeset.updated'
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
  | 'pairing.exchange'
  | 'pairing.exchange_denied'
  | 'pairing.mint'
  | 'perf.run_completed'
  | 'project.file.error'
  | 'project.file.loaded'
  | 'project.file.unsupported'
  | 'project.tree.error'
  | 'project.tree.unsupported'
  | 'project.tree.updated'
  | 'release.deploy_progress'
  | 'release.notes_draft'
  | 'release.post_deploy_observation'
  | 'release.targets'
  | 'review.changeset_updated'
  | 'review.file_diff_chunk'
  | 'review.file.action.updated'
  | 'review.hunk.action.updated'
  | 'runtime.job_completed'
  | 'runtime.job_started'
  | 'session.closed'
  | 'session.context.updated'
  | 'session.mcp_server_drift'
  | 'session.persistence_degraded'
  | 'session.renamed'
  | 'session.started'
  | 'shell.output'
  | 'shell.started'
  | 'task.approval.required'
  | 'task.approval.resolved'
  | 'task.execution.blocked'
  | 'task.execution.completed'
  | 'task.execution.failed'
  | 'task.execution.started'
  | 'task.plan.proposed'
  | 'task.plan.updated'
  | 'terminal.activity'
  | 'tool.failed'
  | 'tool.observed'
  | 'tool.updated'
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
  Object.freeze({ id: 'activity.appended', status: 'implemented', owner: 'bridge', producer: "translator.activity_appended", consumers: Object.freeze(["capabilities.notifyAttention"]) }),
  Object.freeze({ id: 'assessment.candidate_received', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.candidate_rejected', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.evidence_attached', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.finding_added', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.rebuild_failed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.rebuild_progress', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.rebuild_started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.rebuilt', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.index.status_failed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.progress', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.sweep.progress', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.sweep.started', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'assessment.worker_output_rejected', status: 'implemented', owner: 'bridge', producer: "translator.assessment", consumers: Object.freeze(["capabilities.assessmentIndex"]) }),
  Object.freeze({ id: 'changeset.updated', status: 'legacy_mock_only', owner: 'mock', consumers: Object.freeze(["tools.mock_engine.scenarios"]), replacement: 'review.changeset_updated' }),
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
  Object.freeze({ id: 'pairing.exchange', status: 'implemented', owner: 'bridge', producer: "auth.exchange_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'pairing.exchange_denied', status: 'implemented', owner: 'bridge', producer: "auth.exchange_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'pairing.mint', status: 'implemented', owner: 'bridge', producer: "auth.mint_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'perf.run_completed', status: 'implemented', owner: 'bridge', producer: "perf.handle_latest_run", consumers: Object.freeze(["PerfBadge"]) }),
  Object.freeze({ id: 'project.file.error', status: 'implemented', owner: 'bridge', producer: "translator.project_file_request", consumers: Object.freeze(["domain.project.handlers", "CodePanel"]) }),
  Object.freeze({ id: 'project.file.loaded', status: 'implemented', owner: 'bridge', producer: "translator.project_file_request", consumers: Object.freeze(["domain.project.handlers", "CodePanel"]) }),
  Object.freeze({ id: 'project.file.unsupported', status: 'implemented', owner: 'bridge', producer: "translator.project_file_request", consumers: Object.freeze(["domain.project.handlers", "CodePanel"]) }),
  Object.freeze({ id: 'project.tree.error', status: 'implemented', owner: 'bridge', producer: "translator.project_tree_request", consumers: Object.freeze(["domain.project.handlers", "ProjectExplorer"]) }),
  Object.freeze({ id: 'project.tree.unsupported', status: 'implemented', owner: 'bridge', producer: "translator.project_tree_request", consumers: Object.freeze(["domain.project.handlers", "ProjectExplorer"]) }),
  Object.freeze({ id: 'project.tree.updated', status: 'implemented', owner: 'bridge', producer: "translator.project_tree_request", consumers: Object.freeze(["domain.project.handlers", "ProjectExplorer"]) }),
  Object.freeze({ id: 'release.deploy_progress', status: 'implemented', owner: 'bridge', producer: "release.handlers", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.notes_draft', status: 'implemented', owner: 'bridge', producer: "release.handlers", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.post_deploy_observation', status: 'implemented', owner: 'bridge', producer: "release.handlers", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.targets', status: 'implemented', owner: 'bridge', producer: "release.handlers", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'review.changeset_updated', status: 'implemented', owner: 'bridge', producer: "translator.review_changeset_updated", consumers: Object.freeze(["domain.review.handlers"]) }),
  Object.freeze({ id: 'review.file_diff_chunk', status: 'implemented', owner: 'bridge', producer: "translator.review_file_diff_chunk", consumers: Object.freeze(["domain.review.handlers"]) }),
  Object.freeze({ id: 'review.file.action.updated', status: 'implemented', owner: 'bridge', producer: "translator.review_action_request", consumers: Object.freeze(["ReviewQueue"]) }),
  Object.freeze({ id: 'review.hunk.action.updated', status: 'implemented', owner: 'bridge', producer: "translator.review_action_request", consumers: Object.freeze(["ReviewQueue"]) }),
  Object.freeze({ id: 'runtime.job_completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.runtimeJobs"]) }),
  Object.freeze({ id: 'runtime.job_started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.runtimeJobs"]) }),
  Object.freeze({ id: 'session.closed', status: 'implemented', owner: 'bridge', producer: "translator.session_closed", consumers: Object.freeze(["domain.sessions.handlers", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.context.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.prompt_response_usage", consumers: Object.freeze(["domain.sessions.handlers", "Topbar.ModelContextChip"]) }),
  Object.freeze({ id: 'session.mcp_server_drift', status: 'implemented', owner: 'bridge', producer: "translator.session_resume", consumers: Object.freeze(["capabilities.registryEvents", "domain.sessions.history", "ResumeStatus", "PersistentSessions"]) }),
  Object.freeze({ id: 'session.persistence_degraded', status: 'implemented', owner: 'bridge', producer: "session.persistence.sink", consumers: Object.freeze(["capabilities.persistenceEvents", "domain.sessions.history", "NotifyLane"]) }),
  Object.freeze({ id: 'session.renamed', status: 'implemented', owner: 'bridge', producer: "translator.session_renamed", consumers: Object.freeze(["SessionPicker", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.started', status: 'implemented', owner: 'bridge', producer: "translator.session_started", consumers: Object.freeze(["domain.sessions.handlers", "SessionPicker", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'shell.output', status: 'not_wired', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'shell.started', status: 'not_wired', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'task.approval.required', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.approval.resolved', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.execution.blocked', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.execution.completed', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.execution.failed', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.execution.started', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.plan.proposed', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'task.plan.updated', status: 'implemented', owner: 'bridge', producer: "translator.task_lifecycle", consumers: Object.freeze(["domain.tasks.handlers", "TaskBoard"]) }),
  Object.freeze({ id: 'terminal.activity', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'tool.failed', status: 'implemented', owner: 'bridge', producer: "session.handle.tool_activity", consumers: Object.freeze(["domain.toolActivity.handlers", "stores.toolActivity", "workflows.adapters"]) }),
  Object.freeze({ id: 'tool.observed', status: 'implemented', owner: 'bridge', producer: "session.handle.tool_activity", consumers: Object.freeze(["domain.toolActivity.handlers", "stores.toolActivity", "workflows.adapters"]) }),
  Object.freeze({ id: 'tool.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.tool_activity", consumers: Object.freeze(["domain.toolActivity.handlers", "stores.toolActivity", "workflows.adapters"]) }),
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
