# Connectors — Adapter Contracts

**Status**: v1 (locked for Phase 0.5; adapters land across phases)
**Scope**: Connector adapter contract, auth, snapshot, read-only-by-default, v1 catalog, rate-limiting, failure handling.

---

## 1. Principles

1. **Read-only by default.** Write capability is a per-profile, per-connector escalation.
2. **OAuth/token stored in OS keyring** where available; encrypted file fallback.
3. **Egress allowlisted per profile.** Host list from profile's `network_egress.host_allowlist`.
4. **Snapshot-friendly.** Each adapter supports capture of aggregated snapshots for pin reuse.
5. **Rate-limit aware.** Adapters respect provider limits, expose retry hints upstream.
6. **Redact secrets in logs/audit.** Tokens never logged; payload redacted by default.

---

## 2. Connector trait (Rust)

```rust
#[async_trait]
pub trait Connector: Send + Sync {
    fn id(&self) -> &str;                     // e.g., "github:vastar/x"
    fn kind(&self) -> ConnectorKind;          // GitHub, Notion, ...
    fn capabilities(&self) -> ConnectorCapabilities;
    async fn health(&self) -> Health;
    async fn read(&self, req: ReadRequest) -> Result<ReadResponse>;
    async fn write(&self, req: WriteRequest) -> Result<WriteResponse>;  // gated
    async fn capture_snapshot(&self, scope: SnapshotScope) -> Result<ConnectorSnapshot>;
}

pub struct ConnectorCapabilities {
    pub read_ops:  Vec<String>,     // method names exposed as connector.read.<kind>.<op>
    pub write_ops: Vec<String>,     // method names as connector.write.<kind>.<op>
}
```

### Methods are strongly scoped
- Assessor profiles may invoke only `connector.read.*` methods.
- Executor profiles may invoke `connector.write.*` only if explicitly listed in profile.
- Bridge enforces; adapter does not trust caller.

---

## 3. Authentication

### OAuth flow
1. UI `connector.connect { kind }` → bridge opens browser to OAuth provider.
2. Callback to local bridge HTTP endpoint (`http://127.0.0.1:<port>/oauth/callback/<kind>`) — only open during connect flow, closed after.
3. Token exchanged + stored in OS keyring (`keyring` crate on macOS/Linux/Windows).
4. Fallback: encrypted file at `~/.config/vac-web/connectors/<id>.enc` using device-bound key.

### Token scopes
- Requested scope = superset needed across all profiles that may use connector.
- Runtime usage narrowed per profile.

### Token refresh
- Adapters refresh before expiry; transparent to caller.
- On refresh failure → `connector.disconnected` event; UI prompts re-auth.

---

## 4. Snapshot capture

Used for assessment pinning and handoff stability.

```rust
pub struct SnapshotScope {
    pub entities: Vec<SnapshotEntity>,  // e.g., ["pr:123", "actions:run:456", "issues:open"]
    pub at:       DateTime<Utc>,
}
pub struct ConnectorSnapshot {
    pub snapshot_id: String,
    pub connector_id: String,
    pub kind: ConnectorKind,
    pub captured_at: DateTime<Utc>,
    pub etag: Option<String>,
    pub content_index: HashMap<String, String>,  // entity → content digest
    pub payload_path: PathBuf,                    // blob cache location
}
```

Stored at `~/.cache/vac-web/connector-snapshots/<snapshot_id>.json` + payload blobs nearby.

Referenced by `EvidenceRef.capturedSnapshotId` and `HandoffPacket.pin.connectorSnapshots[]`.

---

## 5. Rate limiting

Each adapter exposes:
```rust
pub struct RateState {
    pub remaining: u32,
    pub limit:     u32,
    pub reset_at:  DateTime<Utc>,
}
```

Queried before calls; if near limit → delay with jitter. On 429 → emit `connector.rate_limited { retryAfterMs }` + exponential backoff.

