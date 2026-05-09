# Cockpit UX Implementation Plan — F5a / F5b / F5c

**Status**: closed (2026-05-09)
**Created**: 2026-05-07
**Estimated**: 8–11h fokus tunggal sesi
**Predecessor**: `docs/plans/wiring/post-r1-r6-followups-plan-2026-05-07.md` (F5)
**Audit reference**: thread 2026-05-06 08:38 — UI impact audit menemukan **nol** delta UI dari R1–R6 + Phase 2 scaffolding + F1 + F3.

---

> **Closeout 2026-05-09**: All three slices landed and merged. F5a Release panel: 5 components consuming `useRelease` (`ReleasePanel`, `TargetCard`, `DeployProgressList`, `NotesDraftView`, `ObservationsFeed`) with vitest coverage. F5b Extensions: `ExtensionsList`, `TrustActionMenu`, `QuarantineConfirmModal`, `PromotionRequestModal`, `PendingApprovals` plus `apps/local-bridge/src/extensions/handlers.rs` with 3 production callsites of `enforce_extension_trust` and `config/extension-trust.yaml` as runtime SSOT. F5c PerfBadge in `apps/web/src/components/cockpit/PerfBadge.tsx` (note: `cockpit/`, not `Topbar/` as originally planned) wired to live perf telemetry; `.github/workflows/perf.yml` includes `perf-baseline-archive` + `perf-baseline-compare --window 10 --threshold 25` + history upload. Two trust hardening rounds layered on top — see README §Recent highlights and ADR-0004.

---

## 1. Mengapa plan ini ada

Grep audit di repo (2026-05-06) menemukan:

- `enforce_extension_trust` callers di repo: hanya `lib.rs` re-export. **Nol callsite produksi** di `apps/` atau `tools/`.
- `apps/web/src` tidak punya direktori `*setting*` atau `*extension*`.
- `apps/web/src/domain/release/handlers.ts` mendaftar listener transport → push ke `useRelease` store. **Tidak ada komponen React yang membaca store**. Data masuk store, tidak pernah dirender.
- `perf-baseline-compare.mjs` belum dipanggil dari `.github/workflows/perf.yml`. F3 sengaja defer wiring CI.
- `config/extension-trust.yaml` belum ada; tidak ada runtime reader.
- Tidak ada perf/SLO badge atau indicator di cockpit.

Semua kerja R1–R6 + Phase 2 + F1 + F3 adalah library/CI/dev-tool/docs work. Plan ini menutup gap UI dengan tiga slice yang masing-masing **wajib menyentuh komponen visual** sehingga user akhir benar-benar melihat perbedaan.

---

## 2. Scope

### In-scope

- **F5a — Release panel** (3–4h): komponen React yang mengkonsumsi `useRelease` di Topbar overlay.
- **F5b — Extensions settings page + bridge wiring** (4–5h): cockpit settings page, bridge endpoints `extensions.list` + `extensions.update_trust`, produksi callsite untuk `enforce_extension_trust`, runtime reader `config/extension-trust.yaml`.
- **F5c — Perf/SLO indicator + CI baseline wiring** (1–2h): integrate `perf-baseline-archive` + `perf-baseline-compare` ke `perf.yml`; minimal Topbar badge.

### Non-scope

- F2 perf scenario drivers (ditangani slice terpisah; uji performa nyata menggantikan stub).
- F4 baseline alarm 14d (≥ 2026-05-21 setelah ada history cukup).
- F6 ADR refresh.
- Auth/session UX redesign.
- Mobile cockpit.
- Edit notes draft inline (read-only di slice ini).
- "Deploy now" button + gate enforcement (butuh `ReadyToDeploy` snapshot lengkap; defer).

---

## 3. Pre-flight checklist sesi baru

- [ ] MCP `mcpServer_vac_web_workbench3` aktif dan terhubung ke worker sehat.
- [ ] Branch `main` clean, latest dari remote (`git status` empty, `git fetch && git status` no behind).
- [ ] Latest HEAD memuat commit `60d4c92` (F1+F3) atau lebih baru.
- [ ] Tidak ada PR open yang memodifikasi file target F5a/F5b/F5c.
- [ ] User confirm scope: total (F5a+F5b+F5c) atau parsial (F5a saja, dst).
- [ ] User confirm urutan (saran default: F5a → F5c-CI → F5b → F5c-Web).
- [ ] Recon dulu pattern bridge handler di `apps/local-bridge/src/server/` (file struktur belum diaudit di plan ini).
- [ ] Cek `apps/local-bridge/Cargo.toml` untuk `serde_yaml` dependency; bila tidak ada, tambah.
- [ ] Recon `apps/web/src/transport/` untuk API `transport.send` yang akan dipakai F5b.

