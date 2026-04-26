//! Canonical-JSON sha256 helper used by the X.5c.1 audit row and
//! the X.5c.2 `ObservedToolActivity` DTO.
//!
//! "Canonical" means: object keys sorted alphabetically, no
//! superfluous whitespace, recursively. Two payloads that are
//! semantically equal but differ only in key order MUST hash to the
//! same digest, so the X.5c.1 `args_hash` audit field is joinable
//! with the X.5c.2 `approval_tool_call_hash` field byte-for-byte.

use serde_json::Value;
use sha2::{Digest, Sha256};

/// Sha256-hex digest over a stable canonical JSON form of `value`.
///
/// Sorted-key recursion via `BTreeMap` produces the canonical form;
/// `serde_json::to_vec` of the canonical form is fed to Sha256.
pub fn sha256_hex_canonical(value: &Value) -> String {
    fn canon(v: &Value) -> Value {
        match v {
            Value::Object(map) => {
                let mut sorted: std::collections::BTreeMap<String, Value> = Default::default();
                for (k, val) in map {
                    sorted.insert(k.clone(), canon(val));
                }
                serde_json::to_value(sorted).unwrap_or(Value::Null)
            }
            Value::Array(arr) => Value::Array(arr.iter().map(canon).collect()),
            other => other.clone(),
        }
    }
    let canonical = canon(value);
    let bytes = serde_json::to_vec(&canonical).unwrap_or_default();
    let mut h = Sha256::new();
    h.update(&bytes);
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn order_independent() {
        let a = json!({ "a": 1, "b": [{"x": 1, "y": 2}], "c": null });
        let b = json!({ "c": null, "b": [{"y": 2, "x": 1}], "a": 1 });
        assert_eq!(sha256_hex_canonical(&a), sha256_hex_canonical(&b));
    }

    #[test]
    fn type_distinguishing() {
        assert_ne!(
            sha256_hex_canonical(&json!({"x": 1})),
            sha256_hex_canonical(&json!({"x": "1"})),
        );
    }

    #[test]
    fn null_distinguishing() {
        assert_ne!(
            sha256_hex_canonical(&Value::Null),
            sha256_hex_canonical(&json!({})),
        );
    }
}
