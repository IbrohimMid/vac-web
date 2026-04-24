# Plan 24 — Connector manager + OAuth

**Phase**: 3 · **Depends on**: Plans 07, 11 · **Blocks**: Phase 4 connectors · **Est**: 2 days

## Goal

Implement the Connector adapter trait + at least two initial adapters (GitHub, Notion) + OAuth flows + UI for connect/disconnect/health. Foundation for evidence capture in Phase 4.

## Why this is hard

OAuth flows require browser redirects, bridge-local callback endpoint, token storage (OS keyring with fallback), refresh handling, secret redaction. Each provider has quirks. Rate limiting + per-request capability check also live here.

## Scope

### In
- `Connector` trait in bridge.
- OAuth coordinator: generate URL, handle callback, persist token.
- OS keyring integration (`keyring` crate).
- GitHub adapter (read-only v1 core methods).
- Notion adapter (read-only v1 core methods).
- ConnectorManager UI.
- Health + rate-limit surfacing.

### Out
- Write methods for connectors (Phase 6 for release workflows).
- Other adapters (Sentry/Datadog/etc. land in Phase 4 as evidence consumer demands).

## Deliverables

```
apps/local-bridge/src/connectors/
├── mod.rs                  # Connector trait + enum
├── registry.rs
├── oauth.rs                # generic OAuth 2.0 dance
├── token_store.rs          # keyring + encrypted file fallback
├── secret_detect.rs
├── rate_limit.rs
├── github.rs
└── notion.rs
apps/web/src/components/ConnectorManager/
├── ConnectorManager.tsx    # overlay kind=connector_manager
├── ConnectorRow.tsx
├── ConnectButton.tsx
└── HealthIndicator.tsx
```

## Stages

### S1 — Trait + registry (0.2 day)

```rust
#[async_trait]
pub trait Connector: Send + Sync {
    fn id(&self) -> &str;
    fn kind(&self) -> ConnectorKind;
    fn capabilities(&self) -> ConnectorCapabilities;
    async fn health(&self) -> Health;
    async fn read(&self, req: ReadRequest) -> Result<ReadResponse>;
    async fn write(&self, req: WriteRequest) -> Result<WriteResponse>;  // gated by profile
    async fn capture_snapshot(&self, scope: SnapshotScope) -> Result<ConnectorSnapshot>;
}

pub struct ConnectorRegistry {
    connectors: DashMap<String, Arc<dyn Connector>>,
}
```

API: list, get by id, add, remove.

Per-session availability: bridge exposes `connector.list` filtered by session's profile `connectors.read/write` lists.

**Exit**: registry holds connectors; trait compiles.

### S2 — OAuth coordinator (0.3 day)

```rust
pub struct OAuthFlow {
    pub kind: ConnectorKind,
    pub client_id: String,
    pub scopes: Vec<String>,
    pub authorize_url: Url,
    pub token_url: Url,
    pub state: String,         // random, stored
    pub pkce: PkceChallenge,
}
```

Endpoints on bridge:
- `POST /api/connectors/:kind/connect` → mint flow, return authorize URL.
- `GET /api/connectors/:kind/callback?code=&state=` → validate state, exchange code, persist token, emit `connector.connected`.

Security:
- State pinned; mismatched state rejects.
- Callback URL bound to 127.0.0.1; bridge opens listener during flow only.
- PKCE required for public clients.

**Exit**: GitHub OAuth round-trip succeeds; token stored.

### S3 — Token store (0.3 day)

```rust
pub struct TokenStore {
    backend: Box<dyn KeyringBackend>,
}
impl TokenStore {
    pub fn put(&self, id: &str, token: Token) -> Result<()>;
    pub fn get(&self, id: &str) -> Result<Option<Token>>;
    pub fn delete(&self, id: &str) -> Result<()>;
    pub fn list_ids(&self) -> Result<Vec<String>>;
}
```

Backends:
- Primary: `keyring` crate (macOS Keychain, Windows Credential Store, Linux Secret Service).
- Fallback: encrypted file at `~/.config/vac-web/connectors/<id>.enc` using key derived from machine-id + optional passphrase.

Token struct: `{ access_token, refresh_token, expires_at, scope, kind, connected_at }`.

**Exit**: token round-trip on all 3 OSes (CI matrix).

### S4 — Secret detection (0.1 day)