---

## 4. Slice F5a — Release panel (3–4h)

### Goal

User melihat targets list, deploy progress live, release notes draft, dan post-deploy observations dalam panel cockpit.

### Files to create

- `apps/web/src/components/Release/ReleasePanel.tsx` — komponen utama, membaca `useRelease`. Layout dua kolom: targets+deploys di kiri, notes+observations di kanan.
- `apps/web/src/components/Release/TargetCard.tsx` — render satu `DeployTarget` + last_status badge (warna per status: idle=gray, queued=blue, deploying=yellow, deployed=green, failed=red, rolled_back=orange).
- `apps/web/src/components/Release/DeployProgressList.tsx` — render `deploys` map dalam urutan `deployOrder`. Tampilkan id, target_id, commit (short sha), status badge, started_at relative time, finished_at bila ada.
- `apps/web/src/components/Release/NotesDraftView.tsx` — markdown render dari `useRelease.notes`. Reuse `apps/web/src/markdown/` renderer existing. Footer: list `source_refs` dengan ikon per kind.
- `apps/web/src/components/Release/ObservationsFeed.tsx` — list `observations` dengan severity badge (info=blue, warn=yellow, error=red), newest top, max 200.

### Files to edit

- `apps/web/src/overlays/registry.ts` — register key `'release'` mapped ke `ReleasePanel`.
- `apps/web/src/components/Topbar/Topbar.tsx` — tombol "Release" yang trigger overlay key `'release'`.
- `apps/web/src/overlays/esc.ts` — pastikan Esc handler menutup `'release'` overlay (mungkin sudah generic — verify).

### Acceptance criteria

- [ ] `pnpm -F web dev` → buka cockpit → klik "Release" di Topbar → panel terbuka.
- [ ] Tanpa transport event, panel menampilkan empty state per section ("No targets yet", dst).
- [ ] Inject sintetik via dev console: `useRelease.getState().setTargets([{id:'t1', label:'staging-eu', environment:'staging', last_status:'idle'}])` → `TargetCard` muncul.
- [ ] `useRelease.getState().upsertDeploy({...})` → `DeployProgressList` update tanpa unmount; status badge berubah live.
- [ ] `useRelease.getState().setNotes({...})` → markdown render terlihat dengan source_refs di footer.
- [ ] `useRelease.getState().appendObservation({...})` → muncul di feed (newest top).
- [ ] Esc menutup overlay.
- [ ] Vitest: minimal 1 test per komponen (5 file × 1 test = 5 test minimum), driven dengan `useRelease.setState`.
- [ ] `pnpm -F web typecheck && pnpm -F web test && pnpm -F web build` PASS.
- [ ] Grep verifier: `grep -rn 'useRelease' apps/web/src/components/` HARUS return ≥ 5 baris (5 komponen baru).

---

## 5. Slice F5b — Extensions settings + bridge wiring (4–5h)

### Goal

User melihat daftar extensions, tier badge, dapat revoke/quarantine via UI. Aktifkan callsite produksi `enforce_extension_trust`. `config/extension-trust.yaml` jadi source of truth.

### Bridge side (Rust)

#### Files to create

- `apps/local-bridge/src/extensions/mod.rs` — modul re-export.
- `apps/local-bridge/src/extensions/store.rs` — read/write `config/extension-trust.yaml` via `serde_yaml`. Pakai `fs2::FileExt::lock_exclusive` atau `tokio::sync::Mutex` static untuk concurrent safety. Expose:
  - `pub fn load_config() -> anyhow::Result<ExtensionTrustConfig>`
  - `pub fn save_config(cfg: &ExtensionTrustConfig) -> anyhow::Result<()>`
  - `pub fn update_entry(id: &str, tier: ExtensionTier) -> anyhow::Result<ExtensionEntry>`
- `apps/local-bridge/src/extensions/handlers.rs` — register dua method:
  - `extensions.list` → return `Vec<ExtensionEntry>` dari yaml.
  - `extensions.update_trust { id: String, tier: ExtensionTier }` → load config, find entry, update tier, panggil `profile_core::enforce_extension_trust(&cfg, &ctx)` dengan ctx synthetic untuk validate konsistensi (extension_id, signature optional, source dari entry), save yaml, broadcast event `extensions.updated` ke transport.
