# Frontend Rules — Performance-First Cockpit

**Status**: v1 (locked for Phase 0.5; incorporates v2.1 addendum + 7 reinforcements)
**Scope**: Stack decisions, rendering architecture, performance budgets, lint rules, and CI gates for `apps/web`.

---

## 1. Stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| UI framework | React 18+ | architecture must be React 19 / concurrent-safe |
| Build | Vite | code-splitting + worker bundling |
| Language | TypeScript strict | `strict: true`, `noUncheckedIndexedAccess: true` |
| Domain state | Zustand (slice per-domain) | one store per domain; no megastore |
| Async / cache | TanStack Query | dedup, stale-while-revalidate |
| List virtualization | TanStack Virtual | transcript, findings, logs, diff |
| Routing | TanStack Router | type-safe, file-based |
| Terminal | xterm.js | shell drawer ONLY |
| Code editor | CodeMirror 6 | default; Monaco only via dynamic import when justified |
| Markdown | markdown-it + DOMPurify | custom streaming wrapper |
| Syntax highlight | Shiki (WASM) in Web Worker | lazy + visibility-gated |
| Diff | jsdiff + virtualized hunks | heavy diffs in worker |
| Styling | Tailwind + CSS variables | no runtime CSS-in-JS |
| Icons | lucide-react | plus text severity glyphs per `ux-grammar.md` |
| Event bus | mitt (tiny) | cross-domain one-shot only |

### Rejected
- Redux / global megastore
- React Context for data changing > 1×/sec
- CSS-in-JS runtimes (emotion, styled-components)
- Monaco as default
- Jotai (Zustand is simpler baseline for team standard)
- Service workers (no offline v1)

---

## 2. React 19 readiness

Even though v1 builds on React 18, architecture must be compatible with React 19 + concurrent rendering:

- Every external store subscribes via `useSyncExternalStore` (Zustand handles this).
- No `unstable_*` APIs.
- No `findDOMNode`.
- No legacy lifecycle methods (no `componentWillMount` / `componentWillReceiveProps`).
- `useTransition` used for non-urgent UI updates (filters, tab switches).
- Suspense boundaries scoped per domain area (not one top-level boundary).
- No tearing: state reads consistent within a render pass.

---

## 3. Render budget (hard CI gates)

| Metric | Budget |
|---|---|
| Active DOM nodes | ≤ 8,000 (default; device-class aware) |
| Per-component rerender rate | ≤ 10/s except composer cursor |
| FPS during streaming | ≥ 50fps p95, target 60 |
| Time-to-first-token paint | ≤ 50ms from WS event arrival |
| Scroll input → paint | ≤ 32ms p95 |
| Initial JS bundle | ≤ 250KB gzipped |
| Heap growth in 10k-msg session | ≤ 50MB over 60s streaming |
| Event listener leak | 0 orphaned listeners after session close |

Device class override via `VAC_WEB_PERF_PROFILE=desktop-highend | laptop | low-end` env; runtime reads UA hints and adjusts. The 8,000 number is a default budget, not sacred.

---

## 4. Store architecture

```
apps/web/src/stores/
├── session.ts          // current session, connection, profileId
├── transcript.ts       // Map<msg_id, Message>; hot window ids
├── streaming.ts        // active stream buffers; flush scheduler
├── composer.ts
├── workbench.ts        // active tab; per-tab state refs
├── approvals.ts
├── review.ts           // changeset + diff cache
├── runtime.ts          // jobs, job logs
├── assessment.ts       // runs, findings, diffs
├── handoff.ts
├── gates.ts
├── overlays.ts         // modal stack
├── notify.ts           // lane queues
├── systemPulse.ts
└── connectors.ts
```

### Rules
- Each store is independent; no cross-imports in reducers/actions.
- Components subscribe via **narrowest selector** (`useStore(s => s.x)`), never the whole store.
- Derived state via memoized selectors (`useStore(selector, shallow)`).
- Cross-store effects go through `mitt` event bus.
- **Event bus is for cross-domain one-shot signals only.** Forbidden: storing state on the bus, subscribing to bus for derived data. Bus signals trigger local store actions; consumers read state from stores.

---

## 5. Transcript architecture (highest-risk subsystem)

### Lifecycle
```
wire event → streaming buffer → RAF flush (≤ 33ms tick) → transcript store patch → affected <MessageRow/> rerenders only
```

