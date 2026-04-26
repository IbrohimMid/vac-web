//! Per-session VIL-style workflow run executor.
//!
//! Flow-driven: step transitions follow YAML `flows` graph edges.
//! Artifact creation maps selected bridge signals to metadata-only payloads
//! (tool_activity, approval, review_diff, runtime_log). Raw output and raw
//! diffs are never included.

use super::adapters::WorkflowAdvance;
use super::events;
use super::spec::{ActivityKind, WorkflowSpec};
use crate::ws::envelope::ServerEvent;
use chrono::Utc;
use ulid::Ulid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepStatus {
    Pending,
    Started,
    Completed,
    Failed,
}

#[derive(Debug, Clone)]
pub struct WorkflowStep {
    pub step_id: String,
    pub activity_id: String,
    pub activity_kind: ActivityKind,
    pub label: String,
    pub status: StepStatus,
}

#[derive(Debug, Clone)]
pub struct WorkflowArtifact {
    pub artifact_id: String,
    pub kind: String,
    pub step_id: String,
    pub tool_call_id: String,
    pub ts: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
}

pub struct WorkflowExecutor {
    pub run_id: String,
    pub session_id: String,
    pub spec_id: String,
    pub spec_name: String,
    pub steps: Vec<WorkflowStep>,
    pub artifacts: Vec<WorkflowArtifact>,
    pub status: RunStatus,
    spec: WorkflowSpec,
}

impl WorkflowExecutor {
    pub fn new(session_id: String, spec: WorkflowSpec) -> Self {
        let steps = spec
            .activities
            .iter()
            .map(|a| WorkflowStep {
                step_id: format!("step_{}_{}", a.id, Ulid::new()),
                activity_id: a.id.clone(),
                activity_kind: a.kind.clone(),
                label: a.label.clone(),
                status: StepStatus::Pending,
            })
            .collect();
        let spec_id = spec.metadata.id.clone();
        let spec_name = spec.metadata.name.clone();
        Self {
            run_id: format!("run_{}", Ulid::new()),
            session_id,
            spec_id,
            spec_name,
            steps,
            artifacts: Vec::new(),
            status: RunStatus::Running,
            spec,
        }
    }

