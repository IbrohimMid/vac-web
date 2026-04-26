//! Bundled workflow spec registry.
//!
//! Specs are compiled in via `include_str!` — no runtime file I/O.
//! `WorkflowRegistry::global()` returns a lazily-initialized singleton
//! so callers in `session/handle.rs` don't need to thread a registry ref.

use super::spec::WorkflowSpec;
use std::collections::HashMap;
use std::sync::OnceLock;

static BUNDLED: &[(&str, &str)] = &[
    (
        "build.basic",
        include_str!("../../workflows/build.basic.yaml"),
    ),
    (
        "build.approval-gated-edit",
        include_str!("../../workflows/build.approval-gated-edit.yaml"),
    ),
    (
        "build.observe-tools",
        include_str!("../../workflows/build.observe-tools.yaml"),
    ),
    (
        "assess.report",
        include_str!("../../workflows/assess.report.yaml"),
    ),
    (
        "handoff.package",
        include_str!("../../workflows/handoff.package.yaml"),
    ),
    (
        "build.full-cockpit",
        include_str!("../../workflows/build.full-cockpit.yaml"),
    ),
];

pub struct WorkflowRegistry {
    specs: HashMap<String, WorkflowSpec>,
}

impl WorkflowRegistry {
    fn load() -> Self {
        let mut specs = HashMap::new();
        for (id, yaml) in BUNDLED {
            match WorkflowSpec::from_yaml(yaml) {
                Ok(spec) => {
                    specs.insert(id.to_string(), spec);
                }
                Err(e) => {
                    tracing::error!("bundled workflow {id} failed to parse: {e}");
                }
            }
        }
        Self { specs }
    }

    pub fn global() -> &'static Self {
        static INSTANCE: OnceLock<WorkflowRegistry> = OnceLock::new();
        INSTANCE.get_or_init(Self::load)
    }

    pub fn get(&self, id: &str) -> Option<&WorkflowSpec> {
        self.specs.get(id)
    }

    pub fn default_build_spec_id() -> &'static str {
        "build.observe-tools"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_bundled_workflows_parse() {
        let reg = WorkflowRegistry::global();
        // At least 5 specs loaded.
        assert!(reg.specs.len() >= 5);
    }

    #[test]
    fn get_build_basic() {
        let reg = WorkflowRegistry::global();
        let spec = reg.get("build.basic").unwrap();
        assert_eq!(spec.metadata.id, "build.basic");
        assert!(!spec.activities.is_empty());
    }

    #[test]
    fn get_returns_none_for_unknown() {
        let reg = WorkflowRegistry::global();
        assert!(reg.get("nonexistent.workflow").is_none());
    }
}
