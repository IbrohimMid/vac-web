//! ACP `fs/read_text_file` and `fs/write_text_file` client method
//! handlers. Enforces the session's capability profile before
//! performing any I/O.

use anyhow::Result;
use profile_core::enforce::{enforce_fs_read, enforce_fs_write, Decision};
use profile_core::profile::CapabilityProfile;
#[cfg(test)]
use profile_core::profile::FsConfig;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::info;

/// Context for fs request handling, built once at session spawn from
/// the loaded profile and spawn options.
#[derive(Clone)]
pub struct FsHandlerContext {
    pub project_root: PathBuf,
    pub profile: CapabilityProfile,
    pub session_id: String,
    pub agent_id: String,
    pub audit: Option<Arc<crate::audit::AuditFacility>>,
}

#[derive(Debug)]
pub enum FsError {
    MissingParam(&'static str),
    ProfileDenied { reason: String, code: String },
    SizeExceeded { actual: u64, max: usize },
    IoError(std::io::Error),
    NotUtf8,
    MethodNotFound(String),
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FsError::MissingParam(p) => write!(f, "missing required param: {p}"),
            FsError::ProfileDenied { reason, .. } => write!(f, "denied: {reason}"),
            FsError::SizeExceeded { actual, max } => {
                write!(f, "size {actual} exceeds limit {max}")
            }
            FsError::IoError(e) => write!(f, "io: {e}"),
            FsError::NotUtf8 => write!(f, "file is not valid UTF-8"),
            FsError::MethodNotFound(m) => write!(f, "unknown fs method: {m}"),
        }
    }
}

impl FsError {
    pub fn jsonrpc_code(&self) -> i64 {
        match self {
            FsError::MissingParam(_) | FsError::SizeExceeded { .. } | FsError::NotUtf8 => -32602,
            FsError::ProfileDenied { .. } | FsError::IoError(_) | FsError::MethodNotFound(_) => {
                -32603
            }
        }
    }

    pub fn jsonrpc_data(&self) -> Value {
        match self {
            FsError::ProfileDenied { code, reason } => {
                json!({ "code": code, "reason": reason })
            }
            _ => json!({ "detail": self.to_string() }),
        }
    }
}

fn resolve_path(raw: &str, project_root: &Path) -> PathBuf {
    let p = Path::new(raw);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        project_root.join(p)
    }
}

pub async fn handle_fs_read(ctx: &FsHandlerContext, params: &Value) -> Result<Value, FsError> {
    let raw_path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or(FsError::MissingParam("path"))?;

    let resolved = resolve_path(raw_path, &ctx.project_root);

    match enforce_fs_read(&ctx.profile, &resolved, &ctx.project_root) {
        Decision::Allow => {}
        Decision::Deny { reason, code } => {
            return Err(FsError::ProfileDenied {
                reason,
                code: code.to_string(),
            });
        }
    }

    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(FsError::IoError)?;
    if meta.len() > ctx.profile.fs.max_bytes_per_read as u64 {
        return Err(FsError::SizeExceeded {
            actual: meta.len(),
            max: ctx.profile.fs.max_bytes_per_read,
        });
    }

    let bytes = tokio::fs::read(&resolved).await.map_err(FsError::IoError)?;
    let content = String::from_utf8(bytes).map_err(|_| FsError::NotUtf8)?;

    if let Some(audit) = &ctx.audit {
        audit.log(
            &ctx.session_id,
            "fs.read",
            bridge_core::AuditSeverity::Info,
            json!({
                "agent_id": ctx.agent_id,
                "path": raw_path,
                "resolved": resolved.display().to_string(),
                "bytes": content.len(),
            }),
        );
    }

    info!(
        session = %ctx.session_id,
        path = raw_path,
        bytes = content.len(),
        "fs/read_text_file served"
    );

    Ok(json!({ "content": content }))
}

pub async fn handle_fs_write(
    ctx: &FsHandlerContext,
    params: &Value,
) -> Result<(Value, Option<FsWriteMeta>), FsError> {
    let raw_path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or(FsError::MissingParam("path"))?;
    let content = params
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or(FsError::MissingParam("content"))?;

    let resolved = resolve_path(raw_path, &ctx.project_root);

    match enforce_fs_write(&ctx.profile, &resolved, &ctx.project_root) {
        Decision::Allow => {}
        Decision::Deny { reason, code } => {
            return Err(FsError::ProfileDenied {
                reason,
                code: code.to_string(),
            });
        }
    }

    let max_write = ctx.profile.fs.max_bytes_per_write;
    if max_write > 0 && content.len() > max_write {
        return Err(FsError::SizeExceeded {
            actual: content.len() as u64,
            max: max_write,
        });
    }

    let old_content = tokio::fs::read_to_string(&resolved).await.ok();

    if let Some(parent) = resolved.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(FsError::IoError)?;
    }
    tokio::fs::write(&resolved, content)
        .await
        .map_err(FsError::IoError)?;

    if let Some(audit) = &ctx.audit {
        audit.log(
            &ctx.session_id,
            "fs.write",
            bridge_core::AuditSeverity::Info,
            json!({
                "agent_id": ctx.agent_id,
                "path": raw_path,
                "resolved": resolved.display().to_string(),
                "bytes": content.len(),
            }),
        );
    }

    info!(
        session = %ctx.session_id,
        path = raw_path,
        bytes = content.len(),
        "fs/write_text_file served"
    );

    let meta = FsWriteMeta {
        path: raw_path.to_string(),
        old_content,
        new_content: content.to_string(),
    };

    Ok((json!({ "success": true }), Some(meta)))
}