    /// Emit workflow.started + start+complete Trigger activity.
    /// Call once after creating the executor, before advance().
    pub fn start_run_events(&mut self) -> Vec<ServerEvent> {
        let mut evs = vec![events::workflow_started(
            &self.session_id,
            &self.run_id,
            &self.spec_id,
            &self.spec_name,
        )];
        // Find trigger activity and immediately start+complete it.
        let trigger_id = self
            .spec
            .activities
            .iter()
            .find(|a| a.kind == ActivityKind::Trigger)
            .map(|a| a.id.clone());
        if let Some(tid) = trigger_id {
            evs.extend(self.start_activity(&tid));
            evs.extend(self.complete_activity(&tid));
        }
        evs
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self.status, RunStatus::Completed | RunStatus::Failed)
    }

    /// Advance the workflow by a signal. Flow-driven: step transitions
    /// follow YAML flows graph edges. Returns events to emit.
    pub fn advance(&mut self, signal: WorkflowAdvance) -> Vec<ServerEvent> {
        if self.is_terminal() {
            return vec![];
        }

        let mut evs = vec![];

        match &signal {
            WorkflowAdvance::TranscriptError { reason } => {
                return self.terminal_fail(reason.clone());
            }
            WorkflowAdvance::ApprovalResolved { outcome, .. }
                if outcome == "rejected" || outcome == "timeout" =>
            {
                // Fail the AwaitApproval step; do not traverse flow edges.
                evs.extend(self.fail_step_by_kind(ActivityKind::AwaitApproval, outcome));
                return evs;
            }
            WorkflowAdvance::ToolFailed { .. } => {
                evs.extend(
                    self.fail_step_by_kind(ActivityKind::ObserveToolActivity, "tool_failed"),
                );
                return evs;
            }
            _ => {}
        }

        let event_key = signal.to_event_key();

        // Flow-driven: find edges matching this event from reachable activities.
        let edges: Vec<(String, String)> = self
            .spec
            .flows
            .iter()
            .filter(|e| e.on.as_deref() == Some(event_key))
            .filter(|e| self.activity_is_active_or_completed(&e.from))
            .map(|e| (e.from.clone(), e.to.clone()))
            .collect();

        if edges.is_empty() {
            // TranscriptCompleted with no matching edges: graceful terminal.
            if matches!(signal, WorkflowAdvance::TranscriptCompleted) {
                return self.terminal_complete();
            }
            // Other signals with no edge: artifact-only (ReviewDiff, RuntimeLog, ToolUpdated).
            evs.extend(self.maybe_create_artifact(&signal));
            return evs;
        }

        for (from_id, to_id) in &edges {
            // Complete the "from" step on transition signals.
            match &signal {
                WorkflowAdvance::ApprovalResolved { .. } | WorkflowAdvance::TranscriptCompleted => {
                    evs.extend(self.complete_activity(from_id));
                }
                _ => {}
            }
            evs.extend(self.start_activity(to_id));
        }

        evs.extend(self.maybe_create_artifact(&signal));

        evs
    }

    // ── Internals ─────────────────────────────────────────────────────────

    fn activity_is_active_or_completed(&self, activity_id: &str) -> bool {
        self.steps.iter().any(|s| {
            s.activity_id == activity_id
                && matches!(s.status, StepStatus::Started | StepStatus::Completed)
        })
    }

    fn start_activity(&mut self, activity_id: &str) -> Vec<ServerEvent> {
        // Collect data first to avoid borrow conflicts.
        let step_info = self
            .steps
            .iter_mut()
            .find(|s| s.activity_id == activity_id && s.status == StepStatus::Pending)
            .map(|s| {
                s.status = StepStatus::Started;
                (s.step_id.clone(), s.activity_kind.clone(), s.label.clone())
            });
        let Some((step_id, kind, label)) = step_info else {
            return vec![];
        };
        let kind_str = serde_json::to_value(&kind)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default();
        let mut evs = vec![events::workflow_step_started(
            &self.session_id,
            &self.run_id,
            &step_id,
            &kind_str,
            &label,
        )];
        // End activity: immediately complete and mark workflow done.
        if kind == ActivityKind::End {
            if let Some(step) = self.steps.iter_mut().find(|s| s.step_id == step_id) {
                step.status = StepStatus::Completed;
            }
            evs.push(events::workflow_step_completed(
                &self.session_id,
                &self.run_id,
                &step_id,
            ));
            self.status = RunStatus::Completed;
            evs.push(events::workflow_completed(&self.session_id, &self.run_id));
        }
        evs
    }

    fn complete_activity(&mut self, activity_id: &str) -> Vec<ServerEvent> {
        let step_info = self
            .steps
            .iter_mut()
            .find(|s| s.activity_id == activity_id && s.status == StepStatus::Started)
            .map(|s| {
                s.status = StepStatus::Completed;
                s.step_id.clone()
            });
        let Some(step_id) = step_info else {
            return vec![];
        };
        let mut evs = vec![events::workflow_step_completed(
            &self.session_id,
            &self.run_id,
            &step_id,
        )];
        // Traverse no-on edges from this activity.
        let auto_edges: Vec<String> = self
            .spec
            .flows
            .iter()
            .filter(|e| e.from == activity_id && e.on.is_none())
            .map(|e| e.to.clone())
            .collect();
        for target in auto_edges {
            evs.extend(self.start_activity(&target));
        }
        evs
    }

    fn fail_step_by_kind(&mut self, kind: ActivityKind, reason: &str) -> Vec<ServerEvent> {
        let step_info = self
            .steps
            .iter_mut()
            .find(|s| {
                s.activity_kind == kind
                    && matches!(s.status, StepStatus::Started | StepStatus::Pending)
            })
            .map(|s| {
                s.status = StepStatus::Failed;
                s.step_id.clone()
            });
        let Some(step_id) = step_info else {
            return vec![];
        };
        vec![events::workflow_step_failed(
            &self.session_id,
            &self.run_id,
            &step_id,
            reason,
        )]
    }

    fn terminal_complete(&mut self) -> Vec<ServerEvent> {
        let mut evs = vec![];
        let end_id = self
            .spec
            .activities
            .iter()
            .find(|a| a.kind == ActivityKind::End)
            .map(|a| a.id.clone());
        for step in self.steps.iter_mut() {
            if step.status == StepStatus::Started {
                step.status = StepStatus::Completed;
                evs.push(events::workflow_step_completed(
                    &self.session_id,
                    &self.run_id,
                    &step.step_id,
                ));
            }
        }
        if let Some(eid) = end_id {
            evs.extend(self.start_activity(&eid));
        }
        if self.status != RunStatus::Completed {
            self.status = RunStatus::Completed;
            evs.push(events::workflow_completed(&self.session_id, &self.run_id));
        }
        evs
    }

    fn terminal_fail(&mut self, reason: String) -> Vec<ServerEvent> {
        let mut evs = vec![];
        for step in self.steps.iter_mut() {
            if matches!(step.status, StepStatus::Started | StepStatus::Pending)
                && step.activity_kind != ActivityKind::Trigger
            {
                step.status = StepStatus::Failed;
                evs.push(events::workflow_step_failed(
                    &self.session_id,
                    &self.run_id,
                    &step.step_id,
                    &reason,
                ));
            }
        }
        self.status = RunStatus::Failed;
        evs.push(events::workflow_failed(
            &self.session_id,
            &self.run_id,
            &reason,
        ));
        evs
    }

    fn maybe_create_artifact(&mut self, signal: &WorkflowAdvance) -> Vec<ServerEvent> {
        let (artifact_kind, tool_call_id, step_kind, source_event_type, extra) = match signal {
            WorkflowAdvance::ReviewDiff {
                tool_call_id,
                review_diff_count,
            } => (
                "review_diff",
                tool_call_id.clone(),
                ActivityKind::CollectReviewDiff,
                "review.changeset_updated",
                serde_json::json!({ "review_diff_count": review_diff_count }),
            ),
            WorkflowAdvance::RuntimeLog {
                tool_call_id,
                runtime_command_preview,
            } => (
                "runtime_log",
                tool_call_id.clone(),
                ActivityKind::CollectRuntimeLog,
                "runtime.job_log",
                serde_json::json!({ "runtime_command_preview": runtime_command_preview }),
            ),
            WorkflowAdvance::ToolObserved { tool_call_id, .. } => (
                "tool_activity",
                tool_call_id.clone(),
                ActivityKind::ObserveToolActivity,
                "tool.observed",
                serde_json::Value::Object(Default::default()),
            ),
            WorkflowAdvance::ApprovalPending { approval_id } => (
                "approval",
                approval_id.clone(),
                ActivityKind::AwaitApproval,
                "approval.pending",
                serde_json::json!({ "approval_id": approval_id }),
            ),
            _ => return vec![],
        };
        let step_id = self
            .steps
            .iter()
            .find(|s| s.activity_kind == step_kind && s.status == StepStatus::Started)
            .map(|s| s.step_id.clone());
        let Some(step_id) = step_id else {
            return vec![];
        };
        let artifact_id = format!("art_{}", Ulid::new());
        let ts = Utc::now().to_rfc3339();
        let art_ev = events::workflow_artifact_created(
            &self.session_id,
            &self.run_id,
            &artifact_id,
            artifact_kind,
            &step_id,
            &tool_call_id,
            source_event_type,
            &ts,
            extra,
        );
        self.artifacts.push(WorkflowArtifact {
            artifact_id,
            kind: artifact_kind.into(),
            step_id,
            tool_call_id,
            ts,
        });
        vec![art_ev]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflows::spec::WorkflowSpec;

    fn basic_spec() -> WorkflowSpec {
        WorkflowSpec::from_yaml(
            r#"
version: 1
metadata:
  id: build.basic
  name: Basic Build
activities:
  - id: trigger
    kind: trigger
    label: "Workflow started"
  - id: prompt_agent
    kind: prompt_agent
    label: "Prompt agent"
  - id: observe_tools
    kind: observe_tool_activity
    label: "Observe tool activity"
  - id: end
    kind: end
    label: "Done"
flows:
  - from: trigger
    to: prompt_agent
    on: message.submit
  - from: prompt_agent
    to: observe_tools
    on: tool.observed
  - from: observe_tools
    to: end
    on: transcript.completed
"#,
        )
        .unwrap()
    }

    fn new_exec() -> WorkflowExecutor {
        WorkflowExecutor::new("sess1".to_string(), basic_spec())
    }

    #[test]
    fn new_executor_is_running() {
        let ex = new_exec();
        assert_eq!(ex.status, RunStatus::Running);
        assert_eq!(ex.steps.len(), 4);
        assert!(ex.steps.iter().all(|s| s.status == StepStatus::Pending));
    }

    #[test]
    fn start_run_starts_and_completes_trigger() {
        let mut ex = new_exec();
        let evs = ex.start_run_events();
        assert!(evs.iter().any(|e| e.event_type == "workflow.started"));
        let trigger = ex
            .steps
            .iter()
            .find(|s| s.activity_id == "trigger")
            .unwrap();
        assert_eq!(trigger.status, StepStatus::Completed);
    }

    #[test]
    fn prompt_submitted_starts_prompt_agent_via_flow_edge() {
        let mut ex = new_exec();
        ex.start_run_events();
        let evs = ex.advance(WorkflowAdvance::PromptSubmitted);
        assert!(evs.iter().any(|e| e.event_type == "workflow.step.started"));
        let step = ex
            .steps
            .iter()
            .find(|s| s.activity_id == "prompt_agent")
            .unwrap();
        assert_eq!(step.status, StepStatus::Started);
        // observe_tools must NOT be started yet (no matching flow edge)
        let observe = ex
            .steps
            .iter()
            .find(|s| s.activity_id == "observe_tools")
            .unwrap();
        assert_eq!(observe.status, StepStatus::Pending);
    }

    #[test]
    fn tool_observed_starts_observe_via_flow_edge() {
        let mut ex = new_exec();
        ex.start_run_events();
        ex.advance(WorkflowAdvance::PromptSubmitted);
        let evs = ex.advance(WorkflowAdvance::ToolObserved {
            tool_call_id: "tc1".to_string(),
            kind: "read".to_string(),
        });
        assert!(evs.iter().any(|e| e.event_type == "workflow.step.started"));
        let step = ex
            .steps
            .iter()
            .find(|s| s.activity_id == "observe_tools")
            .unwrap();
        assert_eq!(step.status, StepStatus::Started);
    }

    #[test]
    fn transcript_completed_follows_flow_to_end() {
        let mut ex = new_exec();
        ex.start_run_events();
        ex.advance(WorkflowAdvance::PromptSubmitted);
        ex.advance(WorkflowAdvance::ToolObserved {
            tool_call_id: "tc1".to_string(),
            kind: "read".to_string(),
        });
        let evs = ex.advance(WorkflowAdvance::TranscriptCompleted);
        assert!(evs.iter().any(|e| e.event_type == "workflow.completed"));
        assert_eq!(ex.status, RunStatus::Completed);
    }

    #[test]
    fn transcript_error_marks_workflow_failed() {
        let mut ex = new_exec();
        ex.start_run_events();
        ex.advance(WorkflowAdvance::PromptSubmitted);
        let evs = ex.advance(WorkflowAdvance::TranscriptError {
            reason: "crash".to_string(),
        });
        assert!(evs.iter().any(|e| e.event_type == "workflow.failed"));
        assert_eq!(ex.status, RunStatus::Failed);
    }

    #[test]
    fn executor_uses_yaml_flow_not_hardcoded_kind_order() {
        // Custom spec: approval comes FIRST, then prompt (unusual order)
        let yaml = r#"
version: 1
metadata:
  id: custom
  name: Custom
activities:
  - id: trigger
    kind: trigger
    label: "Start"
  - id: awaits
    kind: await_approval
    label: "Wait approval"
  - id: prompt
    kind: prompt_agent
    label: "Prompt"
  - id: end
    kind: end
    label: "End"
flows:
  - from: trigger
    to: awaits
    on: message.submit
  - from: awaits
    to: prompt
    on: approval.resolved
  - from: prompt
    to: end
    on: transcript.completed
"#;
        let spec = WorkflowSpec::from_yaml(yaml).unwrap();
        let mut ex = WorkflowExecutor::new("sess1".to_string(), spec);
        ex.start_run_events();

        // message.submit → should start awaits, NOT prompt_agent
        let evs = ex.advance(WorkflowAdvance::PromptSubmitted);
        assert!(evs.iter().any(|e| e.event_type == "workflow.step.started"));
        let awaits = ex.steps.iter().find(|s| s.activity_id == "awaits").unwrap();
        assert_eq!(
            awaits.status,
            StepStatus::Started,
            "awaits must start on message.submit"
        );
        let prompt = ex.steps.iter().find(|s| s.activity_id == "prompt").unwrap();
        assert_eq!(
            prompt.status,
            StepStatus::Pending,
            "prompt must stay pending until approval.resolved"
        );
    }

    #[test]
    fn unknown_signal_does_not_advance_steps() {
        let mut ex = new_exec();
        ex.start_run_events();
        // RuntimeLog has no matching edge from trigger (which is the only completed step)
        let evs = ex.advance(WorkflowAdvance::RuntimeLog {
            tool_call_id: "tc1".to_string(),
            runtime_command_preview: None,
        });
        // No step transitions should happen (no artifact either since no CollectRuntimeLog step started)
        assert!(!evs.iter().any(|e| e.event_type == "workflow.step.started"));
        let prompt = ex
            .steps
            .iter()
            .find(|s| s.activity_id == "prompt_agent")
            .unwrap();
        assert_eq!(prompt.status, StepStatus::Pending);
    }

    #[test]
    fn approval_rejected_fails_await_approval_step() {
        let yaml = r#"
version: 1
metadata:
  id: approval-test
  name: Approval Test
activities:
  - id: trigger
    kind: trigger
    label: "Start"
  - id: await_approval
    kind: await_approval
    label: "Await approval"
  - id: end
    kind: end
    label: "End"
flows:
  - from: trigger
    to: await_approval
    on: message.submit
  - from: await_approval
    to: end
    on: approval.resolved
"#;
        let spec = WorkflowSpec::from_yaml(yaml).unwrap();
        let mut ex = WorkflowExecutor::new("sess1".to_string(), spec);
        ex.start_run_events();
        ex.advance(WorkflowAdvance::PromptSubmitted);
        let evs = ex.advance(WorkflowAdvance::ApprovalResolved {
            approval_id: "appr_01".to_string(),
            outcome: "rejected".to_string(),
        });
        assert!(evs.iter().any(|e| e.event_type == "workflow.step.failed"));
        let step = ex
            .steps
            .iter()
            .find(|s| s.activity_id == "await_approval")
            .unwrap();
        assert_eq!(step.status, StepStatus::Failed);
    }

    #[test]
    fn terminal_executor_ignores_advances() {
        let mut ex = new_exec();
        ex.start_run_events();
        ex.advance(WorkflowAdvance::PromptSubmitted);
        ex.advance(WorkflowAdvance::ToolObserved {
            tool_call_id: "tc1".to_string(),
            kind: "read".to_string(),
        });
        ex.advance(WorkflowAdvance::TranscriptCompleted);
        assert!(ex.is_terminal());
        let evs = ex.advance(WorkflowAdvance::PromptSubmitted);
        assert!(evs.is_empty());
    }

    #[test]
    fn second_run_has_different_run_id() {
        let spec = basic_spec();
        let ex1 = WorkflowExecutor::new("sess1".to_string(), spec.clone());
        let ex2 = WorkflowExecutor::new("sess1".to_string(), spec);
        assert_ne!(ex1.run_id, ex2.run_id);
    }

    #[test]
    fn review_diff_creates_artifact_when_step_active() {
        let diff_yaml = r#"
version: 1
metadata:
  id: diff-test
  name: Diff Test
activities:
  - id: trigger
    kind: trigger
    label: "Start"
  - id: collect_diff
    kind: collect_review_diff
    label: "Collect diff"
  - id: end
    kind: end
    label: "End"
flows:
  - from: trigger
    to: collect_diff
    on: message.submit
  - from: collect_diff
    to: end
    on: transcript.completed
"#;
        let spec = WorkflowSpec::from_yaml(diff_yaml).unwrap();
        let mut ex = WorkflowExecutor::new("sess1".to_string(), spec);
        ex.start_run_events();
        ex.advance(WorkflowAdvance::PromptSubmitted); // starts collect_diff
        let evs = ex.advance(WorkflowAdvance::ReviewDiff {
            tool_call_id: "tc1".to_string(),
            review_diff_count: None,
        });
        assert!(evs
            .iter()
            .any(|e| e.event_type == "workflow.artifact.created"));
        assert_eq!(ex.artifacts.len(), 1);
        assert_eq!(ex.artifacts[0].kind, "review_diff");
    }
}