### Hot window / cold freeze
- **Hot window**: last 50 messages; React rendered + live.
- **Cold**: serialize to HTML string (sanitized), store in `transcript.messages.<id>.renderedHTML`, mount via `<ColdMessage/>` which uses `dangerouslySetInnerHTML` + `React.memo` + never rerenders until explicit "Re-render" action.
- Freeze trigger: message exits hot window AND has received `transcript.completed`.

### `dangerouslySetInnerHTML` safety
- HTML sources exclusively from internal markdown-it renderer.
- All content passes DOMPurify with allowlist:
  - Allowed tags: `p, a, strong, em, code, pre, h1–h6, ul, ol, li, blockquote, img, span, div, table, thead, tbody, tr, td, th, hr, br`.
  - Allowed attrs: `href, src, alt, title, class, data-*` (data-attrs restricted namespace).
  - Stripped: `on*`, `<script>`, `<style>`, `<iframe>`, `javascript:` / `vbscript:` / `data:text/html` URIs.
- Connector-fed content (e.g., Notion export) is escaped-then-parsed, never trusted raw.

### Streaming markdown strategy
Two phases, eXplicit:
1. **During stream**: lightweight render — plain text + fenced code-block detection + line breaks. No full markdown parse.
2. **On `transcript.completed`**: full markdown-it parse, AST caching, commit replaced HTML.

Rationale: full incremental markdown parsing is fragile; deferring to completion is stable and perceptually indistinguishable (streaming text is readable as plain).

### Virtualization
- TanStack Virtual with dynamic row height (estimated + measured).
- Overscan 3–5 rows.
- Scroll anchor: auto-scroll only when user is within 100px of bottom ("stick-to-bottom" region). Never force scroll.

### Syntax highlight
- Shiki in Web Worker (`workers/shiki.worker.ts`).
- Main thread dispatches `{ code, lang }`, receives HTML.
- **Visibility-gated via `IntersectionObserver`**. Before visible: plain `<pre>` with CSS monospace (instant).
- Cache in worker: `Map<sha1(code+lang), html>`, LRU 500 entries.
- Code block > 10,000 chars → collapsed default with "Expand" button.

---

## 6. Workbench tabs

- **Lazy mount** on first select; after mount, `display: none` on other tabs (state preserved).
- **Unmount after 5 min idle** (configurable).
- Per-tab state slice; subscribe only when tab active.
- Tab switch does **not** refetch — TanStack Query stale-while-revalidate.

Dynamic imports per tab:
```ts
const Approvals = lazy(() => import('./Workbench/Approvals'));
```

---

## 7. Diff viewer

- File list first; body lazy on file click.
- Large diff (> 500 hunks) → hunks virtualized; default collapsed; word-level diff on-demand.
- Diff compute in `workers/diff.worker.ts` for files > 50KB.
- Reuses Shiki worker for syntax highlight in diff panes.

---

## 8. Shell drawer

- xterm.js mounted only when drawer opens; `dispose()` on close.
- Buffer cap: 10,000 lines; older lines truncated or moved to "Saved output".
- Addons: `fit`, `web-links`, `canvas` renderer. **No** `webgl` addon (instability across browsers).
- WS shell traffic: **binary frames** (not JSON base64 per byte).

---

## 9. Assessment UI

- Findings list virtualized, chunked by severity section.
- Evidence preview lazy on expand.
- `AssessmentDiff` render: 4 lazy tabs (resolved / persistent / regressed / new).
- Long-running run: streaming via `assessment.progress`. **Never polling.**
- Scorecard charts: pure CSS + SVG; no chart library in MVP (minimize bundle).

---

## 10. WebSocket & event drain

- **Single WebSocket per tab**, sessions multiplexed via `sessionId`.
- **Per-session event queue** (not one global queue):
  - Per-session cap: 200 pending events before client requests backpressure.
  - Cap forces `client.throttle` → bridge coalesces transcript deltas for that session.
- **RAF drain loop**: all queues batched per animation frame.
- **Reconnect**: exponential backoff 1s → 2s → 5s → 10s → 30s max; `last_event_id` replay.
- **Heartbeat**: 20s ping, 40s timeout.
- **Memory leak guard**: every subscribe returns cleanup; ESLint `react-hooks/exhaustive-deps` strict; custom rule `no-orphaned-ws-listener`.

---

## 11. Ten performance rules (enforced)

