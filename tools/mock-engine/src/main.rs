//! mock-engine — stub `vac serve --stdio` for local integration testing.
//!
//! Speaks line-delimited JSON-RPC 2.0 over stdin/stdout. stderr is logs.
//! Scripted responses: deterministic given `--seed`.

use anyhow::Result;
use serde_json::json;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::{info, warn};

mod scenarios;

#[derive(Debug, Default)]
struct Args {
    stdio: bool,
    profile: Option<String>,
    session_id: Option<String>,
    project: Option<String>,
    seed: u64,
}

fn parse_args() -> Args {
    let mut a = Args {
        seed: 42,
        ..Default::default()
    };
    let mut argv = std::env::args().skip(1);
    while let Some(tok) = argv.next() {
        match tok.as_str() {
            "--stdio" => a.stdio = true,
            "--profile" => a.profile = argv.next(),
            "--session-id" => a.session_id = argv.next(),
            "--project" => a.project = argv.next(),
            "--seed" => a.seed = argv.next().and_then(|v| v.parse().ok()).unwrap_or(42),
            _ => {}
        }
    }
    a
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("VAC_MOCK_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = parse_args();
    info!(?args, "mock-engine starting");

    let session_id = args
        .session_id
        .clone()
        .unwrap_or_else(|| format!("sess_{:0>26}", "01J000000000000000000MOCK"));

    let mut state = scenarios::State::new(
        args.seed,
        session_id.clone(),
        args.profile.clone(),
        args.project.clone(),
    );

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    // Emit startup session.ready.
    let ready = scenarios::emit_notification(
        "session.ready",
        json!({ "session_id": session_id, "profile_id": args.profile }),
    );
    stdout.write_all(ready.as_bytes()).await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await?;

    loop {
        let line = match tokio::time::timeout(Duration::from_secs(3600), reader.next_line()).await {
            Ok(Ok(Some(l))) => l,
            Ok(Ok(None)) => {
                info!("stdin EOF, exiting");
                return Ok(());
            }
            Ok(Err(e)) => {
                warn!(error = %e, "stdin read error");
                return Err(e.into());
            }
            Err(_) => {
                warn!("idle timeout");
                return Ok(());
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let responses = scenarios::handle(&line, &mut state);
        for r in responses {
            stdout.write_all(r.as_bytes()).await?;
            stdout.write_all(b"\n").await?;
        }
        stdout.flush().await?;
    }
}
