//! Map bridge event types → semantic WorkflowAdvance variants.
//! Maps WorkflowAdvance → YAML flow `on:` keys for graph traversal.

use serde_json::Value;

/// Semantic advance signal derived from a bridge event.
#[derive(Debug, Clone)]
pub enum WorkflowAdvance {
    PromptSubmitted,
    ApprovalPending {
        approval_id: String,
    },
    ApprovalResolved {
        approval_id: String,
        outcome: String,
    },
    ToolObserved {
        tool_call_id: String,
        kind: String,
    },
    ToolUpdated {
        tool_call_id: String,
    },
    ToolFailed {
        tool_call_id: String,
    },
    ReviewDiff {
        tool_call_id: String,
        review_diff_count: Option<u32>,
    },
    RuntimeLog {
        tool_call_id: String,
        runtime_command_preview: Option<String>,
    },
    TranscriptCompleted,
    TranscriptError {
        reason: String,
    },
}

impl WorkflowAdvance {
    /// Returns the YAML flow `on:` key this signal corresponds to.
    /// Used by WorkflowExecutor to find matching flow edges.
    pub fn to_event_key(&self) -> &'static str {
        match self {
            Self::PromptSubmitted => "message.submit",
            Self::ApprovalPending { .. } => "approval.pending",
            Self::ApprovalResolved { .. } => "approval.resolved",
            Self::ToolObserved { .. } => "tool.observed",
            Self::ToolUpdated { .. } => "tool.updated",
            Self::ToolFailed { .. } => "tool.failed",
            Self::ReviewDiff { .. } => "review.changeset_updated",
            Self::RuntimeLog { .. } => "runtime.job_log",
            Self::TranscriptCompleted => "transcript.completed",
            Self::TranscriptError { .. } => "transcript.error",
        }
    }
}