Per-connector defaults:
| Kind | Default budget/min | Burst |
|---|---|---|
| GitHub (auth'd) | 5000/hr | 100/min |
| Notion | 3/s | 10/burst |
| Linear | 100/hr | 20/min |
| Figma | 30/min | 10/burst |
| Sentry | 40/min | 20/burst |
| Datadog | 300/min | 100/burst |

---

## 6. V1 catalog

### `github`
- Read: `repo.info`, `pr.list`, `pr.get`, `pr.review_comments`, `pr.files`, `pr.checks`, `issue.list`, `issue.get`, `commit.get`, `commit.compare`, `actions.runs`, `actions.run.logs`, `releases.list`, `dependabot.alerts`, `code_scanning.alerts`, `secret_scanning.alerts`, `deployments.list`.
- Write (gated): `pr.create`, `pr.merge`, `issue.create`, `issue.comment`, `release.create`, `tag.create`.
- Snapshot entities: PR list at sha, Actions run state, open alerts count.

### `notion`
- Read: `page.get`, `page.children`, `database.query`, `search`.
- Write (gated): `page.append`, `page.create`, `database.insert`.

### `linear`
- Read: `issue.list`, `issue.get`, `project.list`, `team.list`, `cycle.current`.
- Write (gated): `issue.create`, `issue.update`, `comment.create`.

### `jira` (v1.1)
- Similar shape to Linear.

### `figma`
- Read: `file.get`, `file.images`, `file.versions`, `file.comments`.
- Write: none in v1.

### `sentry`
- Read: `project.list`, `issue.list`, `issue.stats`, `release.list`, `release.deploy_state`, `event.get`.
- Write: none.

### `datadog`
- Read: `monitor.list`, `monitor.state`, `dashboard.list`, `log.query`, `metric.query`, `incident.list`.
- Write: none.

### `grafana`
- Read: `dashboard.list`, `alert.list`, `alert.state`, `query`.
- Write: none.

### `posthog`
- Read: `event.schema`, `funnel.get`, `insight.get`, `cohort.list`, `feature_flag.list`.
- Write: none.

### `ga4`
- Read: `report.run`, `property.list`, `event.list`.
- Write: none.

### `mixpanel`
- Read: `event.schema`, `funnel.query`, `cohort.list`.
- Write: none.

### `ci` (GitHub Actions generic + GitLab + CircleCI adapters)
- Read: `workflow.list`, `run.list`, `run.state`, `run.logs`, `artifact.list`.
- Write: none.

### `vercel`
- Read: `project.list`, `deployment.list`, `deployment.state`, `env.list_names` (values redacted).
- Write (gated): `deployment.create`, `env.set` (future, Phase 7).

### `cloudflare`
- Read: `zone.list`, `dns.list`, `pages.list`, `pages.deployment.state`.
- Write (gated): `pages.deployment.create`.

### `pagerduty`
- Read: `incident.list`, `incident.get`, `service.list`, `schedule.list`.
- Write: none.

### `snyk` / `dependabot`
- Read: `project.list`, `vuln.list`, `dependency.tree`.
- Write: none.

### `lighthouse_ci`
- Read: `build.list`, `build.metrics`, `build.statements`.
- Write: none.

### Local (internal, not remote)
- `fs` — filesystem adapter; read respecting profile fs scope.
- `git` — local git operations; read respecting profile git scope.

---

## 7. UI surfacing

### Connector Manager (Knowledge → Connectors)
List of connected connectors with:
- Health indicator (`ux-grammar.md` severity).
- Last successful call timestamp.
- Rate-limit gauge.
- Scope summary (read/write capabilities granted).
- Actions: Disconnect, Re-authenticate, Capabilities detail.

### Assessment scope picker
User sees list of connectors available per assessor family. Disconnected connectors grey with "Connect" CTA; assessment runs skip them with warning.

### Evidence chip (in findings)
Shows connector id + kind; click opens source (new tab or side panel).

---

## 8. Privacy & egress

- **Default egress**: only whitelisted hosts per connector.
- **Outbound proxies**: respected via standard `HTTP_PROXY` / `HTTPS_PROXY` env.
- **Telemetry**: never aggregated off-device by default; user opt-in for anonymous error reports.
- **Audit**: every connector call logged with method + response size + duration; body redacted by default.

---

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| Auth expired | Emit `connector.disconnected`; health = error; prompt re-auth |
| Rate limited | `connector.rate_limited { retryAfterMs }`; queue deferred |
| Network error | Retry with backoff (1s, 2s, 5s, give up after 3); emit warn |
| Provider 5xx | Retry with backoff; after 3 → warn + skip evidence |
| Schema drift (provider API changed) | Adapter emits structured error; finding may include `evidence.kind: "missing"` with note |

---

## 10. Adapter implementation checklist

Each new adapter PR must include:
- [ ] `Connector` trait impl.
- [ ] Method list documented with sample request/response.
- [ ] Auth flow tested end-to-end.
- [ ] Rate-limit handling verified (integration test with mocked 429).
- [ ] Snapshot capture tested.
- [ ] Host allowlist entries documented.
- [ ] Scope narrowing test (assessor profile cannot call write methods).
- [ ] Secret redaction test (payload scan).
- [ ] Failure mode matrix (§9) tested.

---

## 11. Related

- [`capability-profiles.md`](./capability-profiles.md) §9 — read/write scoping.
- [`evidence-freshness.md`](./evidence-freshness.md) — default freshness per kind.
- [`assessment-contract.md`](./assessment-contract.md) §8 — evidence capture pipeline.
- [`handoff-contract.md`](./handoff-contract.md) §3 — connector snapshots in pin.
- [`protocol.md`](./protocol.md) §3.16, §4.13 — connector commands/events.
