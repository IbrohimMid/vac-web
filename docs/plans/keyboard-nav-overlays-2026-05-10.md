---
id: plans.keyboard-nav-overlays-2026-05-10
title: 'Keyboard navigation + ESC handling for cockpit overlays'
priority: P1
area: cockpit-ux
status: closed
owners:
  - web
created: 2026-05-10
depends_on:
  - apps/web/src/domain/capabilities/affordanceCatalog.ts
---

# Keyboard nav for cockpit overlays — 2026-05-10

## Context

Audit UX maturity 2026-05-10 menemukan kolom **Keyboard nav rata-rata 1.8/5** di semua screen kecuali Topbar. Ini bertentangan langsung dengan PRD §6 prinsip 1:

> **Click-first, keyboard-equal** — every action via mouse, mirror via keyboard. No pure keyboard-only features.

Yang sudah ada (`apps/web/src/overlays/esc.ts:7-17`): handler global Esc → `useOverlays.dismissTopmost()`. Cukup untuk satu masalah (close), tapi tidak ada:

1. **Focus trap** di overlay aktif — Tab lompat keluar overlay ke surface dibawahnya.
2. **Auto-focus** elemen input/primary action saat overlay open.
3. **Focus restoration** — saat overlay tutup, fokus tidak kembali ke trigger.
4. **Action keybinding** — Enter tidak konsisten submit primary, Esc kadang tidak dismiss form (cuma overlay).
5. **Skip navigation** untuk panel multi-section (Release, Handoff).

Empat overlay kritikal yang harus dapat treatment penuh:
- `Release` (TargetCard list + NotesDraftView + ObservationsFeed)
- `Handoff` (PacketBuilder dengan ApprovalDialog nested)
- `Extensions Settings` (TrustActionMenu dropdown + QuarantineConfirmModal + PromotionRequestModal)
- `Approvals` (ApprovalsTab dengan decide button per row)
- `GateDetail` (sign-off + override form)

Menggunakan PRD §6 prinsip 7 ("Profile-aware UI — actions denied by current session profile are greyed with hover tooltip"), tooltip sudah landed via affordance closeout (plan terkait). Plan ini menambah kemampuan tooltip diakses tanpa mouse hover (focus + keyboard reveal).

## Closeout

Implemented in commit `4d28505`:

- `apps/web/src/hooks/useFocusTrap.ts` dan test-nya landed.
- Focus trap, focus restoration, and keyboard-submit behavior landed across GateDetail, overlay host, drawers/modals, and release/gate surfaces.
- Web validation passed (`pnpm -r typecheck`, `pnpm -r build`, `pnpm -r test`).

## Scope

### In scope

1. **Focus trap utility** — satu hook `useFocusTrap(active: boolean, ref)` yang:
   - Cycle Tab/Shift+Tab dalam container.
   - Auto-focus first focusable element saat `active` jadi true.
   - Restore previous focus saat `active` jadi false.
   - Reuse di 4 overlay target.

2. **Keybinding extensions** di overlay:
   - Enter di form primary submit (Sign off, Override, Decide approval, Connect, etc.). Pakai `<form onSubmit>` standar HTML, bukan custom listener.
   - Esc behavior layered: kalau ada nested dialog terbuka (Quarantine confirm), Esc tutup yang nested dulu; kalau form dirty, prompt confirm.
   - `Cmd/Ctrl+Enter` untuk action ber-risk (Override, Approve, Deploy) — preventif typo Enter.

3. **Visible focus ring** — token CSS global `--focus-ring` sudah ada (cek `apps/web/src/styles/`); pastikan setiap overlay button + form field mengonsumsinya konsisten.

4. **`aria-label`/`role` audit** — pastikan setiap overlay punya `role="dialog" aria-modal="true" aria-labelledby="..."` (yang sudah ada di GateDetail; replicate ke 3 overlay sisanya).

5. **Skip nav anchor** untuk Release panel (jump to Notes / Observations / Targets dengan keyboard shortcut yang dideklarasikan di overlay header).

### Out of scope

- Comprehensive screen-reader testing (NVDA/JAWS lab) — defer ke a11y dedicated plan.
- Custom keybinding editor (UI untuk user remap key) — non-goal v1.
- Vim-mode keybindings (j/k navigation) — non-goal v1.
- Migration/Connectors/Runtime tab — bukan overlay (full-page surface), tracked di terpisah.
- Composer + Topbar — sudah punya keyboard handling adequate.

## Workflow-as-code control plane

