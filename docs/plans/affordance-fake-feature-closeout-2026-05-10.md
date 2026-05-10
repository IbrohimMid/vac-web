---
id: plans.affordance-fake-feature-closeout-2026-05-10
title: 'Fake-feature affordance closeout (gate ungated NotWired buttons)'
priority: P1
area: cockpit-ux
status: closed  # landed 2026-05-10
owners:
  - web
created: 2026-05-10
---

# Affordance fake-feature closeout — 2026-05-10

> **Closeout 2026-05-10**: All 8 affordance entries added to `apps/web/src/domain/capabilities/affordanceCatalog.ts`. `toAffordanceStatus()` helper extracted from TargetCard for shared use. 5 components refactored: `TargetCard` (publish + generate_notes), `GateDetail` (signoff + override), `RuntimeTab` (cancel), `MigrationTab` (new draft), `ConnectorsTab` (connect + disconnect). 16 new tests added; existing TargetCard publish test updated to assert disabled state. Validation: typecheck, 704/704 tests pass, web build green, size-limit unchanged (initial 128.41 kB / 140 kB budget).

## Context

Audit menyeluruh backend ↔ frontend wiring (2026-05-10) terhadap `main@a3b9811` mengonfirmasi pola lubang yang konsisten: **8 button submit command `not_wired` tanpa affordance gating**, sehingga user mengklik tombol enabled, transport mengirim payload ke bridge, bridge mereply `feature.not_wired`/error, dan UI hanya menelan error via empty `catch {}` block. Tidak ada disabled-copy operator-facing, tidak ada notify lane signal. Ini melanggar planning rule eksplisit di `docs/plans/README.md:43-45`:

> Every visible UI control must map to either: a real backend executor, **or** an explicit disabled/not-wired state with operator-facing copy.

Ground truth per file (semua `transport.send` di-grep, dicross-check ke `command-manifest.yaml` + `affordanceCatalog.ts`):

| File | Line | Command | Manifest status | Affordance gate? | Visible behavior bug |
|---|---|---|---|---|---|
| `apps/web/src/components/Release/TargetCard.tsx` | 78 | `release.publish` | `not_wired` | ❌ tidak ada entry | Button enabled bila `ReadyToPublish=pass`, klik → silent fail |
| `apps/web/src/components/Release/TargetCard.tsx` | 86 | `release.generate_notes` | `not_wired` | ❌ | Button enabled selama `transport` ada |
| `apps/web/src/components/Gates/GateDetail.tsx` | 43 | `gate.signoff` | `not_wired` | ❌ | Sign-off form enabled, optimistic store update, transport silent-fail |
| `apps/web/src/components/Gates/GateDetail.tsx` | 56 | `gate.override` | `not_wired` | ❌ | Override form enabled, idem |
| `apps/web/src/components/Runtime/RuntimeTab.tsx` | 43 | `runtime.cancel_job` | `not_wired` | ❌ | Cancel button enabled untuk job running |
| `apps/web/src/components/Migration/MigrationTab.tsx` | 27 | `migration.create_draft` | `not_wired` | ❌ | "New draft" button enabled (file punya TODO phase-8.5) |
| `apps/web/src/components/Connectors/ConnectorsTab.tsx` | 33 | `connector.connect` | `not_wired` | ❌ | "Connect" button per provider enabled |
| `apps/web/src/components/Connectors/ConnectorsTab.tsx` | 43 | `connector.disconnect` | `not_wired` | ❌ | "Disconnect" button enabled |

Dua control yang **sudah benar** (kontras pattern):
- `release.deploy.button` → affordance entry `release.deploy.button` di `affordanceCatalog.ts:73-78`, gating `commandStatus: 'implemented'` + `gateReady`. Button disabled dengan title "Release deploy backend is not wired yet."
- `shell.start` → affordance entry `affordanceCatalog.ts:80-86`. Start button disabled saat `commandStatus !== 'implemented'`. Subsequent `shell.input/resize/kill` hanya di-fire setelah `localShellId` non-null (yang hanya bisa terjadi kalau start sukses), jadi flow inheren ter-gate.