```rust
pub fn looks_like_secret(s: &str) -> Option<SecretKind> {
    // GitHub token: ghp_, gho_, github_pat_...
    // AWS: AKIA..., AWS_SECRET...
    // OpenAI: sk-...
    // JWT: eyJhbGc...
    // Generic: high-entropy 32+ char
}
```

Used when:
- Logging tool call args (redact if detected).
- Capturing connector evidence (refuse; emit Security finding).

**Exit**: known samples detected; known non-secrets not flagged.

### S5 — Rate limiter (0.1 day)

Per-connector token-bucket:
```rust
pub struct RateLimiter {
    pub remaining: AtomicU32,
    pub limit: u32,
    pub reset_at: AtomicI64,
}
impl RateLimiter {
    pub async fn acquire(&self, n: u32) -> Result<()>;  // sleeps if near limit
}
```

Providers update via response headers (e.g., `X-RateLimit-Remaining`).

Emit `connector.rate_limited` on 429 with `retry_after_ms`.

**Exit**: synthetic 429 triggers backoff + event.

### S6 — GitHub adapter (0.3 day)

Minimal v1 read methods per `connectors.md §6`:
- `repo.info`, `pr.list`, `pr.get`, `pr.files`, `pr.checks`, `issue.list`, `commit.get`, `actions.runs`.

Implementation:
- `octocrab` crate.
- Wrap each method; on call, acquire rate budget + check profile egress allowlist.
- Return structured + raw payload for evidence capture.

**Exit**: from bridge shell: list PRs of a real repo.

### S7 — Notion adapter (0.3 day)

Minimal read: `page.get`, `page.children`, `database.query`, `search`.

Implementation:
- Hand-rolled HTTP client (no mature Rust SDK); use `reqwest`.
- Pagination helper.

**Exit**: fetch Notion page content by ID.

### S8 — Connector Manager UI (0.3 day)

Overlay kind `connector_manager`:
```tsx
function ConnectorManager() {
  const list = useConnectors(s => s.list);
  return (
    <Dialog>
      <header>Connectors</header>
      <ul>{list.map(c => <ConnectorRow key={c.id} conn={c} />)}</ul>
      <footer><AddConnectorDropdown /></footer>
    </Dialog>
  );
}
```

ConnectorRow: kind logo, id, health (SeverityIcon), rate-limit gauge, Connect / Disconnect button, Capabilities link.

Connect flow: click → bridge mints OAuth URL → browser opens (or popup). On callback, `connector.connected` event closes popup, updates list.

Disconnect: confirm → delete token → emit event.

**Exit**: manually connect GitHub + Notion end-to-end.

### S9 — Snapshot capture (0.1 day)

Each adapter implements `capture_snapshot(scope)`:
```rust
async fn capture_snapshot(&self, scope: SnapshotScope) -> Result<ConnectorSnapshot> {
    let mut index = HashMap::new();
    for entity in &scope.entities {
        let payload = self.fetch_entity(entity).await?;
        let digest = sha256(&payload);
        index.insert(entity.clone(), digest);
        self.cache.store(digest, &payload).await?;
    }
    Ok(ConnectorSnapshot { snapshot_id: ulid(), content_index: index, captured_at: now(), ... })
}
```

**Exit**: snapshot + replay from snapshot_id reproduces same content.

## Testing

- OAuth end-to-end on dev accounts (documented fixture).
- Token store: cross-OS matrix in CI (macOS/Linux/Windows runners).
- Rate limit: mocked 429 → backoff.
- Secret redaction: known vectors.

## Exit criteria

- [ ] Connect GitHub + Notion from UI.
- [ ] Tokens persisted across bridge restart.
- [ ] Health + rate-limit visible.
- [ ] Snapshot captured + replayed.
- [ ] RT-028, RT-066 (OAuth state mismatch) pass.

## Risks

| Risk | Mitigation |
|---|---|
| OAuth callback listener leaks | Close port immediately after callback; TTL on listener |
| Keyring unavailable in headless Linux | Fallback encrypted file; document prerequisite |
| Rate limits drift across providers | Per-provider config; centralized limiter trait |
| Provider API changes | Per-method versioned; future-proof with provider-specific client abstraction |

## Related

- [`connectors.md`](../../connectors.md)
- [`capability-profiles.md`](../../capability-profiles.md) §9
- Plan 10 — profile enforcement (egress check)
- Plan 27 — evidence capture uses connector.read
