//! HTTP client for `opencode acp`/`opencode serve`.
//!
//! **X.5h.2 Step 5 fix**: Uses raw `tokio::net::TcpStream` + manual
//! HTTP/1.1 GET + chunked transfer-encoding decoder instead of
//! `reqwest::Client`. Empirically (Step 5 live verify, sess_01KQB94Y3KT...),
//! reqwest 0.12 (`default-features = false, features = ["json", "rustls-tls"]`)
//! fails 100% of GET attempts on `http://127.0.0.1:<port>/event` (Bun-served
//! by opencode), even though `curl` to the same URL succeeds. 71/109 TCP
//! connect attempts fail at localhost while curl is 100% reliable on the
//! same port — root cause not pinned in reqwest, but raw socket bypasses
//! it entirely. See `.ci-logs/x5h2-tap-subscribe-bug.md`.
//!
//! Public API preserved: `OpencodeServeClient::new`, `base_url`,
//! `subscribe`, `list_sessions`. Reuses the existing `SseParser`.

use super::events::{OpencodeServeEvent, SessionMeta};
use futures::stream::Stream;
use futures::StreamExt;
use std::pin::Pin;
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

#[derive(Debug, Error)]
pub enum OpencodeServeError {
    #[error("opencode serve io: {0}")]
    Io(#[from] std::io::Error),
    #[error("opencode serve http status {status}: {body}")]
    HttpStatus { status: u16, body: String },
    #[error("opencode serve protocol: {0}")]
    Protocol(String),
    #[error("opencode serve parse: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("opencode serve: {0}")]
    Sse(String),
}

pub type Result<T> = std::result::Result<T, OpencodeServeError>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct OpencodeServeClient {
    base_url: String,
    host: String,
    port: u16,
}

impl OpencodeServeClient {
    /// Build a client for `http://<host>:<port>`. Trailing slashes are
    /// trimmed so callers can pass either form. Host/port are parsed at
    /// construction time; bad URLs fall back to `127.0.0.1:80` and the
    /// connect failure surfaces at `subscribe`/`list_sessions` time.
    pub fn new(base_url: impl Into<String>) -> Self {
        let mut base = base_url.into();
        while base.ends_with('/') {
            base.pop();
        }
        let (host, port) = parse_host_port(&base).unwrap_or_else(|| ("127.0.0.1".into(), 80));
        Self {
            base_url: base,
            host,
            port,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// `GET /session` — list sessions visible to this opencode child.
    pub async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        let body = http_get_full_body(&self.host, self.port, "/session").await?;
        Ok(serde_json::from_slice::<Vec<SessionMeta>>(&body)?)
    }

    /// Subscribe to `/event` SSE. Returns a stream that yields parsed
    /// events. Network/parse errors surface as `Err` items so the caller
    /// can decide whether to log + continue or reconnect.
    pub async fn subscribe(&self) -> Result<impl Stream<Item = Result<OpencodeServeEvent>>> {
        let body_stream = http_get_chunked_stream(&self.host, self.port, "/event").await?;
        Ok(sse_event_stream_from_bytes(body_stream))
    }
}

fn parse_host_port(base: &str) -> Option<(String, u16)> {
    let s = base
        .strip_prefix("http://")
        .or_else(|| base.strip_prefix("https://"))?;
    let s = s.split('/').next()?;
    let (host, port) = s.split_once(':')?;
    Some((host.to_string(), port.parse().ok()?))
}

/// One-shot HTTP/1.1 GET that reads the full body. Used for `/session`
/// and similar non-streaming endpoints. Honors `Transfer-Encoding: chunked`
/// and `Content-Length`.
async fn http_get_full_body(host: &str, port: u16, path: &str) -> Result<Vec<u8>> {
    match open_get(host, port, path, false).await? {
        BodyStream::Chunked(mut s) => {
            let mut all = Vec::new();
            while let Some(chunk) = s.next().await {
                all.extend_from_slice(&chunk?);
            }
            Ok(all)
        }
        BodyStream::ContentLength { mut reader, len } => {
            let mut buf = vec![0u8; len];
            reader.read_exact(&mut buf).await?;
            Ok(buf)
        }
        BodyStream::Eof(mut reader) => {
            let mut buf = Vec::new();
            reader.read_to_end(&mut buf).await?;
            Ok(buf)
        }
    }
}

/// Long-lived chunked GET stream for SSE-style endpoints.
async fn http_get_chunked_stream(
    host: &str,
    port: u16,
    path: &str,
) -> Result<Pin<Box<dyn Stream<Item = Result<Vec<u8>>> + Send>>> {
    match open_get(host, port, path, true).await? {
        BodyStream::Chunked(s) => Ok(s),
        BodyStream::ContentLength { .. } | BodyStream::Eof(_) => Err(OpencodeServeError::Protocol(
            "expected Transfer-Encoding: chunked for SSE endpoint".into(),
        )),
    }
}

enum BodyStream {
    Chunked(Pin<Box<dyn Stream<Item = Result<Vec<u8>>> + Send>>),
    ContentLength {
        reader: BufReader<TcpStream>,
        len: usize,
    },
    Eof(BufReader<TcpStream>),
}

/// Connect, send GET, parse status + headers, return a [`BodyStream`].
async fn open_get(
    host: &str,
    port: u16,
    path: &str,
    accept_event_stream: bool,
) -> Result<BodyStream> {
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((host, port)))
        .await
        .map_err(|_| {
            OpencodeServeError::Protocol(format!(
                "tcp connect timed out after {}s to {}:{}",
                CONNECT_TIMEOUT.as_secs(),
                host,
                port,
            ))
        })??;
    let mut tcp = tcp;
    let accept = if accept_event_stream {
        "text/event-stream"
    } else {
        "*/*"
    };
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: {accept}\r\nUser-Agent: vac-bridge/0.1.0\r\nConnection: keep-alive\r\n\r\n",
    );
    tcp.write_all(req.as_bytes()).await?;
    tcp.flush().await?;

