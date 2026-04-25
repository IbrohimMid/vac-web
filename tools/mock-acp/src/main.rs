//! mock-acp — stub ACP-style stdio child for Stage X.3 driver tests.
//!
//! This binary fakes a tiny slice of the Agent Client Protocol so the
//! bridge's `AcpDriver` has something to drive in tests *without*
//! depending on a real Claude Code / OpenCode binary. Real ACP wiring
//! lands in Stage X.6 once the upstream `--acp` flag is verified.
//!
//! Wire format (line-delimited JSON):
//!   in : `{"type":"prompt","text":"..."}`
//!   out: `{"type":"assistant_message_chunk","text":"..."}`
//!        `{"type":"assistant_message_complete"}`
//!
//! Behavior:
//!   - On startup, emits one `session_started` line.
//!   - For every `prompt` line received, emits 3 chunks then a complete.
//!   - On stdin EOF, exits cleanly.
//!   - `--crash-after <n>` exits non-zero after emitting n total chunks
//!     so tests can exercise the child-crash path.

use anyhow::Result;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::{info, warn};

#[derive(Debug, Default)]
struct Args {
    stdio: bool,
    profile: Option<String>,
    session_id: Option<String>,
    project: Option<String>,
    crash_after: Option<u32>,
}

fn parse_args() -> Args {
    let mut a = Args::default();
    let mut argv = std::env::args().skip(1);
    while let Some(tok) = argv.next() {
        match tok.as_str() {
            "--acp" | "--stdio" => a.stdio = true,
            "--profile" => a.profile = argv.next(),
            "--session-id" => a.session_id = argv.next(),
            "--project" => a.project = argv.next(),
            "--crash-after" => a.crash_after = argv.next().and_then(|v| v.parse().ok()),
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
            tracing_subscriber::EnvFilter::try_from_env("VAC_MOCK_ACP_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = parse_args();
    info!(?args, "mock-acp starting");

    let session_id = args
        .session_id
        .clone()
        .unwrap_or_else(|| "sess_mock_acp".to_string());

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    let started = json!({
        "type": "session_started",
        "session_id": session_id,
        "profile_id": args.profile,
    });
    writeln_json(&mut stdout, &started).await?;

    let mut total_chunks: u32 = 0;
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
        let parsed: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, raw = %line, "non-JSON input ignored");
                continue;
            }
        };
        let kind = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "prompt" {
            let text = parsed
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            for chunk in echo_chunks(&text) {
                writeln_json(
                    &mut stdout,
                    &json!({
                        "type": "assistant_message_chunk",
                        "text": chunk,
                    }),
                )
                .await?;
                total_chunks += 1;
                if let Some(cap) = args.crash_after {
                    if total_chunks >= cap {
                        warn!(
                            total_chunks,
                            "crash-after threshold reached, exiting non-zero"
                        );
                        std::process::exit(7);
                    }
                }
            }
            writeln_json(
                &mut stdout,
                &json!({ "type": "assistant_message_complete" }),
            )
            .await?;
        } else {
            warn!(?kind, "unhandled input type, ignoring");
        }
    }
}

async fn writeln_json(out: &mut tokio::io::Stdout, v: &Value) -> Result<()> {
    let s = serde_json::to_string(v)?;
    out.write_all(s.as_bytes()).await?;
    out.write_all(b"\n").await?;
    out.flush().await?;
    Ok(())
}

fn echo_chunks(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec!["ack".into()];
    }
    let trimmed: String = text.chars().take(120).collect();
    let third = (trimmed.len() / 3).max(1);
    let mut out = Vec::with_capacity(3);
    let mut start = 0usize;
    while start < trimmed.len() && out.len() < 3 {
        let mut end = (start + third).min(trimmed.len());
        while end < trimmed.len() && !trimmed.is_char_boundary(end) {
            end += 1;
        }
        out.push(trimmed[start..end].to_string());
        start = end;
    }
    if out.is_empty() {
        out.push(trimmed);
    }
    out
}