- `config/extension-trust.yaml` — seed minimal:
  ```yaml
  version: 1
  allow_unsigned: false
  publishers:
    - { id: 'pub-vac-core', name: 'VAC Core', pubkey: 'ed25519-DUMMY' }
  extensions:
    - { id: 'ext-bundled-demo', tier: allowed_bundled, source: bundled }
    - { id: 'ext-signed-demo', tier: allowed_signed, source: signed, publisher: 'pub-vac-core' }
    - { id: 'ext-quarantined-demo', tier: quarantined, source: signed, publisher: 'pub-vac-core' }
  ```
- `scripts/check-extension-trust-callsites.mjs` — grep verifier. Exit 1 kalau zero callsite `enforce_extension_trust` di `apps/`. Tambahkan ke pre-commit suite.

#### Files to edit

- `apps/local-bridge/src/lib.rs` — `pub mod extensions;`
- `apps/local-bridge/src/server/mod.rs` (atau tempat method registry yang ditemukan di recon) — register dua handler baru.
- `apps/local-bridge/Cargo.toml` — pastikan `serde_yaml` dependency (gunakan workspace inheritance bila ada).
- `config/control-plane/event-catalog.yaml` — tambahkan dua event:
  ```yaml
  - id: extensions.list_response
    status: implemented
    classification: implemented
    owner: bridge
  - id: extensions.updated
    status: implemented
    classification: implemented
    owner: bridge
  ```
- Regenerate: `node scripts/codegen-event-catalog.mjs` → `apps/local-bridge/src/generated/event_catalog.rs` updated. Commit kedua file (yaml + .rs) bersamaan.

### Web side (TypeScript)

#### Files to create

- `apps/web/src/domain/extensions/types.ts` — mirror types dari Rust:
  ```ts
  export type ExtensionTier = 'allowed_bundled' | 'allowed_signed' | 'quarantined' | 'revoked';
  export type ExtensionSource = 'bundled' | 'signed';
  export interface ExtensionEntry { id: string; tier: ExtensionTier; source: ExtensionSource; publisher?: string }
  ```
- `apps/web/src/domain/extensions/handlers.ts` — `transport.on('extensions.list_response', ...)` + `transport.on('extensions.updated', ...)` push ke store.
- `apps/web/src/stores/extensions.ts` — Zustand store: `entries: Map<string, ExtensionEntry>`, methods `setAll`, `upsert`, `remove`.
- `apps/web/src/components/Settings/SettingsPage.tsx` — shell page dengan sidebar (kategori: Extensions, Profile, dst) + content slot.
- `apps/web/src/components/Settings/Extensions/ExtensionsList.tsx` — render entries dari `useExtensions`, tier badge dengan warna konsisten (allowed_*=green, quarantined=yellow, revoked=red), source pill (bundled=blue, signed=purple).
- `apps/web/src/components/Settings/Extensions/TrustActionMenu.tsx` — dropdown aksi per row: "Mark allowed (signed)", "Quarantine", "Revoke". Kirim `transport.send('extensions.update_trust', { id, tier })`.
- `apps/web/src/components/Settings/Extensions/QuarantineConfirmModal.tsx` — konfirmasi destructive action sebelum send.

#### Files to edit

- `apps/web/src/main.tsx` — `offs.push(registerExtensionsHandlers(t))` di lifecycle yang sama dengan release (line ~162).
- `apps/web/src/overlays/registry.ts` — register `'settings'` overlay key.
- `apps/web/src/components/Topbar/Topbar.tsx` — ikon settings (⚙️) di pojok kanan trigger `'settings'` overlay.

### Acceptance criteria

- [ ] `cargo test -p local-bridge` PASS, termasuk minimal 1 integration test handler `extensions.update_trust` yang memanggil `enforce_extension_trust` dengan assert TrustDecision yang diharapkan.
- [ ] `cargo clippy -p local-bridge --all-targets -- -D warnings` PASS.
- [ ] **Grep verifier baru** `node scripts/check-extension-trust-callsites.mjs` PASS dengan ≥ 1 callsite di `apps/local-bridge/src/`.
- [ ] Dev cockpit: klik settings → tab Extensions → list 3 seed entry muncul dengan tier badge benar.
- [ ] Klik aksi "Quarantine" pada `ext-bundled-demo` → modal konfirmasi → submit → entry tier berubah jadi `quarantined` di UI tanpa reload.
- [ ] `cat config/extension-trust.yaml` setelah action menunjukkan tier baru tertulis di disk.
- [ ] Reload cockpit → state persist (load via `extensions.list`).
- [ ] `node scripts/codegen-event-catalog.mjs --check` PASS (no diff).
- [ ] `pnpm -F web typecheck && pnpm -F web test` PASS.
- [ ] Vitest: minimal 1 test untuk store + 1 test untuk `ExtensionsList` + 1 test untuk handler.

