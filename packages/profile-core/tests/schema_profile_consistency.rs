//! S09-F06: ensure every field used in the shipped profile YAMLs is declared
//! in `capability_profile.schema.json`. Walks every nested block that the
//! schema marks `additionalProperties: false` (fs, git, connectors,
//! network_egress, resource_limits, audit) so adding a new field to a profile
//! requires updating both the YAML and the schema.

use serde_json::Value;
use std::path::PathBuf;

fn protocol_v1_dir() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("..")
        .join("protocol")
        .join("v1")
}

fn read_json(path: &PathBuf) -> Value {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse JSON {}: {}", path.display(), e))
}

fn read_yaml(path: &PathBuf) -> Value {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e));
    serde_yaml::from_str(&text).unwrap_or_else(|e| panic!("parse YAML {}: {}", path.display(), e))
}

fn schema_object_keys<'a>(schema: &'a Value, path: &[&str]) -> Vec<String> {
    let mut node = schema;
    for segment in path {
        node = &node[*segment];
    }
    node["properties"]
        .as_object()
        .unwrap_or_else(|| {
            panic!(
                "schema node {:?}.properties must be an object",
                path.join(".")
            )
        })
        .keys()
        .cloned()
        .collect()
}

const NESTED_CLOSED_BLOCKS: &[&str] = &[
    "fs",
    "git",
    "connectors",
    "network_egress",
    "resource_limits",
    "audit",
];

#[test]
fn shipped_profile_fields_are_declared_in_schema() {
    let v1 = protocol_v1_dir();
    let schema = read_json(&v1.join("capability_profile.schema.json"));
    let top_keys = schema_object_keys(&schema, &[]);

    let profiles_dir = v1.join("profiles");
    let mut profile_count = 0usize;
    for entry in std::fs::read_dir(&profiles_dir).expect("read profiles dir") {
        let entry = entry.expect("read profile entry");
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("yaml") {
            continue;
        }
        profile_count += 1;
        let yaml = read_yaml(&path);
        let obj = yaml
            .as_object()
            .unwrap_or_else(|| panic!("profile {:?} root must be a mapping", path.file_name()));

        for k in obj.keys() {
            assert!(
                top_keys.iter().any(|t| t == k),
                "profile {:?} has top-level field `{}` not declared in capability_profile.schema.json#/properties",
                path.file_name(),
                k
            );
        }

        for block in NESTED_CLOSED_BLOCKS {
            let Some(nested_val) = obj.get(*block) else {
                continue;
            };
            let Some(nested_obj) = nested_val.as_object() else {
                continue;
            };
            let allowed = schema_object_keys(&schema, &["properties", block]);
            for k in nested_obj.keys() {
                assert!(
                    allowed.iter().any(|t| t == k),
                    "profile {:?} has `{}.{}` not declared in capability_profile.schema.json#/properties/{}/properties",
                    path.file_name(),
                    block,
                    k,
                    block
                );
            }
        }
    }
    assert!(
        profile_count >= 16,
        "expected to scan at least 16 shipped profile YAMLs, found {}",
        profile_count
    );
}

#[test]
fn schema_declares_deny_globs_and_allowed_agent_kinds() {
    // Regression guard for S09-F06: these two fields are runtime-enforced
    // (see profile-core::enforce_agent_kind, profile-core::glob_deny_match)
    // and used by every shipped profile, so the schema MUST declare them.
    let schema = read_json(&protocol_v1_dir().join("capability_profile.schema.json"));
    assert!(
        schema["properties"]["allowed_agent_kinds"].is_object(),
        "schema must declare top-level `allowed_agent_kinds`"
    );
    assert!(
        schema["properties"]["fs"]["properties"]["deny_globs"].is_object(),
        "schema must declare `fs.deny_globs`"
    );
}

#[test]
fn schema_declares_executor_migration_safety_knobs() {
    // Regression guard for S09-F06: executor.migration uses these four
    // profile-level invariants. They must remain declared in the schema
    // (even if runtime enforcement is partial / advisory) so the contract
    // stays explicit.
    let schema = read_json(&protocol_v1_dir().join("capability_profile.schema.json"));
    for key in [
        "required_signers",
        "require_dry_run_first",
        "require_reversibility_proof",
        "require_maintenance_window",
    ] {
        assert!(
            schema["properties"][key].is_object(),
            "schema must declare top-level `{}`",
            key
        );
    }
    assert!(
        schema["properties"]["audit"]["properties"]["subsystem_tag"].is_object(),
        "schema must declare `audit.subsystem_tag`"
    );
}
