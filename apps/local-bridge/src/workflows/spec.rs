//! VIL-style workflow spec — declarative YAML definition of activity graph.

use serde::Deserialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Deserialize)]
pub struct WorkflowSpec {
    pub version: u32,
    pub metadata: WorkflowMetadata,
    pub activities: Vec<ActivitySpec>,
    pub flows: Vec<FlowEdge>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkflowMetadata {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ActivitySpec {
    pub id: String,
    pub kind: ActivityKind,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Trigger,
    PromptAgent,
    AwaitApproval,
    ObserveToolActivity,
    CollectReviewDiff,
    CollectRuntimeLog,
    GateDecision,
    End,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FlowEdge {
    pub from: String,
    pub to: String,
    pub on: Option<String>,
}

impl WorkflowSpec {
    pub fn from_yaml(s: &str) -> anyhow::Result<Self> {
        let spec: WorkflowSpec = serde_yaml::from_str(s)?;
        spec.validate()?;
        Ok(spec)
    }

    fn validate(&self) -> anyhow::Result<()> {
        let mut ids = HashSet::new();
        for a in &self.activities {
            if !ids.insert(a.id.as_str()) {
                anyhow::bail!("duplicate activity id: {}", a.id);
            }
        }
        for f in &self.flows {
            if !ids.contains(f.from.as_str()) {
                anyhow::bail!("flow references unknown activity (from): {}", f.from);
            }
            if !ids.contains(f.to.as_str()) {
                anyhow::bail!("flow references unknown activity (to): {}", f.to);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basic_yaml() -> &'static str {
        r#"
version: 1
metadata:
  id: test
  name: Test
activities:
  - id: trigger
    kind: trigger
    label: Start
  - id: end
    kind: end
    label: End
flows:
  - from: trigger
    to: end
    on: transcript.completed
"#
    }

    #[test]
    fn parses_basic_spec() {
        let spec = WorkflowSpec::from_yaml(basic_yaml()).unwrap();
        assert_eq!(spec.metadata.id, "test");
        assert_eq!(spec.activities.len(), 2);
        assert_eq!(spec.flows.len(), 1);
    }

    #[test]
    fn rejects_duplicate_activity_id() {
        let yaml = r#"
version: 1
metadata:
  id: test
  name: Test
activities:
  - id: trigger
    kind: trigger
    label: Start
  - id: trigger
    kind: end
    label: End
flows: []
"#;
        assert!(WorkflowSpec::from_yaml(yaml).is_err());
    }

    #[test]
    fn rejects_unknown_flow_from() {
        let yaml = r#"
version: 1
metadata:
  id: test
  name: Test
activities:
  - id: trigger
    kind: trigger
    label: Start
flows:
  - from: nope
    to: trigger
"#;
        assert!(WorkflowSpec::from_yaml(yaml).is_err());
    }

    #[test]
    fn rejects_unknown_flow_to() {
        let yaml = r#"
version: 1
metadata:
  id: test
  name: Test
activities:
  - id: trigger
    kind: trigger
    label: Start
flows:
  - from: trigger
    to: nope
"#;
        assert!(WorkflowSpec::from_yaml(yaml).is_err());
    }

    #[test]
    fn all_activity_kinds_deserialize() {
        let yaml = r#"
version: 1
metadata:
  id: test
  name: Test
activities:
  - id: a
    kind: trigger
    label: A
  - id: b
    kind: prompt_agent
    label: B
  - id: c
    kind: await_approval
    label: C
  - id: d
    kind: observe_tool_activity
    label: D
  - id: e
    kind: collect_review_diff
    label: E
  - id: f
    kind: collect_runtime_log
    label: F
  - id: g
    kind: gate_decision
    label: G
  - id: h
    kind: end
    label: H
flows: []
"#;
        let spec = WorkflowSpec::from_yaml(yaml).unwrap();
        assert_eq!(spec.activities.len(), 8);
        assert_eq!(spec.activities[0].kind, ActivityKind::Trigger);
        assert_eq!(spec.activities[7].kind, ActivityKind::End);
    }

    #[test]
    fn flow_edge_on_field_is_optional() {
        let yaml = r#"
version: 1
metadata:
  id: test
  name: Test
activities:
  - id: a
    kind: trigger
    label: A
  - id: b
    kind: end
    label: B
flows:
  - from: a
    to: b
"#;
        let spec = WorkflowSpec::from_yaml(yaml).unwrap();
        assert!(spec.flows[0].on.is_none());
    }
}