---

## 6. Slice F5c — Perf/SLO indicator + CI baseline wiring (1–2h)

### CI side (30 menit)

#### Files to edit

- `.github/workflows/perf.yml` — setelah step `check-slo-measurements.mjs`, tambahkan:
  ```yaml
  - name: Archive perf baseline
    run: node scripts/perf-baseline-archive.mjs perf-results.json
  - name: Compare perf baseline
    run: node scripts/perf-baseline-compare.mjs perf-results.json --window 14 --threshold 25
    continue-on-error: true  # tolerant selama window historis < 14 hari
  - name: Upload baseline history
    uses: actions/upload-artifact@v4
    with:
      name: perf-baseline-history
      path: .perf-baseline/history.jsonl
      retention-days: 90
  ```

### Web side (1h, opsional minimal)

#### Files to create

- `apps/web/src/components/Topbar/PerfBadge.tsx` — badge static initial: hijau dengan label "perf: ok" (dummy data dari constant). TODO komentar untuk fetch nyata di slice berikutnya bila bridge endpoint `perf.latest_run` belum ada.

#### Files to edit

- `apps/web/src/components/Topbar/Topbar.tsx` — render `<PerfBadge />` di samping settings ikon.

### Acceptance criteria

- [ ] `perf.yml` tervalidasi syntax (push branch test → workflow trigger sukses).
- [ ] CI run menghasilkan `.perf-baseline/history.jsonl` artifact (uploaded).
- [ ] `perf-baseline-compare.mjs` step exit 0 di first run (sesuai design empty-window handling).
- [ ] PerfBadge render di Topbar dev cockpit dengan label dan warna minimal.

---

## 7. Validation suite akhir setiap slice

```bash
cd /home/emp/Documents/VAC/vac-web

# Web
pnpm -F web install --frozen-lockfile
pnpm -F web typecheck
pnpm -F web test
pnpm -F web build

# Rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Codegen
node scripts/codegen-event-catalog.mjs --check
node scripts/check-slo-measurements.mjs config/slo-budgets.yaml --measurement-only

# F5b verifier baru
node scripts/check-extension-trust-callsites.mjs

# Repo hygiene
git diff --exit-code
```

---

## 8. Definition of done (full plan)

- [ ] Semua slice acceptance criteria centang.
- [ ] Validation suite lengkap PASS.
- [ ] **Grep audit ulang menunjukkan ≥ 1 UI consumer untuk: `useRelease` (F5a), `useExtensions` (F5b), perf data (F5c).**
- [ ] **Grep audit ulang menunjukkan ≥ 1 callsite produksi `enforce_extension_trust` di `apps/local-bridge/src/`** (verifier `check-extension-trust-callsites.mjs` PASS).
- [ ] Notion handoff page F5 di-update status DONE dengan tabel before/after delta UI.
- [ ] Commit message format: `feat(cockpit-ux): F5a/F5b/F5c wire release+extensions+perf to UI`.
- [ ] Plan tracker `post-r1-r6-followups-plan-2026-05-07.md` F5 dipindah ke ✅ Closed.
- [ ] Plan ini sendiri ditandai status: `closed` di frontmatter setelah merge.

---

## 9. Risk register

| Risk | Likelihood | Mitigasi |
|---|---|---|
| Pattern handler bridge belum dipetakan | High | Recon dulu sebelum tulis F5b Rust code; gunakan handler existing sebagai template. Pre-flight checklist enforce. |
| `serde_yaml` tidak ada di `local-bridge` Cargo deps | Medium | Cek `apps/local-bridge/Cargo.toml`; bila tidak ada tambah via workspace inheritance. `profile-core` sudah punya. |
| Yaml race condition (dua agent edit bersamaan) | Low | F5b store pakai `fs2::FileExt::lock_exclusive` atau channel single-writer pattern. |
| `transport.send` API belum jelas | Medium | Recon `apps/web/src/transport/` sebelum tulis F5b TS. Pre-flight checklist. |
| Codegen event-catalog gagal validate | Low | Selalu run `--check` setelah edit yaml; commit codegen output bersamaan. |
| F5a komponen tidak punya design system reference | Medium | Pakai style minimalis konsisten dengan Topbar/Review existing; iterasi visual di slice berikut bila perlu. |
| Bridge endpoint baru `extensions.*` tidak ter-broadcast ke transport | Medium | Tambah integration test yang assert event muncul di subscriber. |
| F5c web minimal mungkin terasa "belum jadi" | Low | Tandai eksplisit sebagai placeholder dengan TODO; user diberitahu di handoff bahwa fetch nyata butuh slice tambahan kecil. |