```yaml
slice: keyboard-nav-overlays-2026-05-10
priority: P1
area: cockpit-ux
owners:
  - web
depends_on:
  - apps/web/src/domain/capabilities/affordanceCatalog.ts
steps:
  - id: focus_trap_hook
    do: 'Create useFocusTrap hook'
    file: apps/web/src/hooks/useFocusTrap.ts
  - id: focus_trap_test
    do: 'Unit tests for focus trap'
    file: apps/web/src/hooks/useFocusTrap.test.ts
  - id: gate_detail
    do: 'Apply focus trap + form submit to GateDetail'
    file: apps/web/src/components/Gates/GateDetail.tsx
  - id: release_panel
    do: 'Apply focus trap to ReleasePanel; skip-nav to sub-sections'
    file: apps/web/src/components/Release/ReleasePanel.tsx
  - id: extensions_modals
    do: 'Apply focus trap to QuarantineConfirmModal + PromotionRequestModal'
    file: apps/web/src/components/Settings/Extensions/
  - id: approvals_tab
    do: 'Decide button keyboard handling + Cmd+Enter for approve'
    file: apps/web/src/components/Approvals/ApprovalsTab.tsx
  - id: handoff_packet
    do: 'Focus trap for HandoffTab packet builder; nested dialog escape order'
    file: apps/web/src/components/Handoff/
  - id: validate
    do: 'pnpm -F web typecheck/test/build/size + manual keyboard smoke'
acceptance:
  - 'Tab cycles only within active overlay (verified by test)'
  - 'Esc dismisses topmost overlay, restores focus to trigger'
  - 'Enter submits primary form action in 4 target overlays'
  - 'Cmd+Enter required for risky actions (override, approve, deploy)'
  - 'Every overlay container has role=dialog + aria-modal'
```

## Implementation pattern

`useFocusTrap` boilerplate:

```ts
import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement>) {
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (!container) return;
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    container.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('keydown', onKey);
      previousFocus.current?.focus();
    };
  }, [active, containerRef]);
}
```

Pakai di overlay:

```tsx
const ref = useRef<HTMLDivElement>(null);
useFocusTrap(true, ref);
return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="gate-title">...</div>;
```

## Test pattern

`apps/web/src/hooks/useFocusTrap.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
// Test: 1) auto-focus first element, 2) Tab from last → first, 3) Shift+Tab from first → last, 4) restore previous focus on unmount.
```

Per-overlay integration test: render overlay, fire `Tab` × N, assert `document.activeElement` cycle.

## Verification

1. `pnpm -F web typecheck && pnpm -F web test && pnpm -F web build && pnpm -F web size` PASS.
2. Manual smoke (dev server):
   - Klik trigger Release overlay → fokus auto-pindah ke first button.
   - Tab cycle dalam overlay; Shift+Tab balik.
   - Esc tutup, fokus kembali ke trigger button di Topbar.
   - Form Sign off: ketik nama, Enter → submit.
   - Form Override: ketik reason, Cmd+Enter → submit (Enter biasa tidak submit).
   - Approvals decide: tombol Approve gets focus, Cmd+Enter approve.
3. Grep verifier: `grep -rn 'role="dialog"' apps/web/src/components/` ≥ 5 baris (target overlay + existing).

## UX impact

PRD §6 prinsip 1 terpenuhi untuk 4 overlay kritikal. Avg keyboard nav score 1.8 → 4 di 4 overlay; aggregate cockpit score naik dari 2.7 → 3.3. Tidak ada visual regression — fokus ring sudah ada.

## Risks

1. **Focus trap konflik dengan nested overlay** — Quarantine confirm di dalam Extensions trust menu. Mitigasi: focus trap pakai stack pattern, container terdalam yang aktif.
2. **Auto-focus mengganggu transition** — fokus pindah saat overlay belum render full bisa cause flicker. Mitigasi: defer dengan `requestAnimationFrame` di useEffect.
3. **Cmd+Enter konflik dengan global shortcut** — periksa `apps/web/src/main.tsx` Cmd+K palette tidak overlap.

## Rollback

Hapus `useFocusTrap` import + ref di tiap overlay. Esc handler global tetap berfungsi karena unchanged.

## Timeline

Effort total: 2-3h fokus tunggal sesi.
- 30m: hook + test.
- 90m: apply ke 4 overlay (GateDetail, ReleasePanel, ExtensionsModals, HandoffPacket) + ApprovalsTab.
- 30m: integration test + manual smoke.
- 30m: doc + closeout.

## Critical files

- `apps/web/src/hooks/useFocusTrap.ts` (NEW)
- `apps/web/src/hooks/useFocusTrap.test.ts` (NEW)
- `apps/web/src/components/Gates/GateDetail.tsx`
- `apps/web/src/components/Release/ReleasePanel.tsx`
- `apps/web/src/components/Settings/Extensions/QuarantineConfirmModal.tsx`
- `apps/web/src/components/Settings/Extensions/PromotionRequestModal.tsx`
- `apps/web/src/components/Approvals/ApprovalsTab.tsx`
- `apps/web/src/components/Handoff/` (packet builder + approval dialog)
- `apps/web/src/overlays/esc.ts` (potentially extend with stack-aware dismiss)