/// Returns `None` for events that don't advance the workflow.
pub fn classify_bridge_event(event_type: &str, payload: &Value) -> Option<WorkflowAdvance> {
    // Never process our own workflow output events — prevents infinite loops.
    // workflow.input.* are internal bridge signals, not output events.
    if event_type.starts_with("workflow.") && !event_type.starts_with("workflow.input.") {
        return None;
    }
    match event_type {
        // Internal namespaced event emitted by send_client_command.
        "workflow.input.message_submit" => Some(WorkflowAdvance::PromptSubmitted),
        "approval.pending" => {
            let approval_id = payload
                .get("approval_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(WorkflowAdvance::ApprovalPending { approval_id })
        }
        "approval.resolved" => {
            let approval_id = payload
                .get("approval_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let outcome = payload
                .get("outcome")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            Some(WorkflowAdvance::ApprovalResolved {
                approval_id,
                outcome,
            })
        }
        "tool.observed" => {
            let tool_call_id = payload
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let kind = payload
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("other")
                .to_string();
            Some(WorkflowAdvance::ToolObserved { tool_call_id, kind })
        }
        "tool.updated" => {
            let tool_call_id = payload
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(WorkflowAdvance::ToolUpdated { tool_call_id })
        }
        "tool.failed" => {
            let tool_call_id = payload
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(WorkflowAdvance::ToolFailed { tool_call_id })
        }
        "review.changeset_updated" => {
            let tool_call_id = payload
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let review_diff_count = payload
                .get("diffs")
                .and_then(|v| v.as_array())
                .map(|a| a.len() as u32);
            Some(WorkflowAdvance::ReviewDiff {
                tool_call_id,
                review_diff_count,
            })
        }
        "runtime.job_log" => {
            let tool_call_id = payload
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let runtime_command_preview = payload
                .get("command")
                .and_then(|v| v.as_str())
                .map(|s| s.chars().take(120).collect::<String>());
            Some(WorkflowAdvance::RuntimeLog {
                tool_call_id,
                runtime_command_preview,
            })
        }
        "transcript.completed" => Some(WorkflowAdvance::TranscriptCompleted),
        "transcript.error" => {
            let reason = payload
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("error")
                .to_string();
            Some(WorkflowAdvance::TranscriptError { reason })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn classifies_workflow_input_message_submit() {
        let adv = classify_bridge_event("workflow.input.message_submit", &json!({})).unwrap();
        assert!(matches!(adv, WorkflowAdvance::PromptSubmitted));
    }

    #[test]
    fn prompt_submitted_event_key_is_message_submit() {
        assert_eq!(
            WorkflowAdvance::PromptSubmitted.to_event_key(),
            "message.submit"
        );
    }

    #[test]
    fn classifies_approval_pending() {
        let adv =
            classify_bridge_event("approval.pending", &json!({"approval_id": "appr_01"})).unwrap();
        assert!(
            matches!(adv, WorkflowAdvance::ApprovalPending { ref approval_id, .. } if approval_id == "appr_01")
        );
    }

    #[test]
    fn classifies_tool_observed() {
        let adv = classify_bridge_event(
            "tool.observed",
            &json!({"tool_call_id": "tc1", "kind": "read"}),
        )
        .unwrap();
        assert!(matches!(adv, WorkflowAdvance::ToolObserved { ref kind, .. } if kind == "read"));
    }

    #[test]
    fn classifies_transcript_completed() {
        let adv = classify_bridge_event("transcript.completed", &json!({})).unwrap();
        assert!(matches!(adv, WorkflowAdvance::TranscriptCompleted));
    }

    #[test]
    fn ignores_workflow_self_events() {
        assert!(classify_bridge_event("workflow.started", &json!({})).is_none());
        assert!(classify_bridge_event("workflow.step.started", &json!({})).is_none());
        assert!(classify_bridge_event("workflow.input.message_submit", &json!({})).is_some());
        // NOT workflow.*
    }

    #[test]
    fn ignores_transcript_delta() {
        assert!(classify_bridge_event("transcript.delta", &json!({"delta": "x"})).is_none());
    }

    #[test]
    fn classifies_runtime_log() {
        let adv =
            classify_bridge_event("runtime.job_log", &json!({"tool_call_id": "tc2"})).unwrap();
        assert!(
            matches!(adv, WorkflowAdvance::RuntimeLog { ref tool_call_id, .. } if tool_call_id == "tc2")
        );
    }

    #[test]
    fn classifies_review_diff() {
        let adv =
            classify_bridge_event("review.changeset_updated", &json!({"tool_call_id": "tc3"}))
                .unwrap();
        assert!(
            matches!(adv, WorkflowAdvance::ReviewDiff { ref tool_call_id, .. } if tool_call_id == "tc3")
        );
    }

    #[test]
    fn all_variants_have_event_keys() {
        let variants: Vec<(&str, WorkflowAdvance)> = vec![
            ("message.submit", WorkflowAdvance::PromptSubmitted),
            (
                "approval.pending",
                WorkflowAdvance::ApprovalPending {
                    approval_id: "x".into(),
                },
            ),
            (
                "approval.resolved",
                WorkflowAdvance::ApprovalResolved {
                    approval_id: "x".into(),
                    outcome: "approved".into(),
                },
            ),
            (
                "tool.observed",
                WorkflowAdvance::ToolObserved {
                    tool_call_id: "x".into(),
                    kind: "read".into(),
                },
            ),
            (
                "tool.updated",
                WorkflowAdvance::ToolUpdated {
                    tool_call_id: "x".into(),
                },
            ),
            (
                "tool.failed",
                WorkflowAdvance::ToolFailed {
                    tool_call_id: "x".into(),
                },
            ),
            (
                "review.changeset_updated",
                WorkflowAdvance::ReviewDiff {
                    tool_call_id: "x".into(),
                    review_diff_count: None,
                },
            ),
            (
                "runtime.job_log",
                WorkflowAdvance::RuntimeLog {
                    tool_call_id: "x".into(),
                    runtime_command_preview: None,
                },
            ),
            ("transcript.completed", WorkflowAdvance::TranscriptCompleted),
            (
                "transcript.error",
                WorkflowAdvance::TranscriptError { reason: "x".into() },
            ),
        ];
        for (expected_key, variant) in variants {
            assert_eq!(
                variant.to_event_key(),
                expected_key,
                "failed for {:?}",
                variant
            );
        }
    }
}