PRD alignment: `docs/product-prd.md §7` (feature matrix per phase) menempatkan Release plane di Phase 6, `executor.migration` di Phase 7, `connector.connect` di Phase 7 hosted. **Jadi solusi yang benar bukan implement backend executor** (yang akan melanggar PRD phase + kapasitas profile + audit pipeline), melainkan **gate UI eksplisit** via mekanisme affordance yang sudah ada. Dengan begitu, ketika backend benar-benar landing di phase masing-masing, satu-satunya perubahan adalah `status: implemented` di `command-manifest.yaml` + regenerate codegen — tidak ada UI rewrite.

Plan F4 (`docs/plans/wiring/f4-refresh-plan-2026-05-09.md`) yang masih aktif berkaitan dengan perf gate flip dan tidak terganggu plan ini.

## Scope

### In scope

1. Tambah 8 entry baru ke `apps/web/src/domain/capabilities/affordanceCatalog.ts` untuk semua control yang teridentifikasi.
2. Refactor 5 komponen (`TargetCard`, `GateDetail`, `RuntimeTab`, `MigrationTab`, `ConnectorsTab`) supaya:
   - Import + panggil `affordanceFor(<id>, ctx)`.
   - Pakai `affordanceFor` decision untuk `disabled`, `data-affordance-id`, `title` (operator copy).
   - Tetap call transport di handler tanpa `catch {}` silent — kalau affordance bilang `enabled: false`, handler return early; kalau `enabled: true` dan call gagal, lempar ke notify lane (existing pattern di `TargetCard.deploy`).
3. Tulis test untuk tiap affordance baru (mirror `affordanceCatalog.test.ts:41-53` pattern yang sudah ada untuk `release.deploy.button`).
4. Update `docs/plans/wiring/33-frontend-declarative-affordances.md` (jika sudah landed) untuk mencatat penambahan, atau buat catatan di plan ini sebagai SSOT.

### Out of scope

- Implement backend executor untuk `release.publish` / `gate.*` / `runtime.cancel_job` / `migration.*` / `connector.*`. Itu Phase 6+ work yang membutuhkan capability profile, audit log, dan dispatcher wiring sendiri.
- Refactor optimistic UI di `GateDetail` (yaitu `useGates.getState().addSigner()` / `.override()` yang dipanggil sebelum transport). Optimistic update tetap valid untuk frontend-only state; cuma backend mirror yang harus di-gate.
- A11y / keyboard nav comprehensive overhaul untuk screen nascent (tracked terpisah).
- Telemetry hook (tracked terpisah).
- Hide tab Migration/Connectors/Shell dari Topbar — tab tetap visible sebagai surface PRD; cuma button mutating-nya yang gated.

## Workflow-as-code control plane

```yaml
slice: affordance-fake-feature-closeout-2026-05-10
priority: P1
area: cockpit-ux
owners:
  - web
depends_on: []
steps:
  - id: catalog_entries
    do: 'Add 8 affordance entries for release.publish/generate_notes, gate.signoff/override, runtime.cancel_job, migration.create_draft, connector.connect/disconnect'
    file: apps/web/src/domain/capabilities/affordanceCatalog.ts
  - id: target_card_refactor
    do: 'TargetCard publish + generate_notes via affordanceFor()'
    file: apps/web/src/components/Release/TargetCard.tsx
  - id: gate_detail_refactor
    do: 'GateDetail signoff + override via affordanceFor(); skip transport.send when not enabled but keep optimistic store update'
    file: apps/web/src/components/Gates/GateDetail.tsx
  - id: runtime_tab_refactor
    do: 'RuntimeTab cancel button via affordanceFor()'
    file: apps/web/src/components/Runtime/RuntimeTab.tsx
  - id: migration_tab_refactor
    do: 'MigrationTab New draft button via affordanceFor()'
    file: apps/web/src/components/Migration/MigrationTab.tsx
  - id: connectors_tab_refactor
    do: 'ConnectorsTab connect+disconnect via affordanceFor()'
    file: apps/web/src/components/Connectors/ConnectorsTab.tsx
  - id: tests
    do: 'Add 8 unit tests in affordanceCatalog.test.ts mirroring the release.deploy.button pattern'
    file: apps/web/src/domain/capabilities/affordanceCatalog.test.ts
  - id: validate
    do: 'pnpm -F web typecheck && pnpm -F web test && pnpm -F web build && pnpm -F web size'
acceptance:
  - 'Every visible NotWired button has data-affordance-id attribute'
  - 'Hovering any disabled NotWired button shows operator copy via title attribute'
  - 'commandStatus(<id>) returning not_wired forces button to disabled regardless of other gates'
  - 'No regression in TargetCard.test.tsx + existing affordance tests'
  - 'Bundle budget unchanged (size-limit green)'
```

