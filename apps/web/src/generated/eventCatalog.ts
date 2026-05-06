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
  | 'extensions.list_response'
  | 'extensions.updated'
  | 'handoff.completed'
  | 'handoff.execution_progress'
  | 'pairing.exchange'
  | 'pairing.exchange_denied'
  | 'pairing.mint'
  | 'release.deploy_progress'
  | 'release.notes_draft'
  | 'release.post_deploy_observation'
  | 'release.targets'
  | 'review.changeset_updated'
  | 'review.file_diff_chunk'
  | 'runtime.job_completed'
  | 'runtime.job_started'
  | 'session.closed'
  | 'session.context.updated'
  | 'session.renamed'
  | 'session.started'
  | 'shell.output'
  | 'shell.started'
  | 'terminal.activity'
  | 'workflow.artifact.created'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.input.message_submit'
  | 'workflow.started'
  | 'workflow.step.completed'
  | 'workflow.step.failed'
  | 'workflow.step.started'
  | 'workflow.step.updated'
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
  Object.freeze({ id: 'extensions.list_response', status: 'implemented', owner: 'bridge', producer: "translator.extensions_list", consumers: Object.freeze(["domain.extensions.handlers", "ExtensionsList"]) }),
  Object.freeze({ id: 'extensions.updated', status: 'implemented', owner: 'bridge', producer: "translator.extensions_update_trust", consumers: Object.freeze(["domain.extensions.handlers", "ExtensionsList"]) }),
  Object.freeze({ id: 'handoff.completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.handoffErrors"]) }),
  Object.freeze({ id: 'handoff.execution_progress', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.handoffErrors"]) }),
  Object.freeze({ id: 'pairing.exchange', status: 'implemented', owner: 'bridge', producer: "auth.exchange_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'pairing.exchange_denied', status: 'implemented', owner: 'bridge', producer: "auth.exchange_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'pairing.mint', status: 'implemented', owner: 'bridge', producer: "auth.mint_pair", consumers: Object.freeze(["audit.pairing_shard"]) }),
  Object.freeze({ id: 'release.deploy_progress', status: 'planned', owner: 'bridge', producer: "mock-engine.release-deploy", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.notes_draft', status: 'implemented', owner: 'bridge', producer: "translator.release_notes_draft", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.post_deploy_observation', status: 'planned', owner: 'bridge', producer: "mock-engine.release-deploy", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'release.targets', status: 'implemented', owner: 'bridge', producer: "translator.release_targets", consumers: Object.freeze(["domain.release.handlers", "ReleaseTab"]) }),
  Object.freeze({ id: 'review.changeset_updated', status: 'implemented', owner: 'bridge', producer: "translator.review_changeset_updated", consumers: Object.freeze(["domain.review.handlers"]) }),
  Object.freeze({ id: 'review.file_diff_chunk', status: 'implemented', owner: 'bridge', producer: "translator.review_file_diff_chunk", consumers: Object.freeze(["domain.review.handlers"]) }),
  Object.freeze({ id: 'runtime.job_completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.runtimeJobs"]) }),
  Object.freeze({ id: 'runtime.job_started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.runtimeJobs"]) }),
  Object.freeze({ id: 'session.closed', status: 'implemented', owner: 'bridge', producer: "translator.session_closed", consumers: Object.freeze(["domain.sessions.handlers", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.context.updated', status: 'implemented', owner: 'bridge', producer: "session.handle.prompt_response_usage", consumers: Object.freeze(["domain.sessions.handlers", "Topbar.ModelContextChip"]) }),
  Object.freeze({ id: 'session.renamed', status: 'implemented', owner: 'bridge', producer: "translator.session_renamed", consumers: Object.freeze(["SessionPicker", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'session.started', status: 'implemented', owner: 'bridge', producer: "translator.session_started", consumers: Object.freeze(["domain.sessions.handlers", "SessionPicker", "capabilities.sessionLifecycle"]) }),
  Object.freeze({ id: 'shell.output', status: 'not_wired', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'shell.started', status: 'not_wired', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'terminal.activity', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.shellTerminal"]) }),
  Object.freeze({ id: 'workflow.artifact.created', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.failed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.input.message_submit', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]), internal: true }),
  Object.freeze({ id: 'workflow.started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.step.completed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.step.failed', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.step.started', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
  Object.freeze({ id: 'workflow.step.updated', status: 'implemented', owner: 'bridge', consumers: Object.freeze(["capabilities.workflowEvents"]) }),
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
