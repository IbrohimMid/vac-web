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
    sha256_hex_canonical_excluding(value, &[])
}

/// Same as [`sha256_hex_canonical`] but strips object keys whose name
/// matches any entry in `top_level_drop` from the **top-level** object
/// before hashing. Used to compute the
/// [`crate::agent_runtime::acp::ObservedToolActivity::approval_tool_call_hash`]
/// — a hash that intentionally ignores runtime-only fields
/// (`toolCallId`, `status`, `rawOutput`) so a `tool_call_update`
/// hashes to the same value as the original
/// `session/request_permission.params.toolCall` even when the agent
/// rotates the call id or carries different lifecycle fields.
///
/// Stripping is top-level only; nested occurrences of the same key
/// are preserved (a nested `status` field belongs to whatever inner
/// schema declared it).
pub fn sha256_hex_canonical_excluding(value: &Value, top_level_drop: &[&str]) -> String {
    let stripped = match value {
        Value::Object(map) if !top_level_drop.is_empty() => {
            let mut copy = map.clone();
            for k in top_level_drop {
                copy.remove(*k);
            }
            Value::Object(copy)
        }
        other => other.clone(),
    };
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
    let canonical = canon(&stripped);
    let bytes = serde_json::to_vec(&canonical).unwrap_or_default();
    let mut h = Sha256::new();
    h.update(&bytes);
    hex::encode(h.finalize())
}

/// Top-level fields excluded from `args_hash` /
/// `approval_tool_call_hash` so the value stays stable across
/// `session/request_permission` → `tool_call_update` transitions
/// even when the agent rotates ids or adds lifecycle metadata.
pub const TOOL_CALL_HASH_DROP_FIELDS: &[&str] = &["toolCallId", "status", "rawOutput"];

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

    #[test]
    fn excluding_strips_only_top_level() {
        // Top-level toolCallId/status/rawOutput dropped; nested keys
        // of the same name preserved.
        let a = json!({
            "toolCallId": "tc_perm",
            "status": "pending",
            "rawOutput": "should be ignored",
            "kind": "edit",
            "title": "X",
            "content": [{ "status": "ignored?" }]
        });
        let b = json!({
            "toolCallId": "tc_after",
            "status": "completed",
            "rawOutput": "different",
            "kind": "edit",
            "title": "X",
            "content": [{ "status": "ignored?" }]
        });
        assert_eq!(
            sha256_hex_canonical_excluding(&a, TOOL_CALL_HASH_DROP_FIELDS),
            sha256_hex_canonical_excluding(&b, TOOL_CALL_HASH_DROP_FIELDS),
        );

        // Nested status difference still matters — drop is top-level only.
        let c = json!({
            "kind": "edit",
            "content": [{ "status": "different" }]
        });
        let d = json!({
            "kind": "edit",
            "content": [{ "status": "other" }]
        });
        assert_ne!(
            sha256_hex_canonical_excluding(&c, TOOL_CALL_HASH_DROP_FIELDS),
            sha256_hex_canonical_excluding(&d, TOOL_CALL_HASH_DROP_FIELDS),
        );
    }
}