1. Transcript virtualization mandatory; `<Transcript/>` MUST NOT mount > 50 live rows.
2. Per-message render cache mandatory for cold history.
3. No global rerender on token stream — streaming store is separate.
4. Cold freeze after 50-window + completed.
5. Syntax highlight lazy + worker + visibility-gated.
6. Diff expansion lazy + worker for > 50KB.
7. Store split per domain; no megastore.
8. Markdown parsing in worker for messages > 20KB.
9. Hard default cap 8,000 active DOM nodes (device-class adjustable).
10. Profiling budget per feature before merge — PR must attach Playwright perf trace for touched flows; regression > 15% blocks merge.

---

## 12. Folder structure

```
apps/web/src/
├── main.tsx
├── app/                 # router, shell, error boundaries
├── transport/
│   ├── ws.ts
│   ├── queue.ts         # per-session queues + RAF drain
│   ├── replay.ts
│   └── backpressure.ts
├── stores/              # per §4
├── streaming/
│   ├── buffer.ts
│   ├── scheduler.ts     # RAF flush
│   └── coalesce.ts
├── workers/
│   ├── shiki.worker.ts
│   ├── markdown.worker.ts
│   └── diff.worker.ts
├── ui-contract/         # generated from schema
├── domain/              # hooks + selectors per feature
├── components/
│   ├── Transcript/
│   ├── Composer/
│   ├── Workbench/
│   │   ├── Approvals/
│   │   ├── Review/
│   │   ├── Sessions/
│   │   ├── Runtime/
│   │   ├── ReadinessHub/
│   │   ├── AssessmentReport/
│   │   ├── FindingCard/
│   │   ├── HandoffBuilder/
│   │   ├── HandoffPacketView/
│   │   └── …
│   ├── Shell/
│   ├── OverlayManager/
│   ├── CommandPalette/
│   ├── Topbar/
│   ├── NotifyLane/
│   ├── GateRibbon/
│   └── ConnectorManager/
├── perf/
│   ├── budget.ts        # dev-mode runtime assertions
│   ├── trace.ts         # perf.mark wrappers
│   └── profile.ts       # device-class detection
└── styles/
    ├── tokens.css
    └── tailwind.css
```

---

## 13. Lint & type rules (custom)

Add to `.eslintrc`:
- `no-whole-store-destructure` — bans `const s = useStore();` without selector.
- `no-orphaned-ws-listener` — flags `.addEventListener` without matching cleanup.
- `no-inline-event-handlers-on-danger-html` — double-check DOMPurify config.
- `no-dangerous-string-concat-html` — bans manual HTML string concat; must go through renderer.
- `no-redux`, `no-jotai` — enforce stack.
- `no-monaco-import` in non-dynamic paths — only lazy Monaco allowed.

TypeScript:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`

---

## 14. Anti-patterns (explicit ban list)

- `useContext` for data changing > 1×/sec.
- Destructure entire store (`const s = useStore()`).
- Render full transcript via `array.map` without virtualization.
- Re-parse markdown per token without cache.
- `JSON.stringify` in render path.
- Global `useEffect` with broad dep array.
- Mount Monaco / xterm at root layout.
- Single top-level Suspense boundary.
- Global Redux/Zustand store for everything.

---

## 15. Testing

- **Unit**: Vitest + React Testing Library. Store logic tested without components.
- **Integration**: Playwright. Real bridge fixture (mock engine responses).
- **Performance**: Playwright perf traces — `bench:transcript`, `bench:diff`, `bench:workbench`, `bench:findings`. Details in `perf-test-plan.md`.
- **Visual**: Percy or Chromatic snapshots for severity grammar consistency.
- **Accessibility**: axe-core in CI for every route.

---

## 16. Dev mode assertions (`perf/budget.ts`)

In `import.meta.env.DEV`, runtime assertions:
```ts
// fails loud in dev; no-op in prod
if (document.querySelectorAll('*').length > budget.maxDomNodes) {
  console.error('[perf budget] DOM cap exceeded', count, budget.maxDomNodes);
}
```

Assertions wrapped in tree-shaken `__DEV__` guard. Never ship to production.

---

## 17. Theming

- Light + dark via `[data-theme="dark"]`. System preference detected on first load; user override stored in localStorage.
- All colors via CSS variables; no hardcoded hex in components.
- Severity tokens per `ux-grammar.md` §10.

---

## 18. Related

- [`ux-grammar.md`](./ux-grammar.md) — severity, subsystems, lanes, facets, overlays.
- [`protocol.md`](./protocol.md) — event catalog consumed by transport layer.
- [`product-prd.md`](./product-prd.md) — feature scope.
- [`perf-test-plan.md`](./perf-test-plan.md) — CI benchmarks.
- [`capability-profiles.md`](./capability-profiles.md) — profile-awareness in palette.
