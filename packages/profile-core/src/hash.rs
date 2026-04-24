//! Deterministic hashing helpers for profile + schema manifests.

use anyhow::Result;
use sha2::{Digest, Sha256};
use std::path::Path;

pub fn sha256_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("sha256:{}", hex::encode(h.finalize()))
}

pub fn sha256_file(path: impl AsRef<Path>) -> Result<String> {
    let bytes = std::fs::read(path.as_ref())?;
    Ok(sha256_bytes(&bytes))
}

/// Hash JSON over canonical form: sorted keys, no whitespace, UTF-8.
/// Matches the Python `manifest-verify.sh` implementation.
pub fn sha256_canonical_json(value: &serde_json::Value) -> String {
    let canon = canonical_json(value);
    sha256_bytes(canon.as_bytes())
}

fn canonical_json(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Object(m) => {
            let mut entries: Vec<_> = m.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            let parts: Vec<String> = entries
                .into_iter()
                .map(|(k, v)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap(),
                        canonical_json(v)
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        serde_json::Value::Array(arr) => {
            let parts: Vec<String> = arr.iter().map(canonical_json).collect();
            format!("[{}]", parts.join(","))
        }
        _ => serde_json::to_string(v).unwrap(),
    }
}