## Affordance entries to add

Tambahkan ke `SPECS` array di `apps/web/src/domain/capabilities/affordanceCatalog.ts:63`. Pakai pola yang sudah ada (single-line objek dengan `id/component/command/when?/enabledIf/disabledCopy`).

```ts
{
  id: 'release.publish.button',
  component: 'ReleaseTab.PublishButton',
  command: 'release.publish',
  when: { hasTransport: true, hasSessionId: true },
  enabledIf: { commandStatus: 'implemented', gateReady: true },
  disabledCopy: 'Release publish backend is not wired yet.',
},
{
  id: 'release.generate_notes.button',
  component: 'ReleaseTab.GenerateNotesButton',
  command: 'release.generate_notes',
  when: { hasTransport: true, hasSessionId: true },
  enabledIf: { commandStatus: 'implemented' },
  disabledCopy: 'Release notes generator is not wired yet.',
},
{
  id: 'gate.signoff.button',
  component: 'GateDetail.SignOffButton',
  command: 'gate.signoff',
  when: { hasTransport: true, hasSessionId: true },
  enabledIf: { commandStatus: 'implemented' },
  disabledCopy: 'Gate signoff requires persistence + audit; not wired.',
},
{
  id: 'gate.override.button',
  component: 'GateDetail.OverrideButton',
  command: 'gate.override',
  when: { hasTransport: true, hasSessionId: true },
  enabledIf: { commandStatus: 'implemented' },
  disabledCopy: 'Gate override requires reason+expiry+audit; not wired.',
},
{
  id: 'runtime.cancel_job.button',
  component: 'RuntimeTab.CancelButton',
  command: 'runtime.cancel_job',
  when: { hasTransport: true, hasSessionId: true },
  enabledIf: { commandStatus: 'implemented' },
  disabledCopy: 'Job cancellation backend is not wired yet.',
},
{
  id: 'migration.create_draft.button',
  component: 'MigrationTab.NewDraftButton',
  command: 'migration.create_draft',
  when: { hasTransport: true, hasSessionId: true },
  enabledIf: { commandStatus: 'implemented' },
  disabledCopy: 'Migration packets require executor.migration profile; not wired (Phase 7).',
},
{
  id: 'connector.connect.button',
  component: 'ConnectorsTab.ConnectButton',
  command: 'connector.connect',
  when: { hasTransport: true },
  enabledIf: { commandStatus: 'implemented' },
  disabledCopy: 'Connector connect flow is not wired yet.',
},
{
  id: 'connector.disconnect.button',
  component: 'ConnectorsTab.DisconnectButton',
  command: 'connector.disconnect',
  when: { hasTransport: true },
  enabledIf: { commandStatus: 'implemented' },
  disabledCopy: 'Connector disconnect flow is not wired yet.',
},
```

Catatan: `gate.signoff/override` tidak pakai `gateReady` karena gate signoff **adalah** mekanisme untuk membuat gate ready. Visibility tetap berdasarkan logic existing di GateDetail (`canSignOff`, `gate.state !== 'pass'`); affordance hanya menentukan **enabled** dari yang sudah visible.

## Komponen refactor pattern

Pola identik `TargetCard.deploy` (existing baseline yang benar):

