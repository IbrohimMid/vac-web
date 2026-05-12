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

// --- AUDIT-015: project_and_docs read scope ---

#[test]
fn project_and_docs_denies_etc_passwd() {
    // Even though the assessor profile uses fs.read == "project_and_docs",
    // an arbitrary system path like /etc/passwd must be denied as out of
    // scope (project root is a tempdir; docs_roots is empty by default).
    let tmp = tempfile::tempdir().unwrap();
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    let d = enforce_fs_read(&p, Path::new("/etc/passwd"), tmp.path());
    assert!(
        d.is_deny(),
        "/etc/passwd must be denied for project_and_docs without docs_roots"
    );
    if let profile_core::Decision::Deny { code, .. } = d {
        assert_eq!(code, "profile.fs_out_of_scope");
    }
}

#[test]
fn project_and_docs_denies_ssh_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    // Use a path that almost certainly exists somewhere outside the project
    // (we synthesize one under a separate tempdir to be portable).
    let outside_home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(outside_home.path().join(".ssh")).unwrap();
    std::fs::write(outside_home.path().join(".ssh/id_rsa"), "-----BEGIN-----").unwrap();
    let d = enforce_fs_read(&p, &outside_home.path().join(".ssh/id_rsa"), tmp.path());
    assert!(d.is_deny(), ".ssh/id_rsa outside project must be denied");
}

#[test]
fn project_and_docs_denies_parent_traversal_outside_project() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("project");
    let sibling = tmp.path().join("sibling");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(&sibling).unwrap();
    std::fs::write(sibling.join("secret.txt"), "x").unwrap();
    let p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    // sibling is a real directory next to project_root and is not under
    // it after canonicalization; must be denied.
    let d = enforce_fs_read(&p, &sibling.join("secret.txt"), &project);
    assert!(d.is_deny(), "sibling dir read must be denied");
}

#[test]
fn project_and_docs_allows_path_under_configured_docs_root() {
    use profile_core::profile::CapabilityProfile;
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("project");
    let docs = tmp.path().join("shared-docs");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::write(docs.join("spec.md"), "# spec").unwrap();

    // Build a profile inheriting assessor.rtd but with docs_roots set
    // to the synthetic docs directory.
    let mut p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    p.fs.docs_roots.push(docs.to_string_lossy().into());
    let d = enforce_fs_read(&p, &docs.join("spec.md"), &project);
    assert!(
        d.is_allow(),
        "file under configured docs_root must be allowed"
    );
}

#[test]
fn project_and_docs_still_applies_deny_globs_under_docs_root() {
    use profile_core::profile::CapabilityProfile;
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("project");
    let docs = tmp.path().join("shared-docs");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::write(docs.join(".env.production"), "DB_PASS=x").unwrap();

    let mut p = CapabilityProfile::load("assessor.rtd@1.0.0", profiles_dir()).unwrap();
    p.fs.docs_roots.push(docs.to_string_lossy().into());
    // .env* is denied by the base deny_globs; must still deny even though
    // the path sits under an allowed docs_root.
    let d = enforce_fs_read(&p, &docs.join(".env.production"), &project);
    assert!(
        d.is_deny(),
        "deny_globs must still trump docs_root allowance"
    );
}

#[test]
fn _tempdir_doc() {
    let _ = Path::new("");
}
