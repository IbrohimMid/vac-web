//! Integration tests for profile inheritance + merge semantics.

use profile_core::profile::{CapabilityProfile, Class};
use std::path::PathBuf;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("protocol/v1/profiles")
}

#[test]
fn rtd_inherits_deny_floor_from_base() {
    let base = CapabilityProfile::load("assessor.base@1.0.0", dir()).unwrap();
    let rtd = CapabilityProfile::load("assessor.rtd@1.0.0", dir()).unwrap();
    // Every base deny must be present in rtd's merged deny list.
    for t in &base.tool_deny {
        assert!(
            rtd.tool_deny.contains(t),
            "rtd must inherit tool_deny entry '{t}' from base"
        );
    }
}

#[test]
fn rtd_inherits_shell_allowlist_exactly() {
    let base = CapabilityProfile::load("assessor.base@1.0.0", dir()).unwrap();
    let rtd = CapabilityProfile::load("assessor.rtd@1.0.0", dir()).unwrap();
    for e in &base.shell_allowlist {
        assert!(
            rtd.shell_allowlist.iter().any(|r| r.bin == e.bin),
            "rtd must have shell allow entry for '{}'",
            e.bin
        );
    }
}

#[test]
fn rtd_inherits_fs_deny_globs_from_base() {
    let base = CapabilityProfile::load("assessor.base@1.0.0", dir()).unwrap();
    let rtd = CapabilityProfile::load("assessor.rtd@1.0.0", dir()).unwrap();
    for g in &base.fs.deny_globs {
        assert!(
            rtd.fs.deny_globs.contains(g),
            "rtd must inherit deny_glob '{g}' from base"
        );
    }
}

#[test]
fn every_family_profile_stays_assessor_class() {
    let families = [
        "assessor.rtd@1.0.0",
        "assessor.pm@1.0.0",
        "assessor.ux@1.0.0",
        "assessor.frontend@1.0.0",
        "assessor.security@1.0.0",
        "assessor.reliability@1.0.0",
        "assessor.perf@1.0.0",
        "assessor.release@1.0.0",
        "assessor.launch@1.0.0",
        "assessor.qa@1.0.0",
        "assessor.docs@1.0.0",
        "assessor.growth@1.0.0",
    ];
    for f in families {
        let p = CapabilityProfile::load(f, dir()).unwrap();
        assert_eq!(p.class, Class::Assessor, "{} must be assessor class", f);
        assert_eq!(p.fs.write, "none", "{} must have fs.write=none", f);
        assert!(
            !p.git.commit && !p.git.push,
            "{} must have no git writes",
            f
        );
        assert!(
            p.connectors.write.is_empty(),
            "{} must have no connector writes",
            f
        );
    }
}

#[test]
fn executor_release_scoped_paths_not_empty() {
    let p = CapabilityProfile::load("executor.release@1.0.0", dir()).unwrap();
    assert_eq!(p.fs.write, "scoped_paths");
    assert!(
        !p.fs.scoped_paths.is_empty(),
        "executor.release must declare scoped_paths"
    );
    // Must include the canonical release-adjacent paths.
    let expected_any = ["CHANGELOG.md", "RELEASES.md", "docs/runbooks/**"];
    for ex in expected_any {
        assert!(
            p.fs.scoped_paths.iter().any(|s| s == ex),
            "executor.release scoped_paths should include {ex}"
        );
    }
}

#[test]
fn executor_code_cannot_push_despite_branching() {
    let p = CapabilityProfile::load("executor.code@1.0.0", dir()).unwrap();
    assert!(p.git.branch, "executor.code should allow branch creation");
    assert!(p.git.commit, "executor.code should allow local commit");
    assert!(!p.git.push, "executor.code must NOT allow git push");
    assert!(!p.git.tag, "executor.code must NOT allow git tag");
}

#[test]
fn pm_adds_notion_host_beyond_base() {
    let base = CapabilityProfile::load("assessor.base@1.0.0", dir()).unwrap();
    assert!(base.network_egress.host_allowlist.is_empty());
    let pm = CapabilityProfile::load("assessor.pm@1.0.0", dir()).unwrap();
    assert!(pm
        .network_egress
        .host_allowlist
        .iter()
        .any(|h| h == "api.notion.com"));
}

#[test]
fn profile_hash_is_deterministic() {
    let a = CapabilityProfile::raw_hash("assessor.base@1.0.0", dir()).unwrap();
    let b = CapabilityProfile::raw_hash("assessor.base@1.0.0", dir()).unwrap();
    assert_eq!(a, b, "hash must be deterministic across calls");
}

#[test]
fn different_profiles_produce_different_hashes() {
    let base = CapabilityProfile::raw_hash("assessor.base@1.0.0", dir()).unwrap();
    let rtd = CapabilityProfile::raw_hash("assessor.rtd@1.0.0", dir()).unwrap();
    assert_ne!(base, rtd);
}