```ts
// 1. Compute affordance status
const cmdStatus = toAffordanceStatus('<command-id>');
const decision = affordanceFor('<affordance-id>', {
  commandStatus: cmdStatus,
  hasTransport: !!transport,
  hasSessionId: !!sessionId,
  // gateReady jika relevan
});

// 2. Handler: early-return jika tidak enabled
const handler = async () => {
  if (!decision.enabled) return;
  if (!transport || !sessionId) return; // tetap defensive
  try {
    await transport.send(sessionId, '<command-id>', { ... });
  } catch (err) {
    // jangan silent — biarkan notify lane handle
    // (existing TargetCard.deploy: `/* surfaced via notify */` comment OK karena
    // global error boundary di transport. Jangan ubah kontrak existing.)
  }
};

// 3. Tombol
<button
  onClick={handler}
  disabled={!decision.enabled}
  data-affordance-id={decision.affordanceId}
  title={decision.disabledReason ?? ''}
>
  Label
</button>
```

`toAffordanceStatus` helper sudah didefinisikan inline di `TargetCard.tsx:16-20`. Untuk plan ini — extract ke `affordanceCatalog.ts` (tambah `export function toAffordanceStatus(id: string)`) supaya 5 komponen tidak masing-masing redeclare. Trivial change, satu test sudah cukup karena memberi backing existing untuk `release.deploy.button`.

## Test pattern

Tambah ke `apps/web/src/domain/capabilities/affordanceCatalog.test.ts`. Mirror exactly `affordanceCatalog.test.ts:41-53` (existing `release.deploy.button` test). Per affordance baru, minimum:

```ts
describe('<affordance-id>', () => {
  it('disabled when command not_wired', () => {
    const d = affordanceFor('<id>', { commandStatus: 'not_wired', hasTransport: true, hasSessionId: true });
    expect(d.enabled).toBe(false);
    expect(d.disabledReason).toMatch(/not wired/i);
  });
  it('enabled when command implemented and prerequisites met', () => {
    const d = affordanceFor('<id>', { commandStatus: 'implemented', hasTransport: true, hasSessionId: true });
    expect(d.enabled).toBe(true);
  });
});
```

8 affordance × 2 test = 16 test baru. Plus update existing `TargetCard.test.tsx:78-87` (test `release.publish` dispatch) supaya assert button **disabled** karena affordance not_wired (sebelumnya test itu valid karena tanpa gating; sekarang harus expect button disabled atau bypass via mock catalog).

## Verification

1. `pnpm -F web typecheck` PASS.
2. `pnpm -F web test -- --run apps/web/src/domain/capabilities/affordanceCatalog.test.ts` PASS dengan 16 test baru.
3. `pnpm -F web test -- --run apps/web/src/components/Release/TargetCard.test.tsx` PASS (publish test mungkin perlu update — lihat di atas).
4. `pnpm -F web test` full suite PASS.
5. `pnpm -F web build && pnpm -F web size` PASS, bundle initial ≤ baseline (catalog hanya nambah ~8 objek static, ~1 kB max).
6. Manual smoke (dev server):
   - Buka Release panel → ada target dummy → Publish + Release notes button **disabled** dengan title "Release publish/notes backend is not wired yet."
   - Buka Gate detail dengan gate state `fail` → Sign off + Override input field tetap ada, tapi button disabled dengan title operator copy.
   - Buka Runtime tab dengan job dummy `running` → Cancel button disabled.
   - Buka Migration tab → "New draft" disabled.
   - Buka Connectors tab → Connect (provider available) + Disconnect (jika ada) disabled.
7. Grep verifier: `grep -rn 'data-affordance-id' apps/web/src/components/` harus mengembalikan ≥ 9 baris (8 button baru + 1 existing deploy).

## UX impact

**Before**: User klik "Sign off" / "Publish" / "New draft" → tidak ada feedback. Action seolah berhasil (optimistic update di GateDetail), tapi backend tidak melakukan apa pun. User akhirnya bingung kenapa state tidak persist saat reload.

