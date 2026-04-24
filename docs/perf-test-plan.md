# Performance Test Plan

**Status**: v1 (locked for Phase 0.5)
**Scope**: Benchmarks + budgets + CI enforcement for `apps/web`. Complements `frontend-rules.md`.

---

## 1. Principles

1. **Budgets are gates, not aspirations.** Regressions > 15% block merge.
2. **Measure user-perceived latency**, not synthetic averages.
3. **Cover the lag-prone flows**: transcript streaming, diff rendering, workbench switching, findings list.
4. **Track over time.** Store per-commit baselines; surface trends in PR comments.

---

## 2. Tooling

- **Playwright** for real browser perf traces (Chromium primary; Firefox smoke).
- **Vitest** for micro-benchmarks (state selectors, markdown worker throughput).
- **Size-limit** for bundle budgets.
- **Lighthouse CI** for static page metrics (FCP, TTI).
- **Chrome DevTools Protocol** (via Playwright) for heap snapshots.

Baselines stored in `perf/baselines/<metric>.json` per PR target branch.

---

## 3. Benchmarks

### 3.1 `bench:transcript`

**Scenario**: simulate a 10,000-message session; stream 500 tokens/s into a new assistant message for 60 seconds while scrolling through history.

**Metrics**:
| Metric | Budget |
|---|---|
| FPS p95 during streaming | ≥ 50 |
| Time-to-first-token paint | ≤ 50ms |
| Scroll jank (frames > 50ms) | ≤ 1% |
| Heap growth over 60s | ≤ 50MB |
| Event listeners after session close | 0 orphaned |

**Failure modes caught**: transcript-wide rerender on delta, markdown re-parse per token, listener leaks.

### 3.2 `bench:diff`

**Scenario**: open a 100-file changeset with average 20KB per file; expand 10 files; scroll hunks.

**Metrics**:
| Metric | Budget |
|---|---|
| File list first paint | ≤ 200ms |
| Full list mount | ≤ 1000ms |
| Expand file body | ≤ 300ms p95 |
| Syntax highlight visible block | ≤ 150ms |
| Heap after close | ≤ initial + 10MB |

### 3.3 `bench:workbench`

**Scenario**: cycle through all workbench tabs 20 times; navigate into Approvals, Review, Runtime, Sessions, AssessmentReport.

**Metrics**:
| Metric | Budget |
|---|---|
| Tab switch latency p95 | ≤ 80ms |
| Heap after cycles | ≤ initial + 20MB |
| Listener count after | stable (no growth) |

### 3.4 `bench:findings`

**Scenario**: AssessmentReport with 10,000 findings across severities; filter, sort, expand evidence.

**Metrics**:
| Metric | Budget |
|---|---|
| Initial render p95 | ≤ 400ms |
| Filter latency p95 | ≤ 120ms |
| Scroll FPS | ≥ 55 |
| Expand evidence p95 | ≤ 200ms |

### 3.5 `bench:shell`

**Scenario**: shell drawer with dense output (tmux/htop-like), 5000 lines/s for 10s, then close.

**Metrics**:
| Metric | Budget |
|---|---|
| Input-to-paint latency | ≤ 40ms p95 |
| Drawer close → GC | xterm disposed within 500ms |
| Heap after close | ≤ initial + 5MB |

### 3.6 `bench:bundle`

**Metrics** (size-limit):
| Bundle | Budget (gzipped) |
|---|---|
| Initial (`main`) | ≤ 250KB |
| Workbench chunks (each) | ≤ 100KB |
| Shell chunk (xterm) | ≤ 200KB |
| CodeMirror chunk | ≤ 150KB |
| Monaco chunk (if loaded) | ≤ 1MB |
| Shiki worker | ≤ 300KB |

### 3.7 `bench:cold-start`

**Scenario**: fresh page load → session attached → first message visible.

**Metrics**:
| Metric | Budget |
|---|---|
| FCP | ≤ 1200ms |
| TTI | ≤ 2500ms |
| WS connect | ≤ 300ms |
| First session.snapshot render | ≤ 500ms after receive |

### 3.8 `bench:reconnect`

**Scenario**: drop WS mid-session, reconnect, replay 500 events.

