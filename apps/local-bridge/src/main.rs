//! vac-bridge daemon entry point.

use local_bridge::agent_runtime::{synth_legacy_registry, AgentRuntimeRegistry, ConfigSource};
use local_bridge::audit::AuditFacility;
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::handoff::HandoffService;
use local_bridge::server::{build_app, AppState};
use local_bridge::session::SessionRegistry;
use local_bridge::tunnel::{run_tunnel_supervisor, TunnelConfig};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("VAC_WEB_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let port: u16 = std::env::var("VAC_WEB_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // Resolve agent runtime: VAC_ENGINE_BIN (legacy single-binary
    // override) wins for back-compat; otherwise load the X.1 registry
    // from VAC_WEB_AGENTS_CONFIG → VAC_CONFIG_DIR/agents.toml →
    // ~/.config/vac-web/agents.toml. If no config file is found
    // anywhere, fall back to the historical mock-engine search so
    // existing dev workflows keep working without a config.
    let agents: Arc<AgentRuntimeRegistry> = if let Ok(bin) = std::env::var("VAC_ENGINE_BIN") {
        let path = PathBuf::from(bin);
        tracing::info!(engine_bin = %path.display(), "VAC_ENGINE_BIN override — synthesizing single-agent registry");
        Arc::new(synth_legacy_registry(path))
    } else {
        let r = AgentRuntimeRegistry::load()?;
        if matches!(r.source(), ConfigSource::Embedded) {
            let bin = default_engine_bin();
            tracing::info!(engine_bin = %bin.display(), "no agents.toml found — using discovered engine binary");
            Arc::new(synth_legacy_registry(bin))
        } else {
            r.log_summary();
            Arc::new(r)
        }
    };

    let profile_root = PathBuf::from("packages/protocol/v1/profiles");
    let audit_dir = std::env::var("VAC_AUDIT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs_config_home().join("vac-web").join("audit"));

    let audit = Arc::new(AuditFacility::new(audit_dir));
    let handoff = Arc::new(HandoffService::new());
    let sessions = SessionRegistry::with_runtime_and_profiles(agents, profile_root.clone());
    sessions.attach_audit(Arc::clone(&audit));
    let state = Arc::new(AppState {
        started_at: Instant::now(),
        sessions,
        auth: AuthState::new_dev(),
        audit,
        pairing: PairingStore::new(),
        profile_root,
        handoff,
    });

    // Optional outbound-dial tunnel (Phase 7): opt-in via VAC_RELAY_URL. When
    // set, the bridge ALSO dials the relay in addition to serving local WS,
    // so users can keep direct-WS + relay attached simultaneously during the
    // Phase 7 rollout.
    if let Some(cfg) = TunnelConfig::from_env() {
        tracing::info!(device_id = %cfg.device_id, relay = %cfg.relay_url, "starting tunnel");
        tokio::spawn(run_tunnel_supervisor(cfg));
    }

    let app = build_app(state);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let addr = listener.local_addr()?;
    println!("vac-bridge listening on http://{addr}");
    tracing::info!(%addr, "vac-bridge started");
    axum::serve(listener, app).await?;
    Ok(())
}

fn default_engine_bin() -> PathBuf {
    // Walk up from CARGO_MANIFEST_DIR to find target/debug/mock-engine
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(&manifest);
    let candidates = [
        root.join("target/debug/mock-engine"),
        root.join("target/release/mock-engine"),
    ];
    for c in candidates {
        if c.exists() {
            return c;
        }
    }
    PathBuf::from("vac")
}

fn dirs_config_home() -> PathBuf {
    std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| PathBuf::from(h).join(".config"))
                .unwrap_or_else(|_| PathBuf::from("/tmp"))
        })
}