---

## 10. Urutan eksekusi yang disarankan

1. **F5a** (3–4h) — paling murah secara dependency, langsung visual, tidak butuh bridge baru. User bisa lihat dampak nyata setelah ~half-day session. Validation set 1.
2. **F5c CI part** (30 menit) — closing F3 deferred sub-task; tidak butuh UI work; cepat. Validation set 2.
3. **F5b** (4–5h) — kerja paling berat: Rust handler + yaml store + event-catalog regen + TS handler + 4 komponen UI + verifier script. Validation set 3.
4. **F5c web** (1h) — opsional bila masih ada budget; bisa di-defer ke slice berikut tanpa block DoD inti.

Total **target single session**: 8–9h fokus. Bila scope harus dipotong: drop F5c-web, lalu drop F5b TS bagian (bridge tetap selesai dengan integration test), terakhir drop F5b Rust.

---

## 11. Referensi

- Audit jujur (predecessor context): thread 2026-05-06 08:38 — UI impact = nol untuk R1–R6 + Phase 2 + F1 + F3.
- Predecessor plan: `docs/plans/wiring/post-r1-r6-followups-plan-2026-05-07.md` (F5 entry).
- Trust model: `docs/extension-trust-model.md` + `docs/adr/0003-extension-trust-model.md`.
- Trust core lib: `packages/profile-core/src/extension_trust.rs` (commit `60d4c92`). Types: `ExtensionTrustConfig`, `ExtensionEntry`, `ExtensionTier`, `ExtensionSource`. Function: `enforce_extension_trust(cfg: &ExtensionTrustConfig, ctx: &EnforceContext) -> TrustDecision`.
- Baseline scripts: `scripts/perf-baseline-archive.mjs`, `scripts/perf-baseline-compare.mjs`. CLI: `--window N --threshold PCT`.
- Release store: `apps/web/src/stores/release.ts`. Slice exports: `useRelease`, types `DeployTarget`, `DeployEvent`, `DeployStatus`, `ReleaseNotesDraft`, `PostDeployObservation`.
- Release handlers (already wired): `apps/web/src/domain/release/handlers.ts`.
- Main lifecycle hook: `apps/web/src/main.tsx` line ~151 (capabilities) + ~162 (release). F5b inject `registerExtensionsHandlers(t)` di pola yang sama.
- SLO config: `config/slo-budgets.yaml`. 5 scenario keys: command_ack, websocket_event_delivery, persisted_event_write, topbar_interaction, command_manifest_refresh.
- Event catalog yaml source: `config/control-plane/event-catalog.yaml`. Codegen: `node scripts/codegen-event-catalog.mjs`.
- VALID_STATUSES = `{implemented, not_wired, planned, legacy_mock_only, deprecated}`.
- VALID_OWNERS = `{bridge, web, mock, protocol, tools}`.
- Existing perf workflow: `.github/workflows/perf.yml` — 7 step, jadwal weekly Monday 04:00 UTC.

---

## 12. Catatan kritis untuk new-session executor

1. **Jangan mulai tulis F5b sebelum recon `apps/local-bridge/src/server/`** untuk memetakan pattern method registration. Plan ini sengaja tidak menebak file path bridge handler karena recon awal di session sebelumnya tidak menemukan pattern eksplisit.
2. **Jangan skip grep verifier `check-extension-trust-callsites.mjs`** — ini gate utama yang membuktikan F5b betul-betul mengaktifkan F1.
3. **Jangan inflate report**. Bila F5c web di-defer, tulis eksplisit di handoff DONE bahwa hanya F5a + F5c-CI + F5b yang ditutup. Sisanya tetap planned.
4. **Approval-minimization**: gabung edit ke satu workflow per slice (recon + write + edit + validation + commit dalam satu approval).
5. **Jangan `git push` tanpa instruksi user**. Hard-rule project: no push, no tag, no `.git/config` writes.
6. **Bahasa default**: Bahasa Indonesia di chat user, English di code/comment standard.

---

## 13. Final ask sebelum sesi mulai

User akan ditanya di awal sesi baru:

1. Scope: F5a only / F5a+F5c-CI / F5a+F5c-CI+F5b / full (F5a+F5b+F5c).
2. Urutan: ikuti default plan section 10 atau custom.
3. Stop conditions: stop on any clippy warning? stop on any vitest fail? (Default: yes both, sesuai validation suite).
4. Confirm `mcpServer_vac_web_workbench3` MCP target masih sehat (panggil `workspace_info {}` untuk verify).