**Metrics**:
| Metric | Budget |
|---|---|
| Reconnect attempt | within 1s of drop |
| Replay completion | ≤ 800ms for 500 events |
| UI consistency | no duplicate messages, no missing deltas |

---

## 4. Micro-benchmarks (Vitest)

- Store selector performance: < 10µs per `useStore(s => s.x)` equivalent.
- Markdown worker throughput: ≥ 50KB/s parse rate.
- Diff worker: 100KB diff in < 300ms.
- Shiki worker: 1000-line code highlight in < 400ms (cached after first).
- RAF scheduler: 1000 buffered events drain in ≤ 1 frame (~16ms).

---

## 5. Device-class profiles

`VAC_WEB_PERF_PROFILE` env picks budget set:

| Profile | DOM cap | FPS min | Heap cap | Notes |
|---|---|---|---|---|
| `desktop-highend` | 12,000 | 55 | 100MB | default when high CPU cores |
| `laptop` (default) | 8,000 | 50 | 50MB | baseline budgets |
| `low-end` | 4,000 | 40 | 25MB | chromebooks, older devices |

Auto-detection via UA + `navigator.hardwareConcurrency`; override via env.

CI runs against `laptop` profile. Dev can run locally with any profile.

---

## 6. CI integration

```yaml
# .github/workflows/perf.yml
jobs:
  perf:
    steps:
      - run: pnpm install
      - run: pnpm build
      - run: pnpm bench:bundle
      - run: pnpm bench:transcript
      - run: pnpm bench:diff
      - run: pnpm bench:workbench
      - run: pnpm bench:findings
      - run: pnpm bench:cold-start
      - run: pnpm bench:reconnect
      - run: pnpm bench:shell
      - run: node scripts/perf-compare.js
```

`perf-compare.js`:
- Loads baseline from target branch.
- Computes delta for each metric.
- Fails job if any metric regresses > 15%.
- Posts comment on PR with delta table.

Exemptions: label `perf-ack` on PR with justification in description.

---

## 7. Reporting

### PR comment example
```
🎯 Perf budgets

| Metric | Baseline | This PR | Δ | Status |
|---|---|---|---|---|
| transcript FPS p95 | 58 | 54 | -6.9% | ⚠ within budget |
| diff first paint | 180ms | 190ms | +5.5% | ✓ |
| bundle main | 242KB | 248KB | +2.5% | ✓ |
| workbench switch p95 | 72ms | 78ms | +8.3% | ✓ |
```

### Dashboard
`perf/dashboard.html` (generated nightly) shows trend graphs for trunk main.

---

## 8. Benchmark fixtures

Reproducible, committed fixtures in `perf/fixtures/`:
- `transcript-10k.json` — synthetic 10k-message session snapshot.
- `diff-100-files.json` — changeset fixture.
- `findings-10k.json` — assessment run with 10k findings.
- `shell-output.bin` — binary PTY stream capture.

Fixtures generated by `perf/generate-fixtures.ts`; do not hand-edit.

---

## 9. Profiling aids

Dev mode only (`import.meta.env.DEV`):
- Render counts per component (console.table on demand).
- Store subscribe counter warnings (> 20 subs on one slice → warn).
- Frame drop logger when p95 < 40fps over 3 seconds.
- Heap snapshot shortcut (`Ctrl+Shift+H`) triggers `performance.measureUserAgentSpecificMemory()`.

All stripped from production build.

---

## 10. Manual QA checklist

Quarterly, run by hand on real machines:
- Low-end laptop (4GB RAM, integrated GPU).
- Mid laptop (16GB).
- High-end desktop.
- Chrome, Firefox, Safari.

Scenarios:
- 2-hour continuous session with periodic streaming.
- 4 concurrent sessions in tabs.
- Shell drawer open while transcript streams.
- AssessmentReport with real full-depth output.

Report filed at `perf/manual-qa/<quarter>.md`.

---

## 11. Related

- [`frontend-rules.md`](./frontend-rules.md) — architecture rules that produce these budgets.
- [`architecture.md`](./architecture.md) — system performance factors.
- [`product-prd.md`](./product-prd.md) §8 — phase exit criteria include perf.
