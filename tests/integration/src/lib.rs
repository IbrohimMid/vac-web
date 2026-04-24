//! Integration test helpers: spawn mock-engine, drive stdio.

use anyhow::{anyhow, Result};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

pub struct MockEngineHandle {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
}

impl MockEngineHandle {
    /// Spawns `mock-engine --stdio --seed <seed>`. Binary path resolved via
    /// CARGO_BIN_EXE_mock-engine (set by cargo for integration tests referencing
    /// sibling binary crates in the same workspace).
    pub async fn spawn(seed: u64) -> Result<Self> {
        // Try env first (cargo sets this when bin crate is in workspace)
        let exe = std::env::var_os("CARGO_BIN_EXE_mock-engine")
            .map(PathBuf::from)
            .or_else(|| {
                // Fallback: walk up from CARGO_MANIFEST_DIR
                let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                let root = manifest.parent()?.parent()?;
                let candidates = [
                    root.join("target/debug/mock-engine"),
                    root.join("target/release/mock-engine"),
                ];
                candidates.into_iter().find(|p| p.exists())
            })
            .ok_or_else(|| {
                anyhow!("mock-engine binary not found; run `cargo build -p mock-engine` first")
            })?;

        let mut child = Command::new(&exe)
            .arg("--stdio")
            .arg("--seed")
            .arg(seed.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr"))?;

        // Pump stderr to test output.
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[mock-engine] {line}");
            }
        });

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
        })
    }

    pub async fn send(&mut self, line: &str) -> Result<()> {
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;
        Ok(())
    }

    pub async fn recv_next(&mut self, timeout: Duration) -> Result<String> {
        match tokio::time::timeout(timeout, self.stdout.next_line()).await? {
            Ok(Some(l)) => Ok(l),
            Ok(None) => Err(anyhow!("mock-engine stdout EOF")),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn shutdown(mut self) -> Result<()> {
        drop(self.stdin);
        tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await??;
        Ok(())
    }
}

pub fn send_request_json(id: u64, method: &str, params: serde_json::Value) -> String {
    serde_json::to_string(&serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}
