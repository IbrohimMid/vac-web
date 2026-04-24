//! Harness utilities shared across red-team cases.

pub mod meta;
pub use meta::{Layer, Severity, TestCaseMeta};

use std::path::PathBuf;

/// Absolute path to `packages/protocol/v1/profiles/`.
pub fn profiles_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR == .../tests/red-team
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .join("packages/protocol/v1/profiles")
}

/// Short-lived project_root for fs enforcement tests.
pub fn synth_project_root() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}