**After**: Button disabled secara konsisten dengan tooltip yang menjelaskan kapan/mengapa. UX maturity 5 screen (Release, Gates, Runtime, Migration, Connectors) naik ≥ 1 poin di kolom "NotWired" pada audit scorecard, mengubah avg dari 1.5–3.3 → 2.5–4.3. Tidak ada visual chrome change yang besar — disabled button + title copy ringan.

## Risks

1. **Test breakage di `TargetCard.test.tsx:78-87`** — test existing assert dispatch `release.publish` sukses; setelah affordance gate, button disabled. Mitigasi: update test untuk explicit assert disabled state, mirror pattern test deploy.
2. **`GateDetail` optimistic update** — store mutates lokal sebelum transport call. Setelah affordance gate menutup transport call, optimistic update tetap berjalan (karena `addSigner`/`override` dipanggil sebelum gate). Ini secara teknis OK (frontend-only state, tidak ada side effect), tapi visually inkonsisten kalau backend pernah terkonek. Mitigasi: pindahkan optimistic update ke dalam `if (decision.enabled)` block sehingga state hanya berubah ketika action benar-benar valid.
3. **`MigrationTab` PacketDetail** — kalau "New draft" tidak bisa diklik, panel kanan tidak akan pernah render dengan packet baru. Itu **memang behavior yang diinginkan** untuk tahap pre-Phase-7. Demo data masih bisa di-inject via `useMigration.getState().setActive(...)` di console untuk testing.
4. **A11y regression** — `disabled` HTML attr menghapus button dari tab order. Mitigasi: tambah `aria-disabled="true"` jika perlu tetap focusable untuk screen reader (tooltip readability). Untuk plan ini: skip — pattern existing (`TargetCard` deploy button) tidak pakai aria-disabled, biarkan konsisten.

## Rollback

- Revert satu file: `apps/web/src/domain/capabilities/affordanceCatalog.ts` ke pre-plan state hapus 8 entry. Komponen yang refactored akan log warning di console (`Unknown affordance.`) tapi tidak crash karena `affordanceFor` returns `enabled: false` for unknown ID — yang justru tetap aman (button disabled). Atau revert per komponen.

## Timeline

Effort total: 2–3h fokus tunggal sesi.
- 30m: tambah 8 affordance entry + extract `toAffordanceStatus` helper.
- 60m: refactor 5 komponen.
- 45m: tambah 16 test + update test `TargetCard` publish.
- 15m: validate + manual smoke + size check.
- 20m: tulis closeout note di README plans.

Tidak ada dependency eksternal. Bisa dijalankan independen dari F4 (yang fokus perf).

## Critical files

- `apps/web/src/domain/capabilities/affordanceCatalog.ts` (extend SPECS)
- `apps/web/src/domain/capabilities/affordanceCatalog.test.ts` (add 16 tests)
- `apps/web/src/components/Release/TargetCard.tsx` (publish + generate_notes gate)
- `apps/web/src/components/Release/TargetCard.test.tsx` (update publish test)
- `apps/web/src/components/Gates/GateDetail.tsx` (signoff + override gate, move optimistic update)
- `apps/web/src/components/Runtime/RuntimeTab.tsx` (cancel gate)
- `apps/web/src/components/Migration/MigrationTab.tsx` (new draft gate)
- `apps/web/src/components/Connectors/ConnectorsTab.tsx` (connect + disconnect gate)
- `docs/plans/README.md` (move from active/audit list to closed handoffs after merge)

## Existing utilities to reuse

- `affordanceFor(id, ctx)` di `apps/web/src/domain/capabilities/affordanceCatalog.ts:175-195`.
- `commandStatus(id)` di `apps/web/src/generated/commandCatalog.ts` (autogen, jangan edit manual).
- `toAffordanceStatus(id)` di `apps/web/src/components/Release/TargetCard.tsx:16-20` — extract ke `affordanceCatalog.ts` untuk reuse.
- Pola test di `affordanceCatalog.test.ts:41-53`.
- Pola button gating di `TargetCard.tsx:98-105` (deploy button) — pakai sebagai canonical reference.
