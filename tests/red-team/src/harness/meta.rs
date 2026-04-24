//! Test case metadata. Future work: derive macro that registers tests for reporting.

#[derive(Debug, Clone)]
pub struct TestCaseMeta {
    pub id: &'static str,
    pub title: &'static str,
    pub layer: Layer,
    pub profile: &'static str,
    pub severity: Severity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    Bridge,
    Engine,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Critical,
    High,
    Medium,
}

impl TestCaseMeta {
    pub const fn new(
        id: &'static str,
        title: &'static str,
        layer: Layer,
        profile: &'static str,
        severity: Severity,
    ) -> Self {
        Self {
            id,
            title,
            layer,
            profile,
            severity,
        }
    }
}
