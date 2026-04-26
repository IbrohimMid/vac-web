//! Handoff payload validation.
//!
//! Validates inbound `handoff.create` payloads before pin computation and
//! registry insertion. All validation is bridge-owned.

use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ValidationError {
    pub code: &'static str,
    pub message: String,
}

impl ValidationError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn str_opt<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|v| v.as_str())
}

fn arr_of_str(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|e| e.as_str().map(|s| s.to_owned()))
                .collect()
        })
        .unwrap_or_default()
}

pub fn validate_handoff_create(payload: &Value) -> Result<(), Vec<ValidationError>> {
    let mut errors = Vec::new();

    let created_by = str_opt(payload, "created_by").unwrap_or("");
    if created_by.trim().is_empty() {
        errors.push(ValidationError::new(
            "handoff.invalid_payload",
            "created_by is required",
        ));
    }

    let accepted_finding_ids = arr_of_str(payload, "accepted_finding_ids");
    if accepted_finding_ids.is_empty() {
        errors.push(ValidationError::new(
            "handoff.invalid_payload",
            "accepted_finding_ids must be non-empty",
        ));
    }

    let tasks = payload.get("tasks").and_then(|v| v.as_array()).cloned();
    if tasks.is_none() || tasks.as_ref().map_or(true, |t| t.is_empty()) {
        errors.push(ValidationError::new(
            "handoff.invalid_payload",
            "tasks must be non-empty",
        ));
    }

    let tasks = match tasks {
        Some(t) => t,
        None => return Err(errors),
    };

    for (i, task) in tasks.iter().enumerate() {
        let task_id = i + 1;

        let sfids = arr_of_str(task, "source_finding_ids");
        if sfids.is_empty() {
            errors.push(ValidationError::new(
                "handoff.invalid_payload",
                format!("task {task_id} must have at least one source_finding_id"),
            ));
        }

        let evidence = task
            .get("evidence_refs")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        if evidence.is_empty() {
            errors.push(ValidationError::new(
                "handoff.invalid_payload",
                format!("task {task_id} must have at least one evidence_ref"),
            ));
        }

        let touches = arr_of_str(task, "touches_paths");

        let has_evidence_uri = evidence.iter().any(|e| {
            e.get("uri")
                .and_then(|u| u.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false)
        });

        if touches.is_empty() && !has_evidence_uri {
            errors.push(ValidationError::new(
                "handoff.invalid_payload",
                format!("task {task_id} must have touches_paths or evidence_refs with uri"),
            ));
        }
    }

    let target = payload.get("target");
    if target.is_none() {
        errors.push(ValidationError::new(
            "handoff.invalid_payload",
            "target is required",
        ));
    } else if let Some(t) = target {
        let profile_id = str_opt(t, "executor_profile_id")
            .or_else(|| str_opt(t, "executorProfileId"))
            .or_else(|| str_opt(t, "profile_id"))
            .unwrap_or("");
        if profile_id.trim().is_empty() {
            errors.push(ValidationError::new(
                "handoff.invalid_payload",
                "target.executor_profile_id is required",
            ));
        }
    }

    if let Some(pin) = payload.get("pin") {
        let policy = str_opt(pin, "invalidation_policy")
            .or_else(|| str_opt(pin, "invalidationPolicy"))
            .or_else(|| str_opt(pin, "policy"))
            .unwrap_or("strict");
        if policy != "strict" && policy != "lenient" {
            errors.push(ValidationError::new(
                "handoff.invalid_payload",
                "pin.invalidation_policy must be 'strict' or 'lenient'",
            ));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_payload(overrides: serde_json::Map<String, Value>) -> Value {
        let mut base = serde_json::json!({
            "created_by": "alice",
            "accepted_finding_ids": ["f1"],
            "tasks": [{
                "id": "task_1",
                "title": "Do thing",
                "source_finding_ids": ["f1"],
                "evidence_refs": [{"id": "ev1", "uri": "file:///workspace/src/a.ts"}],
                "touches_paths": [],
                "requires_approval_per_step": false
            }],
            "target": {
                "kind": "dispatch_to_local_vac",
                "executor_profile_id": "executor.code@1.0.0"
            },
            "pin": {
                "invalidation_policy": "strict"
            }
        });
        let obj = base.as_object_mut().unwrap();
        for (k, v) in overrides {
            obj.insert(k, v);
        }
        base
    }

    #[test]
    fn test_valid_payload() {
        assert!(validate_handoff_create(&mk_payload(serde_json::Map::new())).is_ok());
    }

    #[test]
    fn test_empty_created_by() {
        let mut overrides = serde_json::Map::new();
        overrides.insert("created_by".to_string(), serde_json::json!("   "));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_err());
    }

    #[test]
    fn test_empty_findings() {
        let mut overrides = serde_json::Map::new();
        overrides.insert("accepted_finding_ids".to_string(), serde_json::json!([]));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_err());
    }

    #[test]
    fn test_empty_tasks() {
        let mut overrides = serde_json::Map::new();
        overrides.insert("tasks".to_string(), serde_json::json!([]));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_err());
    }

    #[test]
    fn test_task_no_source_finding_ids() {
        let task = serde_json::json!({
            "id": "task_1",
            "title": "Do thing",
            "source_finding_ids": [],
            "evidence_refs": [{"id": "ev1", "uri": "file:///workspace/src/a.ts"}],
            "touches_paths": [],
            "requires_approval_per_step": false
        });
        let mut overrides = serde_json::Map::new();
        overrides.insert("tasks".to_string(), serde_json::json!([task]));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_err());
    }

    #[test]
    fn test_task_no_evidence_refs() {
        let task = serde_json::json!({
            "id": "task_1",
            "title": "Do thing",
            "source_finding_ids": ["f1"],
            "evidence_refs": [],
            "touches_paths": [],
            "requires_approval_per_step": false
        });
        let mut overrides = serde_json::Map::new();
        overrides.insert("tasks".to_string(), serde_json::json!([task]));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_err());
    }

    #[test]
    fn test_task_evidence_uri_suffices_for_path() {
        let task = serde_json::json!({
            "id": "task_1",
            "title": "Do thing",
            "source_finding_ids": ["f1"],
            "evidence_refs": [{"id": "ev1", "uri": "file:///workspace/src/a.ts"}],
            "touches_paths": [],
            "requires_approval_per_step": false
        });
        let mut overrides = serde_json::Map::new();
        overrides.insert("tasks".to_string(), serde_json::json!([task]));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_ok());
    }

    #[test]
    fn test_task_touches_paths_with_evidence_suffices() {
        let task = serde_json::json!({
            "id": "task_1",
            "title": "Do thing",
            "source_finding_ids": ["f1"],
            "evidence_refs": [{"id": "ev1", "uri": "file:///workspace/src/a.ts"}],
            "touches_paths": ["src/a.ts"],
            "requires_approval_per_step": false
        });
        let mut overrides = serde_json::Map::new();
        overrides.insert("tasks".to_string(), serde_json::json!([task]));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_ok());
    }

    #[test]
    fn test_task_empty_evidence_rejected() {
        let task = serde_json::json!({
            "id": "task_1",
            "title": "Do thing",
            "source_finding_ids": ["f1"],
            "evidence_refs": [],
            "touches_paths": ["src/a.ts"],
            "requires_approval_per_step": false
        });
        let mut overrides = serde_json::Map::new();
        overrides.insert("tasks".to_string(), serde_json::json!([task]));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_err());
    }

    #[test]
    fn test_invalid_policy() {
        let mut pin_overrides = serde_json::Map::new();
        pin_overrides.insert("invalidation_policy".to_string(), serde_json::json!("bad"));
        let mut overrides = serde_json::Map::new();
        overrides.insert("pin".to_string(), serde_json::json!(pin_overrides));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_err());
    }

    #[test]
    fn test_lenient_policy_ok() {
        let mut pin_overrides = serde_json::Map::new();
        pin_overrides.insert(
            "invalidation_policy".to_string(),
            serde_json::json!("lenient"),
        );
        let mut overrides = serde_json::Map::new();
        overrides.insert("pin".to_string(), serde_json::json!(pin_overrides));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_ok());
    }

    #[test]
    fn test_missing_executor_profile_id() {
        let mut target_overrides = serde_json::Map::new();
        target_overrides.insert(
            "kind".to_string(),
            serde_json::json!("dispatch_to_local_vac"),
        );
        let mut overrides = serde_json::Map::new();
        overrides.insert("target".to_string(), serde_json::json!(target_overrides));
        assert!(validate_handoff_create(&mk_payload(overrides)).is_err());
    }
}
