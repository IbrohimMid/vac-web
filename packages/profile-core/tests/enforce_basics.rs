//! Profile enforcement basics: tool allow/deny, fs scope, network egress.

use profile_core::{
    enforce::{enforce_fs_read, enforce_network, enforce_tool},
    profile::CapabilityProfile,
};
use std::path::{Path, PathBuf};

fn profiles_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("protocol/v1/profiles")
}

#[test]
fn assessor_rtd_denies_edit_file() {
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    let d = enforce_tool(&p, "edit_file");
    assert!(d.is_deny(), "edit_file must be denied in assessor.rtd");
}

#[test]
fn assessor_rtd_allows_read_file_and_git_diff() {
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    assert!(enforce_tool(&p, "read_file").is_allow());
    assert!(enforce_tool(&p, "git_diff").is_allow());
    assert!(enforce_tool(&p, "evidence.capture").is_allow());
}

#[test]
fn assessor_rtd_denies_connector_writes() {
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    assert!(enforce_tool(&p, "connector.write.github.create_issue").is_deny());
    assert!(enforce_tool(&p, "connector.write.notion.append").is_deny());
}

#[test]
fn executor_code_allows_edit_but_denies_push() {
    let p = CapabilityProfile::load("executor.code@1.0.0", profiles_dir()).unwrap();
    assert!(enforce_tool(&p, "edit_file").is_allow());
    assert!(enforce_tool(&p, "write_file").is_allow());
    assert!(enforce_tool(&p, "git_push").is_deny());
    assert!(enforce_tool(&p, "deploy.vercel").is_deny());
}

#[test]
fn executor_release_denies_edit_file_but_allows_push() {
    let p = CapabilityProfile::load("executor.release@1.0.0", profiles_dir()).unwrap();
    assert!(enforce_tool(&p, "edit_file").is_deny());
    assert!(enforce_tool(&p, "git_push").is_allow());
    assert!(enforce_tool(&p, "git_tag").is_allow());
    assert!(enforce_tool(&p, "deploy.vercel").is_allow());
}

#[test]
fn assessor_denies_env_file_read() {
    // Create temp project with a .env file; path canonicalization applies.
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::write(root.join(".env.production"), "SECRET=xxx").unwrap();
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    let d = enforce_fs_read(&p, &root.join(".env.production"), root);
    assert!(
        d.is_deny(),
        "reading .env.production must be denied by deny_globs"
    );
}

#[test]
fn assessor_allows_reading_src_files() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    let d = enforce_fs_read(&p, &root.join("src/main.rs"), root);
    assert!(d.is_allow());
}

#[test]
fn assessor_network_allowlist_enforced() {
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    assert!(enforce_network(&p, "api.github.com", "GET").is_allow());
    assert!(enforce_network(&p, "evil.example.com", "GET").is_deny());
    assert!(
        enforce_network(&p, "api.github.com", "POST").is_deny(),
        "POST not allowed for assessor"
    );
}

#[test]
fn pm_profile_has_notion_but_not_sentry() {
    let p = CapabilityProfile::load("assessor.pm@1.0.0", profiles_dir()).unwrap();
    assert!(p.connectors.read.iter().any(|c| c == "notion"));
    assert!(!p.connectors.read.iter().any(|c| c == "sentry"));
    assert!(enforce_network(&p, "api.notion.com", "GET").is_allow());
    assert!(enforce_network(&p, "sentry.io", "GET").is_deny());
}

#[test]
fn _tempdir_doc() {
    let _ = Path::new("");
}
