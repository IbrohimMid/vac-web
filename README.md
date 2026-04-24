# `vac-web`

End-to-end software delivery cockpit: **build → assess → handoff → execute → reassess → release**, with an assessor/executor split that makes mutation require approved handoff.

> Local-first agentic workspace + read-only specialist assessment swarms + formal handoff + release gates. Runs on your machine; browser is the control plane.

## Status

**Phases 0.1–0.6 + 1.1–1.7 + 2.1–2.6 + 3.1–3.7 + 4.1–4.8 + 5.1–5.6 + 6.1–6.8 + 7.1–7.7 + 8.1–8.6 all complete.** Steady-state entered; Phase 8 is ongoing.

- ✅ **0.1–0.6** Foundations: contracts, schemas, profiles, codegen, red-team, bridge-core, mock-engine.
- ✅ **1.1–1.7** Bridge + web MVP: axum WS + session manager + translator + profile enforcement + auth + audit + minimal UI.
- ✅ **2.1** Transcript: markdown-it + DOMPurify sanitize + hot/cold freeze + TanStack Virtual + Web Worker for >20KB payloads.
- ✅ **2.2** Syntax highlight: Shiki Web Worker + IntersectionObserver visibility gate + LRU cache.
- ✅ **2.3** Command palette: ⌘K overlay + ActionSpec registry from bridge + safe predicate parser + recency weighting + slash alias.
- ✅ **2.4** UX grammar: severity tokens + SeverityIcon (✓·●✗) + Topbar facets + 3 notify lanes (transient/persistent/sticky) + virtualized ActivityRail.
- ✅ **2.5** Overlay manager: stack with max depth 2 + Esc precedence + body scroll lock + palette migrated.
- ✅ **2.6** UI red-team: 13 DOMPurify XSS vectors + 7 predicate parser tests — all green.
- ✅ **3.1–3.7** Execution surfaces: Workbench tab shell + Approvals (risk badges + a/A/x keys + inspector overlay) + Review (file list + DiffViewer overlay with virtualized hunks + revert) + Sessions (list/resume/rename/close) + Runtime (jobs + log tail + cancel) + Shell drawer (lazy xterm.js, PTY via shell.input/output, Ctrl/⌘+` toggle) + Connectors (GitHub/Notion OAuth shell + health) + Mention search (`@` picker + attachments tray). Mock-engine scenarios emit tool_call.pending/decided, changeset.updated/diff_chunk, shell.started/output, connector.oauth_url, context.mention_results.
Post-audit hardening (Phase 4 audit cycle):
- Invalid HTML fixed: `FindingCard` root changed from `<li>` to `<article>` so the virtualizer's `<div>` row wrapper no longer produces `ul > div > li`. `ReadinessHub` findings list now uses `<div role="list">` with `role="listitem"` rows — structurally valid + screen-reader correct.
- Unstable selectors tamed: `Workbench` running-runs badge reduces over the `runs` Map to a primitive count (no throwaway array per render). `FindingCard` subscribes to the evidence Map identity + resolves refs through `useMemo`, instead of returning a fresh array from the Zustand selector every render.
- `GateDetail` signoff / override actually hit the bridge: `GateRibbon` + `Topbar` now accept the `transport` prop and forward it through the overlay params, so the audit-logged commands (`gate.signoff`, `gate.override`) fire as intended.
- Mock-engine `identity_hash` emits a 64-hex-char stand-in (matches the sha256 field shape upstream PR #7 will ship); web-side dedup behaviour is now testable against a realistic value.

Post-audit hardening (Phase 5 audit cycle):
- **Critical fix — `handoff.upserted` merge semantics.** The handler previously replaced the packet wholesale, so a partial update (the mock-engine approve emits only `{packet_id, status, signers}`) blew away title / tasks / pin / required_signers and dropped the author signer. Handler now merges with the prior packet, appends signers by name (dedup by name), and preserves `executor_session_id` when absent from the payload. New `domain/handoff/handlers.test.ts` covers both the partial-update preservation and re-emission dedup.
- `AssessmentDiff` wired into `ReadinessHub` via a "Compare vs prior {swarm} run" toggle that appears once a completed earlier run of the same swarm exists. Earlier this component was built but never mounted.
- Self-sign guard trims both author and approver names so trailing whitespace cannot smuggle a duplicate signer past the check.
- `PacketDetail` dispatch button debounces via a `dispatching` flag; double-clicks no longer enqueue two executions.
- Workbench handoff badge now also counts `dispatched` state (between `approved` and `executing`).

Post-audit hardening (Phase 6 audit cycle):
- `GateRibbon` overflow dropdown now closes on outside pointer-down and Escape (previously stuck open once clicked); handlers scope to a `containerRef` so clicks on the fold's own pills don't self-dismiss.
- `ArchiveTab` VIL lens filters deploys through a type guard — orphaned ids in `deployOrder` with no entry in `deploys` no longer render `undefined deploy undefined @ undefined`.
- `ArchiveTab` Signal lens namespaces React keys (`sticky:` / `pers:` / `obs:`) so overlapping ids across notify entries and post-deploy observations can't collide.

Post-audit hardening (Phase 7 audit cycle):
- **Critical fix — token claim was never invoked.** `client_attach_loop` rejected short tokens but never consumed the nonce, so a screenshot replay within TTL would have been accepted. Added `TokenStore::claim_by_opaque` (indexed by the opaque string the client actually presents) + wired it into the attach path with a **bound-check** (`token.device_id == query.device_id && token.session_id == query.session_id`) so token/session smuggling across devices fails fast with `token_binding_mismatch`.
- **Fixed `TunnelConfig::dial_url` URL corruption.** Previous impl produced `ws://host/path?v=1/bridge/dial&device_id=d` (path glued after query). Now splits on `?` and rebuilds cleanly: `ws://host/path/bridge/dial?v=1&device_id=d`. Also trims trailing `/` on bare hosts.
- **Clients no longer stall when the bridge drops.** Bridge-dial loop now pushes a `{"type":"relay.bridge_gone"}` control frame to every attached client writer before calling `unregister_bridge`, so browsers can surface `session.disconnected` rather than sit on a dead channel.
- **`forward_to_clients` return value** — the arithmetic collapsed to the retained count (via `before - (before - list.len())`). Simplified to `list.len()` post-retain with a clarifying comment; callers now get the count they expect.
- Tests: relay crate 10 (was 7); new cases cover `claim_by_opaque` happy path + second-call rejection + unknown-token rejection; `dial_url` preserves-query and trims-trailing-slash.

Cross-phase audit (Phases 1–8 sweep):
- **Bridge `KNOWN_COMMANDS` vs web `transport.send` call sites** — the web client sent `continuous.write_config` (GuidedMode finish) and `migration.create_draft` (MigrationTab) with no matching entries in `profile_layer/KNOWN_COMMANDS`, so both would silently `protocol.unknown_command`-reject. Added all five Phase-8 command types (`continuous.write_config`, `migration.{create_draft,dry_run,verify_reversibility,dispatch}`).
- **Dead export removed** — `buildAttachUrl` in `app/PairingRelay.tsx` was exported for "unit tests" that never materialized; the inline builder in the component is the only path. Removed the function + its unused `buildRelayUrl` import.
- **ArchiveTab VIL key instability** — used array index for dynamically-sorted rows; replaced with composite `${ts}|${line}` key so React reconciliation stays correct when gates or deploys arrive out of order.
- Clean across: handler registration drift (all 13 domain handlers registered in main.tsx), Workbench tabs vs panes (all 11 tabs have panes), store `clear()` exports (no dead methods), README phase claims (every store + component referenced exists on disk), cross-source key collisions (Signal lens namespacing stands).

Post-audit hardening (Phase 8 audit cycle):
- **Critical fix — regression detector was dead code.** `detectRegression` was a pure function with no wiring, so the §8.3 sticky banner promise never fired. Added `domain/regression/handlers.ts` that subscribes to `assessment.completed`, walks `runOrder` to find the prior run of the same family and the last-green baseline for the finding-returned check, and pushes a sticky notify (severity `warn`, correlationId per-family so re-fires coalesce). New integration test asserts verdict drop actually produces the banner and first-run emits none.
- **Fixed `canDispatchMigration` over-permissive phase check.** Previously allowed both `scheduled` and `awaiting_signoff`; the latter is by definition still waiting. Narrowed to `scheduled` only — `awaiting_signoff → scheduled` transition gates dispatch as intended.
- **`GuidedMode.PROJECT_DEFAULTS.infra` type lie removed.** Previously cast `'ops' as AssessorFamily` with a comment saying it'd be filtered; now uses valid catalog members (`release` + `reliability`) that actually exist.
- **`MigrationTab.DryButtons` dead stub replaced** with a plain `dispatchable: yes/no` status line derived from the `canDispatchMigration` predicate; the actual dispatch button lands when the bridge `migration.*` commands ship.

- ✅ **8.1–8.6** Continuous readiness: new `stores/continuous.ts` with `TRIGGER_ROUTING` (data table mapping `pr.merged/branch.pushed/ci.{green,red}/connector.health.degraded/cadence.cron` → assessor-family subset), `familiesForTrigger`, `debounceDecision` (coalesce within window), `inputSurfaceSkip` (minimal glob engine with `*` + `**`). `domain/regression/detect.ts` — three-condition detector (verdict drop, score drop ≥ 0.15, finding returned vs last-green). `GuidedMode` overlay (3-step wizard: project-type → release-goal → family-recommender chips; writes config + seeds cadences; opens via "Guided setup" button on Topbar helper row). `stores/migration.ts` with strict trust model — two-party invariant in `addSigner` (self-sign rejected, author-as-approver rejected), merge-semantics `upsert`, 500-cap dry-run log, `canDispatchMigration` predicate enforcing phase + reversibility + maintenance window + two distinct signers. `MigrationTab` surfaces phase / SQL / signers / dry-run log / reversibility status (commands stubbed behind TODO until bridge `executor.migration@1.0.0` lands). Workbench + overlay registry extended. Tests: 24 new (continuous 10, regression 5, migration 9).

- ✅ **7.1–7.7** Hosted dispatch + relay: new `apps/relay-service` workspace crate (`vac-relay` binary) with axum WS routes `/bridge/dial` + `/client/attach` + admin `/admin/pair` + `/admin/revoke`. Blind router design — frames wrap the existing Phase-1–6 envelope in `{header:{session_id,seq,dir}, payload}` so the relay never inspects payload. `DeviceRegistry` (DashMap) fans frames out to all clients attached to the same `{device_id, session_id}`; `TokenStore` mints 5-min single-use bound tokens with 8-char short-code fallback, nonce-based replay rejection, and device revocation list. Bridge gains `tunnel.rs` + opt-in supervisor spawned from `main.rs` when `VAC_RELAY_URL` is set (exponential backoff to 10s ceiling). Web `transport/relay.ts` + `parseRelayParamsFromLocation()` — URL `?relay=…&device=…&session=…&token=…[&last_event_id=…]` transparently swaps in `createRelayTransport` for the direct WS. New `transport/e2e.ts` with `Sealer` interface, `IdentitySealer` for plain mode, `RejectingSealer` canary for e2e mode (TODO wired to real XChaCha20-Poly1305 in 7.6.1). `PairingRelay` overlay mints a token via `/admin/pair`, renders short code + deterministic QR preview placeholder + full attach URL. Tests: relay crate 7 (registry + tokens + revocation), web 7 new (buildRelayUrl + sealer canaries).

- ✅ **6.1–6.8** Remaining assessors + Release plane: `AssessorFamily` widened to the full 12-family catalog (rtd/pm/ux/frontend/security/reliability/performance/qa/docs/launch/release/growth) + family selector in `ReadinessHub` + `family_catalog()` in the mock-engine emits realistic agents/checks per family. New gates `QAComplete`, `ReadyForStaging`, `ReadyToPublish`, `ReadyForGrowth` added to `GATE_ORDER` (6 gates total); `GateRibbon` gains an overflow fold (2 visible + `+N` dropdown, `foldedFail` coloring). `release` store + handlers + `ReleaseTab` with per-target Deploy/Publish/Release-notes buttons gated by `DevComplete`+`ReadyToDeploy` (+`ReadyForStaging` for staging) / `ReadyToPublish`. `ArchiveTab` consolidates read-only Plan/VIL/Signal/Memory lenses (per rollback plan §c); Memory lens exports a portable `.vacz.json` session bundle. Mock-engine extended with `release.deploy/publish/generate_notes/list_targets` + 14 connectors in `connector_catalog()` (adds datadog/grafana/vercel/cloudflare/posthog/ga4/mixpanel/snyk/dependabot/lighthouse_ci/pagerduty + existing github/notion/sentry). Bridge `KNOWN_COMMANDS` extended with `release.*`.

- ✅ **5.1–5.6** Handoff + Reassess loop: `handoff` store + lifecycle state machine (draft → pending_approval → approved → dispatched → executing → completed, plus rejected / invalidated / expired branches) + 64-hex pin mock (worktree_digest + base_sha + connector snapshots + strict/lenient policy) + `HandoffBuilder` UI (finding picker filtered to severity ≥ medium, pin-policy selector, author-name capture) + `PacketDetail` view with two-party approval (client-side self-sign guard + server-authoritative) + `AssessmentDiff` 4-tab view (resolved / persistent / regressed / new) computed by identity_hash + `isStuck()` convergence guard (3-cycle flat-or-rising window) + `handoff.convergence_stuck` sticky banner via notify lane. Mock-engine scenarios for `handoff.create/approve/reject/dispatch_local` emit `handoff.upserted`, `handoff.status`, `handoff.dispatch_progress`.

- ✅ **4.1–4.8** Assessment MVP: `assessment` + `gates` stores with identity-hash finding dedup + freshness tier compute (fresh/aging/stale/hard_expire per `evidence-freshness.md` §4) + `ReadinessHub` tab (verdict header + 5-category scorecards + virtualized findings list with TanStack Virtual + severity/category filters + live progress bar) + `FindingCard` with lazy evidence preview + `FreshnessBadge` glyph + `GateRibbon` in Topbar (DevComplete + ReadyToDeploy pills) + `gate_detail` overlay (criteria / blockers / signoff / override with audit-log warning; two-party signing for ReadyToDeploy). Mock-engine swarm scenarios emit `assessment.started/progress/finding/evidence/evidence_preview/completed` and `gate.changed` — RTD = 5 agents (code_health, test_coverage, security, observability, release_gate), PM = 7 agents (discovery, pricing, positioning, competition, metrics, go_to_market, synthesizer).

Post-audit hardening (Phase 3 audit cycle):
- ShellDrawer cleanup: removed duplicate/dead `offRef.current` assignments; a single teardown now unsubscribes both `shell.started` and `shell.output` on close.
- Approvals: `decide()` rolls back optimistic `deciding` state on Ack error; keyboard handler no longer re-registers on every render (stable deps; reads `order` from store inside handler).
- MentionPicker: debounce timer + event subscription lifecycle fixed — `off()` runs on cleanup instead of via nested `setTimeout`; `onClose` held in a ref so Enter/Esc effect does not re-register every render.
- Composer: `@`-trigger auto-closes when the `@` is removed or whitespace breaks the mention; attachments clear on submit.
- Sessions handler: listens for `session.list_response` (actual bridge event name) and tolerates both string-ID and object forms from registry.list().
- DiffViewer: consolidated duplicate `useRef` import.

**94 workspace + 15 red-team + 38 vitest tests. Clippy `-D warnings` + cargo fmt + TS strict all clean. Vite build green.**

Post-audit hardening (Phase 2 audit cycle):
- Overlay consolidation: `OverlayHost` + `OverlayRegistry` now the single render path; `CommandPaletteOverlay` removed; `CommandPalette` is a content-only component receiving `OverlayRenderProps`.
- Focus restore: `originFocus` held as `WeakRef<HTMLElement>`; consumed on dismiss / dismissTopmost / dismissAll / MAX_DEPTH eviction.
- Recency store: runtime-validates `localStorage` payload (type guard + finite > 0 filter) so corrupt state can't poison scoring.
- Shiki theme reactive: `detectTheme()` reads `data-theme` + `prefers-color-scheme`; no longer hardcoded at call sites.
- Bridge `ActionSpec` serialization: `skip_serializing_if = "Option::is_none"` on `keybinding`, `slash_alias`, `available_when` — drops noise from the wire.
- Notify exports tightened: single export style for `TransientToasts`, `PersistentRail`, `StickyBanners` — removed the namespace wrapper.
- New coverage: 18 vitest tests across `stores/overlays` (stack/dismiss/depth cap/params) and `stores/transcript` (hot/cold freeze/unfreeze/identity preservation).

Post-audit hardening (Phase 1 audit cycle):
- Profile enforcement Layer 1 **actually** denies `palette.invoke_action`, `workbench.invoke`, `handoff.dispatch_*`, `gate.override*` at bridge boundary.
- Pairing codes use **OS CSPRNG** (`rand::thread_rng()`) — predecessor was `SystemTime`-based and guessable.
- Rate limit: max 16 active pair codes per 60s window.
- `AuthState` requires ≥ 32-byte secret (`assert` on construction); `allow_anonymous` is dev-only + audit-logged on use.
- Session cleanup: `session.close` removes from registry + reaper task sweeps terminal sessions every 2s.
- WS subscribers attach to session broadcast → engine events flow live to client (not just via replay).
- Unknown command types rejected at bridge (`protocol.unknown_command`) — no silent forwarding to engine.
- Audit log fires on: WS connect/auth-fail/disconnect, session create/create-fail/close, pairing mint/exchange/deny.

## Quick start

```bash
pnpm install                    # install Node deps
cargo build --workspace         # verify Rust side
./scripts/dev.sh                # run bridge + vite concurrently
```

Then open `http://localhost:5173` — you'll see a hello-world page probing `/api/health` on the bridge.

## Documentation

See [`docs/README.md`](./docs/README.md) for the full index.

Core reads:
- [Product PRD](./docs/product-prd.md)
- [Architecture](./docs/architecture.md)
- [Protocol v1](./docs/protocol.md)
- [Capability Profiles](./docs/capability-profiles.md) ← security boundary SSOT

## Repo layout

```
vac-web/
├── apps/
│   ├── local-bridge/          # Rust daemon (axum + tokio) — Phase 1 fills in
│   └── web/                   # React + Vite SPA — Phase 1 fills in
├── packages/
│   ├── protocol/v1/           # JSON Schemas (canonical) + profile YAMLs + manifests + samples
│   ├── protocol-ts/           # generated TS types (16 modules)
│   ├── protocol-rs/           # generated Rust structs (16 modules) + round-trip tests
│   └── profile-core/          # capability profile loader + enforcement primitives
├── tools/
│   └── codegen/               # vac-codegen binary (JSON Schema → TS + Rust)
├── tests/
│   └── red-team/              # profile-layer adversarial tests (10 cases passing)
├── schema/v1/                 # frozen protocol snapshots (populated at release time)
├── docs/                      # SSOT specs + implementation plans
└── scripts/                   # dev.sh, codegen.sh, manifest-verify.sh, verify-codegen.sh, schema-validate.sh
```

## Verification

```bash
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
cargo test --workspace                       # 94 tests green
cargo test -p red-team --features redteam    # 15 red-team cases green
bash scripts/manifest-verify.sh              # schema + profile hash drift check
bash scripts/codegen.sh                      # regenerate TS + Rust types (deterministic)
pnpm --filter @vac-web/web build             # vite production build
```

## Related

- Parent: [`vastar-agentic-cli`](../vastar-agentic-cli/) — execution engine.

## License

TBD.
