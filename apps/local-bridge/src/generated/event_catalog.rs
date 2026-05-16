// AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: config/control-plane/event-catalog.yaml
//
// Run `node scripts/codegen-event-catalog.mjs` to regenerate.

#![allow(dead_code)]

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum EventStatus {
    Implemented,
    NotWired,
    Planned,
    LegacyMockOnly,
    Deprecated,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct EventEntry {
    pub id: &'static str,
    pub status: EventStatus,
}

#[rustfmt::skip]
pub const EVENT_CATALOG: [EventEntry; 90] = [
    EventEntry { id: "activity.appended", status: EventStatus::Implemented },
    EventEntry { id: "assessment.candidate_received", status: EventStatus::Implemented },
    EventEntry { id: "assessment.candidate_rejected", status: EventStatus::Implemented },
    EventEntry { id: "assessment.evidence_attached", status: EventStatus::Implemented },
    EventEntry { id: "assessment.finding_added", status: EventStatus::Implemented },
    EventEntry { id: "assessment.index.rebuild_failed", status: EventStatus::Implemented },
    EventEntry { id: "assessment.index.rebuild_progress", status: EventStatus::Implemented },
    EventEntry { id: "assessment.index.rebuild_started", status: EventStatus::Implemented },
    EventEntry { id: "assessment.index.rebuilt", status: EventStatus::Implemented },
    EventEntry { id: "assessment.index.status_failed", status: EventStatus::Implemented },
    EventEntry { id: "assessment.progress", status: EventStatus::Implemented },
    EventEntry { id: "assessment.sweep.progress", status: EventStatus::Implemented },
    EventEntry { id: "assessment.sweep.started", status: EventStatus::Implemented },
    EventEntry { id: "assessment.worker_output_rejected", status: EventStatus::Implemented },
    EventEntry { id: "bridge.mutation.applied", status: EventStatus::Implemented },
    EventEntry { id: "bridge.mutation.failed", status: EventStatus::Implemented },
    EventEntry { id: "bridge.mutation.requested", status: EventStatus::Implemented },
    EventEntry { id: "bridge.mutation.updated", status: EventStatus::Implemented },
    EventEntry { id: "changeset.updated", status: EventStatus::LegacyMockOnly },
    EventEntry { id: "extensions.approvals_list_response", status: EventStatus::Implemented },
    EventEntry { id: "extensions.list_response", status: EventStatus::Implemented },
    EventEntry { id: "extensions.promotion_approved", status: EventStatus::Implemented },
    EventEntry { id: "extensions.promotion_denied", status: EventStatus::Implemented },
    EventEntry { id: "extensions.promotion_requested", status: EventStatus::Implemented },
    EventEntry { id: "extensions.update_trust.allowed", status: EventStatus::Implemented },
    EventEntry { id: "extensions.update_trust.denied", status: EventStatus::Implemented },
    EventEntry { id: "extensions.update_trust.save_failed", status: EventStatus::Implemented },
    EventEntry { id: "extensions.updated", status: EventStatus::Implemented },
    EventEntry { id: "gate.changed", status: EventStatus::Implemented },
    EventEntry { id: "handoff.completed", status: EventStatus::Implemented },
    EventEntry { id: "handoff.execution_progress", status: EventStatus::Implemented },
    EventEntry { id: "pairing.exchange", status: EventStatus::Implemented },
    EventEntry { id: "pairing.exchange_denied", status: EventStatus::Implemented },
    EventEntry { id: "pairing.mint", status: EventStatus::Implemented },
    EventEntry { id: "perf.run_completed", status: EventStatus::Implemented },
    EventEntry { id: "project.file.error", status: EventStatus::Implemented },
    EventEntry { id: "project.file.loaded", status: EventStatus::Implemented },
    EventEntry { id: "project.file.unsupported", status: EventStatus::Implemented },
    EventEntry { id: "project.tree.error", status: EventStatus::Implemented },
    EventEntry { id: "project.tree.unsupported", status: EventStatus::Implemented },
    EventEntry { id: "project.tree.updated", status: EventStatus::Implemented },
    EventEntry { id: "release.deploy_progress", status: EventStatus::Implemented },
    EventEntry { id: "release.notes_draft", status: EventStatus::Implemented },
    EventEntry { id: "release.post_deploy_observation", status: EventStatus::Implemented },
    EventEntry { id: "release.targets", status: EventStatus::Implemented },
    EventEntry { id: "review.changeset_updated", status: EventStatus::Implemented },
    EventEntry { id: "review.file.action.updated", status: EventStatus::Implemented },
    EventEntry { id: "review.file_diff_chunk", status: EventStatus::Implemented },
    EventEntry { id: "review.hunk.action.updated", status: EventStatus::Implemented },
    EventEntry { id: "runtime.job_completed", status: EventStatus::Implemented },
    EventEntry { id: "runtime.job_started", status: EventStatus::Implemented },
    EventEntry { id: "session.closed", status: EventStatus::Implemented },
    EventEntry { id: "session.context.updated", status: EventStatus::Implemented },
    EventEntry { id: "session.mcp_server_drift", status: EventStatus::Implemented },
    EventEntry { id: "session.persistence_degraded", status: EventStatus::Implemented },
    EventEntry { id: "session.renamed", status: EventStatus::Implemented },
    EventEntry { id: "session.started", status: EventStatus::Implemented },
    EventEntry { id: "shell.output", status: EventStatus::NotWired },
    EventEntry { id: "shell.started", status: EventStatus::NotWired },
    EventEntry { id: "task.approval.required", status: EventStatus::Implemented },
    EventEntry { id: "task.approval.resolved", status: EventStatus::Implemented },
    EventEntry { id: "task.execution.blocked", status: EventStatus::Implemented },
    EventEntry { id: "task.execution.completed", status: EventStatus::Implemented },
    EventEntry { id: "task.execution.failed", status: EventStatus::Implemented },
    EventEntry { id: "task.execution.started", status: EventStatus::Implemented },
    EventEntry { id: "task.plan.proposed", status: EventStatus::Implemented },
    EventEntry { id: "task.plan.updated", status: EventStatus::Implemented },
    EventEntry { id: "terminal.activity", status: EventStatus::Implemented },
    EventEntry { id: "tool.failed", status: EventStatus::Implemented },
    EventEntry { id: "tool.observed", status: EventStatus::Implemented },
    EventEntry { id: "tool.updated", status: EventStatus::Implemented },
    EventEntry { id: "validation.run.updated", status: EventStatus::Implemented },
    EventEntry { id: "workflow.artifact.created", status: EventStatus::Implemented },
    EventEntry { id: "workflow.completed", status: EventStatus::Implemented },
    EventEntry { id: "workflow.failed", status: EventStatus::Implemented },
    EventEntry { id: "workflow.input.message_submit", status: EventStatus::Implemented },
    EventEntry { id: "workflow.started", status: EventStatus::Implemented },
    EventEntry { id: "workflow.step.completed", status: EventStatus::Implemented },
    EventEntry { id: "workflow.step.failed", status: EventStatus::Implemented },
    EventEntry { id: "workflow.step.started", status: EventStatus::Implemented },
    EventEntry { id: "workflow.step.updated", status: EventStatus::Implemented },
    EventEntry { id: "workspace.branch.updated", status: EventStatus::Implemented },
    EventEntry { id: "workspace.preview.console_error", status: EventStatus::Implemented },
    EventEntry { id: "workspace.preview.error", status: EventStatus::Implemented },
    EventEntry { id: "workspace.preview.network_failure", status: EventStatus::Implemented },
    EventEntry { id: "workspace.preview.unsupported", status: EventStatus::Implemented },
    EventEntry { id: "workspace.preview.updated", status: EventStatus::Implemented },
    EventEntry { id: "ws.auth_failed", status: EventStatus::Implemented },
    EventEntry { id: "ws.connected", status: EventStatus::Implemented },
    EventEntry { id: "ws.disconnected", status: EventStatus::Implemented },
];

pub fn event_status(id: &str) -> Option<EventStatus> {
    EVENT_CATALOG.iter().find(|e| e.id == id).map(|e| e.status)
}

pub fn is_known_event(id: &str) -> bool {
    EVENT_CATALOG.iter().any(|e| e.id == id)
}
