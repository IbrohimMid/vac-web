//! Verify that Rust `hash::sha256_canonical_json` matches the Python
//! `manifest-verify.sh` output for the real schema files. If this test ever
//! fails, the two implementations have drifted and CI may allow bad manifests.

use profile_core::hash::{sha256_bytes, sha256_canonical_json};
use std::path::PathBuf;

fn schemas_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("protocol/v1")
}

#[test]
fn canonical_json_matches_manifest_hashes() {
    let root = schemas_dir();
    let manifest_raw = std::fs::read_to_string(root.join("MANIFEST.json")).unwrap();
    let manifest: serde_json::Value = serde_json::from_str(&manifest_raw).unwrap();
    let schemas = manifest["schemas"].as_object().unwrap();

    let mut checked = 0;
    for (rel, expected) in schemas {
        let path = root.join(rel);
        let content: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let actual = sha256_canonical_json(&content);
        assert_eq!(
            actual,
            expected.as_str().unwrap(),
            "schema hash mismatch for {rel}"
        );
        checked += 1;
    }
    assert!(checked >= 17, "expected at least 17 schemas, got {checked}");
}

#[test]
fn canonical_json_is_order_independent() {
    let a = serde_json::json!({"b": 1, "a": 2});
    let b = serde_json::json!({"a": 2, "b": 1});
    assert_eq!(sha256_canonical_json(&a), sha256_canonical_json(&b));
}

#[test]
fn canonical_json_differs_on_value_change() {
    let a = serde_json::json!({"a": 1});
    let b = serde_json::json!({"a": 2});
    assert_ne!(sha256_canonical_json(&a), sha256_canonical_json(&b));
}

#[test]
fn raw_bytes_hash_is_stable() {
    let h1 = sha256_bytes(b"hello world");
    let h2 = sha256_bytes(b"hello world");
    assert_eq!(h1, h2);
    assert_eq!(
        h1,
        "sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
}
