//! Defensive redaction pass run before an event is persisted.
//!
//! The bridge already redacts terminal output and emits secrets
//! through bounded events upstream. This pass is a *secondary*
//! filter that scrubs payload fields whose key name or string
//! shape strongly resembles a credential. It exists so that a
//! future event variant that ships a token by accident does not
//! silently land in `events.jsonl`.
//!
//! `redact_event_payload` reports the strongest action it had to
//! take as a [`RedactionLabel`]:
//!
//! - [`RedactionLabel::Safe`] — payload was left untouched.
//! - [`RedactionLabel::Bounded`] — at least one field was replaced
//!   with `"<redacted>"` or `"<truncated:N>"`. Structure preserved.
//! - [`RedactionLabel::Dropped`] — at least one value was so large
//!   we couldn't even keep a truncated marker for it and replaced
//!   it with `null`. Currently only reachable in [`RedactionMode::Strict`].
//!
//! The persistence sink stamps that label on the corresponding
//! [`super::model::PersistedServerEvent`] so the resume / replay path
//! can render an honest "this content was redacted" affordance to the
//! user instead of pretending nothing happened.

use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

use super::model::RedactionLabel;

/// Scrubbing intensity. `Standard` is the default for replayable
/// transcript-shaped events. `Strict` additionally caps very large
/// strings (raw terminal stdout, debug frames) so a single 200 MiB
/// blob can't bloat `events.jsonl`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RedactionMode {
    Standard,
    Strict,
}

/// Lower-case JSON object keys whose value is unconditionally
/// replaced with `"<redacted>"`.
const SENSITIVE_KEY_NAMES: &[&str] = &[
    "authorization",
    "auth",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "api_key",
    "apikey",
    "secret",
    "password",
    "passwd",
    "session_token",
    "cookie",
    "set-cookie",
    "x-api-key",
];

/// Strict mode caps strings longer than this many bytes by replacing
/// them with a `<truncated:N>` marker (still labelled `Bounded`).
const STRICT_MAX_STRING_BYTES: usize = 8 * 1024;

/// Strict mode hard limit. A single string above this size is
/// considered unrepresentable for replay (debug dump, full file
/// snapshot, etc.) and is replaced with `Value::Null`. The event is
/// then labelled [`RedactionLabel::Dropped`] so the UI can show "this
/// payload was too large to keep" rather than silently rendering
/// garbage.
const STRICT_DROP_STRING_BYTES: usize = 1024 * 1024;

fn secret_value_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Common token shapes: Bearer ..., sk-..., ghp_..., xoxb-...,
        // xoxa-..., xoxp-..., AWS-style 20+ alnum chunks. Anchored
        // on word boundaries so plain prose like "the token rotates
        // weekly" does NOT match.
        Regex::new(r"(?i)\b(bearer\s+|sk-|ghp_|xoxb-|xoxa-|xoxp-|aws[a-z0-9]*=)[A-Za-z0-9\-_=]{8,}")
            .expect("persistence redact regex must compile")
    })
}

/// Replace any sensitive value inside `payload` with `"<redacted>"`
/// (or `null` when an entire string is too large to keep). Operates
/// in place; structure is preserved so the resume-replay path can
/// still address the field by JSON pointer.
///
/// The return value reports the *strongest* action taken on this
/// payload so the persistence sink can stamp an honest label on the
/// row.
#[must_use = "the returned RedactionLabel must be persisted alongside the payload"]
pub fn redact_event_payload(payload: &mut Value, mode: RedactionMode) -> RedactionLabel {
    let mut label = RedactionLabel::Safe;
    redact_value(payload, mode, &mut label);
    label
}

fn redact_value(value: &mut Value, mode: RedactionMode, label: &mut RedactionLabel) {
    match value {
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                let key_lc = k.to_ascii_lowercase();
                if SENSITIVE_KEY_NAMES.iter().any(|name| key_lc == *name) {
                    *v = Value::String("<redacted>".to_string());
                    promote(label, RedactionLabel::Bounded);
                } else {
                    redact_value(v, mode, label);
                }
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                redact_value(v, mode, label);
            }
        }
        Value::String(s) => {
            if secret_value_re().is_match(s) {
                *s = "<redacted>".to_string();
                promote(label, RedactionLabel::Bounded);
                return;
            }
            if matches!(mode, RedactionMode::Strict) {
                if s.len() > STRICT_DROP_STRING_BYTES {
                    let dropped_len = s.len();
                    *value = Value::Null;
                    promote(label, RedactionLabel::Dropped);
                    // Avoid an unused-binding warning on debug builds.
                    let _ = dropped_len;
                    return;
                }
                if s.len() > STRICT_MAX_STRING_BYTES {
                    *s = format!("<truncated:{}>", s.len());
                    promote(label, RedactionLabel::Bounded);
                }
            }
        }
        _ => {}
    }
}