    let mut reader = BufReader::new(tcp);

    // Status line.
    let mut status_line = String::new();
    let n = reader.read_line(&mut status_line).await?;
    if n == 0 {
        return Err(OpencodeServeError::Protocol(
            "empty response (server closed connection before status line)".into(),
        ));
    }
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| {
            OpencodeServeError::Protocol(format!(
                "malformed status line: {:?}",
                status_line.trim_end()
            ))
        })?;

    // Headers.
    let mut chunked = false;
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            return Err(OpencodeServeError::Protocol("eof in headers".into()));
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim();
            match name.as_str() {
                "transfer-encoding" if value.eq_ignore_ascii_case("chunked") => {
                    chunked = true;
                }
                "content-length" => {
                    content_length = value.parse().ok();
                }
                _ => {}
            }
        }
    }

    if status_code != 200 {
        let mut buf = Vec::new();
        let mut taken = (&mut reader).take(1024);
        let _ = taken.read_to_end(&mut buf).await;
        let body = String::from_utf8_lossy(&buf).into_owned();
        return Err(OpencodeServeError::HttpStatus {
            status: status_code,
            body,
        });
    }

    if chunked {
        Ok(BodyStream::Chunked(Box::pin(chunked_body_stream(reader))))
    } else if let Some(len) = content_length {
        Ok(BodyStream::ContentLength { reader, len })
    } else {
        Ok(BodyStream::Eof(reader))
    }
}

/// Decode `Transfer-Encoding: chunked` body into a stream of opaque
/// `Vec<u8>` payloads (chunk headers stripped).
fn chunked_body_stream(reader: BufReader<TcpStream>) -> impl Stream<Item = Result<Vec<u8>>> + Send {
    futures::stream::unfold(Some(reader), |state| async move {
        let mut reader = state?;
        let mut size_line = String::new();
        match reader.read_line(&mut size_line).await {
            Ok(0) => return None,
            Ok(_) => {}
            Err(e) => return Some((Err(OpencodeServeError::Io(e)), None)),
        }
        let trimmed = size_line.trim_end_matches(['\r', '\n']);
        let size_str = trimmed.split(';').next().unwrap_or(trimmed).trim();
        let size = match usize::from_str_radix(size_str, 16) {
            Ok(n) => n,
            Err(_) => {
                return Some((
                    Err(OpencodeServeError::Protocol(format!(
                        "bad chunk size: {size_str:?}"
                    ))),
                    None,
                ));
            }
        };
        if size == 0 {
            // Last-chunk: drain optional trailers up to terminating CRLF.
            loop {
                let mut t = String::new();
                match reader.read_line(&mut t).await {
                    Ok(0) => return None,
                    Ok(_) => {
                        if t.trim_end_matches(['\r', '\n']).is_empty() {
                            return None;
                        }
                    }
                    Err(_) => return None,
                }
            }
        }
        let mut buf = vec![0u8; size];
        if let Err(e) = reader.read_exact(&mut buf).await {
            return Some((Err(OpencodeServeError::Io(e)), None));
        }
        let mut crlf = [0u8; 2];
        if let Err(e) = reader.read_exact(&mut crlf).await {
            return Some((Err(OpencodeServeError::Io(e)), None));
        }
        Some((Ok(buf), Some(reader)))
    })
}

/// Wrap a byte-stream into an SSE event stream, reusing [`SseParser`].
fn sse_event_stream_from_bytes<S>(bytes: S) -> impl Stream<Item = Result<OpencodeServeEvent>>
where
    S: Stream<Item = Result<Vec<u8>>> + Send + 'static,
{
    let parser = SseParser::default();
    futures::stream::unfold(
        (Box::pin(bytes), parser),
        |(mut bytes, mut parser)| async move {
            loop {
                if let Some(payload) = parser.next_event() {
                    let parsed = OpencodeServeEvent::from_json_str(&payload)
                        .map_err(OpencodeServeError::from);
                    return Some((parsed, (bytes, parser)));
                }
                match bytes.next().await {
                    Some(Ok(chunk)) => parser.feed(&chunk),
                    Some(Err(e)) => return Some((Err(e), (bytes, parser))),
                    None => return None,
                }
            }
        },
    )
}

#[derive(Default)]
pub(crate) struct SseParser {
    buf: String,
}

impl SseParser {
    pub(crate) fn feed(&mut self, bytes: &[u8]) {
        self.buf.push_str(&String::from_utf8_lossy(bytes));
    }

    /// Pop the next complete SSE event's concatenated `data:` payload,
    /// or `None` if the buffer doesn't yet contain a frame terminator.
    pub(crate) fn next_event(&mut self) -> Option<String> {
        loop {
            let term = self.buf.find("\n\n")?;
            let frame = self.buf[..term].to_string();
            self.buf.drain(..term + 2);
            let mut data = String::new();
            for line in frame.lines() {
                if let Some(rest) = line.strip_prefix("data:") {
                    if !data.is_empty() {
                        data.push('\n');
                    }
                    data.push_str(rest.trim_start());
                }
            }
            if !data.is_empty() {
                return Some(data);
            }
        }
    }
}
