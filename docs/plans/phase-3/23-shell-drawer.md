# Plan 23 — Shell drawer (xterm.js)

**Phase**: 3 · **Depends on**: Plans 07, 19 · **Blocks**: Phase 3 exit · **Est**: 1 day

## Goal

On-demand shell pane using xterm.js. Binary-frame WS traffic for PTY throughput. Dispose on close; zero cost when unopened.

## Why this is hard

xterm.js is heavy. Loading it eagerly kills bundle budget. Also: keyboard focus trap, copy behaviour, buffer bounds, terminal resize propagation — all details that, if wrong, make shell drawer feel off.

## Scope

### In
- Lazy-mounted xterm.js on drawer open.
- Binary WS frames for PTY bidirectional.
- Resize propagation.
- Copy-on-select + paste.
- Buffer cap 10k lines.
- Dispose on close.
- Session-bound: one shell per session at a time.

### Out
- Multiple shells in split views (post-v1).
- Terminal recording / replay (N/A).

## Deliverables

```
apps/web/src/
├── components/
│   └── ShellDrawer/
│       ├── ShellDrawer.tsx           # overlay kind=shell_drawer
│       ├── TerminalMount.tsx         # actual xterm instance
│       ├── ShellToolbar.tsx
│       └── buffer.ts                 # saved output history
├── domain/
│   └── shell/
│       ├── hooks.ts
│       └── transport.ts              # binary WS framing
```

## Stages

### S1 — Lazy import + overlay kind (0.1 day)

Register `shell_drawer` in `overlays/registry.ts` with lazy import:
```ts
shell_drawer: lazy(() => import('../components/ShellDrawer')),
```

Invoked via palette action `shell.start` or keyboard shortcut `Ctrl+` `.

xterm chunk budget ≤ 200KB gzipped (per `perf-test-plan.md §3.6`).

**Exit**: first open fetches chunk; second open instant from cache.

### S2 — TerminalMount (0.3 day)

```tsx
function TerminalMount({ shellId }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(ref.current!);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData(data => transport.shellInput(shellId, data));
    const ro = new ResizeObserver(() => {
      fit.fit();
      transport.shellResize(shellId, term.cols, term.rows);
    });
    ro.observe(ref.current!);

    return () => {
      ro.disconnect();
      term.dispose();   // critical: dispose on unmount
    };
  }, [shellId]);

  // Output events wire in next stage.
  return <div ref={ref} className="xterm-root" />;
}
```

**NO** webgl addon — stability issues. Canvas is fine.

**Exit**: drawer opens → terminal visible → typing echoes (once S3 wired).

### S3 — Binary WS transport (0.2 day)

PTY output is byte-stream, not JSON. Use separate binary framing:
- Each frame: `[type_byte][shell_id_bytes (16)][payload]`.
- `type_byte`: `0x01` = output, `0x02` = input, `0x03` = resize, `0x04` = control.
- WS binary message, not text.

Main WS demuxes; PTY traffic goes to `domain/shell/transport.ts` which forwards to xterm instance.

This avoids base64-per-byte overhead.

**Exit**: throughput bench: 1MB PTY output in < 500ms without jank.

### S4 — Input + resize (0.1 day)

`term.onData`: send binary input frame.

Resize: on container resize (ResizeObserver) → `fit.fit()` → send resize frame with new cols/rows.

**Exit**: resize works cleanly; typing large paste does not overflow buffer.

### S5 — Copy / paste / select (0.1 day)

- Copy-on-select: `term.setOption('copyOnSelect', true)` — sets clipboard on mouse select.
- Paste: `Ctrl+Shift+V` (or `Cmd+V` on macOS) → `term.paste(clipboardText)`.
- Context menu: right-click for copy/paste options.

**Exit**: clipboard interactions work.

### S6 — Drawer chrome (0.1 day)

`ShellToolbar` atop terminal:
- Shell name / cwd display.
- Buttons: Split (future; disabled), Save output, Clear, Kill.
- Connection status (green dot).

Save output: copies xterm buffer to clipboard or downloads as text file.

Kill: sends `shell.kill { shellId }` → bridge SIGTERM to PTY child; on `shell.exited` event, terminal shows exit code.

**Exit**: toolbar actions work.

### S7 — Buffer discipline + saved output (0.1 day)

xterm scrollback 10k. If overflow: line falls off top.

User can "Save output" to push current buffer into a separate `SavedOutput` panel (component with virtualized text list) for later reference.

**Exit**: cap enforced; save populates side panel.

### S8 — Perf bench (0.1 day)

`bench:shell` per `perf-test-plan.md §3.5`:
- 5000 lines/s for 10s.
- Input → paint ≤ 40ms p95.
- Dispose on close → heap returns to baseline within 500ms.

**Exit**: bench green.

## Testing

- Integration: open, type, resize, paste, close.
- Perf bench.
- Heap tracking across open/close cycles.

## Exit criteria

- [ ] First open < 500ms (chunk load + mount).
- [ ] Binary PTY throughput meets perf budget.
- [ ] Clean dispose (no leak).
- [ ] Copy/paste works on all target browsers.
- [ ] Keyboard focus does not escape while drawer open.

## Risks

| Risk | Mitigation |
|---|---|
| xterm bundle creep | Lazy import; perf-test-plan caps |
| WebSocket binary not supported by tunnel | Document fallback: base64-encoded text frames (slower); detect negotiated subprotocol |
| Firefox focus quirks | Test on all browsers in CI |
| Paste of huge text freezes | Cap paste length (e.g., 100KB) with confirm for more |

## Related

- [`frontend-rules.md`](../../frontend-rules.md) §8
- [`perf-test-plan.md`](../../perf-test-plan.md) §3.5
- Plan 07 — bridge WS (binary frames support)