/// Lift `label` to at least `candidate`. Ordering: `Safe < Bounded < Dropped`.
fn promote(label: &mut RedactionLabel, candidate: RedactionLabel) {
    let cur = rank(*label);
    let new = rank(candidate);
    if new > cur {
        *label = candidate;
    }
}

fn rank(label: RedactionLabel) -> u8 {
    match label {
        RedactionLabel::Safe => 0,
        RedactionLabel::Bounded => 1,
        RedactionLabel::Dropped => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_strips_token_keys() {
        let mut payload = serde_json::json!({
            "ok": "value",
            "token": "abc123",
            "headers": { "authorization": "Bearer ZZZ" },
            "list": [{ "api_key": "xyz" }]
        });
        let label = redact_event_payload(&mut payload, RedactionMode::Standard);
        assert_eq!(payload["token"], serde_json::json!("<redacted>"));
        assert_eq!(
            payload["headers"]["authorization"],
            serde_json::json!("<redacted>")
        );
        assert_eq!(
            payload["list"][0]["api_key"],
            serde_json::json!("<redacted>")
        );
        // Non-sensitive keys are untouched.
        assert_eq!(payload["ok"], serde_json::json!("value"));
        assert_eq!(label, RedactionLabel::Bounded);
    }

    #[test]
    fn redact_replaces_bearer_string_in_value() {
        let mut payload = serde_json::json!({"note": "found Bearer abcdef0123456 in logs"});
        let label = redact_event_payload(&mut payload, RedactionMode::Standard);
        assert_eq!(payload["note"], serde_json::json!("<redacted>"));
        assert_eq!(label, RedactionLabel::Bounded);
    }

    #[test]
    fn redact_strict_caps_large_strings() {
        let big = "x".repeat(STRICT_MAX_STRING_BYTES + 100);
        let mut payload = serde_json::json!({"stdout": big});
        let label = redact_event_payload(&mut payload, RedactionMode::Strict);
        let v = payload["stdout"].as_str().unwrap();
        assert!(v.starts_with("<truncated:"));
        assert_eq!(label, RedactionLabel::Bounded);
    }

    #[test]
    fn redact_standard_keeps_short_prose_intact() {
        let mut payload = serde_json::json!({"note": "the token rotates weekly per ops policy"});
        let label = redact_event_payload(&mut payload, RedactionMode::Standard);
        assert_eq!(
            payload["note"],
            serde_json::json!("the token rotates weekly per ops policy")
        );
        assert_eq!(label, RedactionLabel::Safe);
    }

    #[test]
    fn redact_safe_label_for_unmodified_payload() {
        let mut payload = serde_json::json!({
            "type": "transcript.delta",
            "chunk": "hello world",
            "meta": { "seq": 7 }
        });
        let original = payload.clone();
        let label = redact_event_payload(&mut payload, RedactionMode::Standard);
        assert_eq!(label, RedactionLabel::Safe);
        assert_eq!(payload, original);
    }

    #[test]
    fn redact_strict_drops_huge_strings_to_null() {
        let huge = "y".repeat(STRICT_DROP_STRING_BYTES + 16);
        let mut payload = serde_json::json!({ "blob": huge });
        let label = redact_event_payload(&mut payload, RedactionMode::Strict);
        // Whole string was unrepresentable — replaced with null and
        // labelled Dropped so the UI can show a clear marker.
        assert!(payload["blob"].is_null());
        assert_eq!(label, RedactionLabel::Dropped);
    }

    #[test]
    fn redact_label_promotes_to_strongest_action() {
        // Mix Bounded (truncated) + Dropped in the same payload.
        let huge = "z".repeat(STRICT_DROP_STRING_BYTES + 1);
        let big = "x".repeat(STRICT_MAX_STRING_BYTES + 1);
        let mut payload = serde_json::json!({
            "truncated": big,
            "dropped": huge,
            "safe": "ok"
        });
        let label = redact_event_payload(&mut payload, RedactionMode::Strict);
        assert!(payload["truncated"]
            .as_str()
            .unwrap()
            .starts_with("<truncated:"));
        assert!(payload["dropped"].is_null());
        assert_eq!(payload["safe"], serde_json::json!("ok"));
        // Strongest action wins.
        assert_eq!(label, RedactionLabel::Dropped);
    }

    #[test]
    fn redact_standard_does_not_drop_huge_strings() {
        // Standard mode never reaches the Dropped branch so the
        // resume-replay path keeps full transcript fidelity.
        let huge = "q".repeat(STRICT_DROP_STRING_BYTES + 1);
        let mut payload = serde_json::json!({ "blob": huge.clone() });
        let label = redact_event_payload(&mut payload, RedactionMode::Standard);
        assert_eq!(payload["blob"].as_str().unwrap().len(), huge.len());
        assert_eq!(label, RedactionLabel::Safe);
    }
}