/// Metadata from a successful write, used for diff emission.
#[derive(Debug)]
pub struct FsWriteMeta {
    pub path: String,
    pub old_content: Option<String>,
    pub new_content: String,
}

/// Build an `FsHandlerContext` from a loaded profile and spawn options.
pub fn build_fs_context(
    profile: &CapabilityProfile,
    project_root: &Path,
    session_id: &str,
    agent_id: &str,
    audit: Option<Arc<crate::audit::AuditFacility>>,
) -> FsHandlerContext {
    FsHandlerContext {
        project_root: project_root.to_path_buf(),
        profile: profile.clone(),
        session_id: session_id.to_string(),
        agent_id: agent_id.to_string(),
        audit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn test_profile(read: &str, write: &str) -> CapabilityProfile {
        CapabilityProfile {
            id: "test".into(),
            class: profile_core::profile::Class::Executor,
            version: "1.0.0".into(),
            description: None,
            inherits_from: None,
            tool_allow: vec![],
            tool_deny: vec![],
            shell_allowlist: vec![],
            fs: FsConfig {
                read: read.into(),
                write: write.into(),
                scoped_paths: vec![],
                deny_globs: vec![".env*".into(), "**/secrets/**".into()],
                max_bytes_per_read: 1024,
                max_bytes_per_write: 512,
            },
            git: Default::default(),
            connectors: Default::default(),
            network_egress: Default::default(),
            approval_required_for: vec![],
            allowed_agent_kinds: vec!["acp".into()],
            resource_limits: None,
            audit: None,
        }
    }

    fn test_ctx(project_root: &Path, read: &str, write: &str) -> FsHandlerContext {
        FsHandlerContext {
            project_root: project_root.to_path_buf(),
            profile: test_profile(read, write),
            session_id: "test-session".into(),
            agent_id: "test-agent".into(),
            audit: None,
        }
    }

    #[tokio::test]
    async fn read_within_project_root_succeeds() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("hello.txt"), "world").unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "none");
        let params = json!({ "path": "hello.txt" });
        let result = handle_fs_read(&ctx, &params).await.unwrap();
        assert_eq!(result["content"], "world");
    }

    #[tokio::test]
    async fn read_outside_project_root_denied() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "none");
        let params = json!({ "path": "/etc/passwd" });
        let err = handle_fs_read(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, FsError::ProfileDenied { .. }));
    }

    #[tokio::test]
    async fn read_deny_glob_blocks_env_file() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join(".env"), "SECRET=x").unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "none");
        let params = json!({ "path": ".env" });
        let err = handle_fs_read(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, FsError::ProfileDenied { .. }));
    }

    #[tokio::test]
    async fn read_exceeds_max_bytes_denied() {
        let dir = TempDir::new().unwrap();
        let big = "x".repeat(2048);
        fs::write(dir.path().join("big.txt"), &big).unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "none");
        let params = json!({ "path": "big.txt" });
        let err = handle_fs_read(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, FsError::SizeExceeded { .. }));
    }

    #[tokio::test]
    async fn read_nonexistent_file_io_error() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "none");
        let params = json!({ "path": "no_such_file.txt" });
        let err = handle_fs_read(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, FsError::IoError(_)));
    }

    #[tokio::test]
    async fn write_within_project_root_succeeds() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "project_root");
        let params = json!({ "path": "out.txt", "content": "hello" });
        let (result, meta) = handle_fs_write(&ctx, &params).await.unwrap();
        assert_eq!(result["success"], true);
        assert!(meta.is_some());
        let written = fs::read_to_string(dir.path().join("out.txt")).unwrap();
        assert_eq!(written, "hello");
    }

    #[tokio::test]
    async fn write_when_fs_write_none_denied() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "none");
        let params = json!({ "path": "out.txt", "content": "hello" });
        let err = handle_fs_write(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, FsError::ProfileDenied { .. }));
    }

    #[tokio::test]
    async fn write_exceeds_max_bytes_denied() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "project_root");
        let big = "x".repeat(1024);
        let params = json!({ "path": "out.txt", "content": big });
        let err = handle_fs_write(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, FsError::SizeExceeded { .. }));
    }

    #[tokio::test]
    async fn write_deny_glob_blocks_secrets() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("secrets")).unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "project_root");
        let params = json!({ "path": "secrets/key.txt", "content": "x" });
        let err = handle_fs_write(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, FsError::ProfileDenied { .. }));
    }

    #[tokio::test]
    async fn write_creates_parent_directories() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "project_root");
        let params = json!({ "path": "a/b/c.txt", "content": "nested" });
        let (result, _) = handle_fs_write(&ctx, &params).await.unwrap();
        assert_eq!(result["success"], true);
        let written = fs::read_to_string(dir.path().join("a/b/c.txt")).unwrap();
        assert_eq!(written, "nested");
    }

    #[tokio::test]
    async fn write_captures_old_content_for_diff() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("existing.txt"), "old").unwrap();
        let ctx = test_ctx(dir.path(), "project_root", "project_root");
        let params = json!({ "path": "existing.txt", "content": "new" });
        let (_, meta) = handle_fs_write(&ctx, &params).await.unwrap();
        let meta = meta.unwrap();
        assert_eq!(meta.old_content.as_deref(), Some("old"));
        assert_eq!(meta.new_content, "new");
    }
}
