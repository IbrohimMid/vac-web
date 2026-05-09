# Bundle Size Deep-Dive - 2026-05-09

## Method

- Production build captured from `pnpm -F web build`.
- Size baseline captured from `pnpm -F web size`.
- Chunk inventory captured from `apps/web/dist/assets/`.
- Dependency cross-reference pulled from `apps/web/package.json`.
- I checked for `rollup-plugin-visualizer`, `vite-bundle-analyzer`, and `webpack-bundle-analyzer`; none are installed in this workspace, so this audit uses the emitted build artifacts instead.

## Current Baseline

`size-limit` reports the current eager main chunk at `127.85 kB` gzip against a `140 kB` limit.

| Metric | Value |
| --- | ---: |
| Initial bundle | `127.85 kB` gzip |
| Limit | `140 kB` gzip |
| Headroom | `12.15 kB` gzip |
| Loading time | `2.5 s` on slow 3G |
| Running time | `36 ms` on Snapdragon 410 |

The Vite build output is consistent with that baseline:

| Chunk | Raw size | Gzip | Map |
| --- | ---: | ---: | ---: |
| `dist/assets/index-MrJO42sY.js` | `407.66 kB` | `129.01 kB` | `1,446.64 kB` |
| `dist/assets/xterm-CjuobZCu.js` | `340.38 kB` | `86.33 kB` | `673.95 kB` |
| `dist/assets/react-Bi_azaFt.js` | `189.68 kB` | `59.68 kB` | `833.47 kB` |
| `dist/assets/markdown.worker-CKzSgaxw.js` | `125.54 kB` | n/a | `487 kB` |
| `dist/assets/ReadinessHub-DKviLSW1.js` | `34.16 kB` | `9.53 kB` | `109.43 kB` |
| `dist/assets/HandoffTab-Be8JDfpn.js` | `22.30 kB` | `5.94 kB` | `58.77 kB` |
| `dist/assets/tanstack-UEfOowM2.js` | `16.10 kB` | `5.07 kB` | `52.20 kB` |

## Dependency Cross-Reference

The biggest direct dependencies in `apps/web/package.json` line up with the biggest emitted chunks:

| Dependency | Related chunk(s) | Read |
| --- | --- | --- |
| `@xterm/xterm` | `xterm-CjuobZCu.js`, `xterm-D1LkSqxI.css`, `addon-fit-D2hnqN10.js` | Largest single UI payload. This is the clearest lazy-load target. |
| `react`, `react-dom` | `react-Bi_azaFt.js` | Core runtime cost; mostly unavoidable, but it should stay shared and deduped. |
| `markdown-it`, `shiki` | `markdown.worker-CKzSgaxw.js` | Worker is large enough that keeping it isolated is the right tradeoff. |
| `@tanstack/react-query`, `@tanstack/react-virtual` | `tanstack-UEfOowM2.js` | Healthy split chunk, not the main problem. |
| `@noble/ciphers`, `@noble/curves`, `@noble/hashes` | `index-MrJO42sY.js` and app-specific feature chunks | Crypto is present but not the dominant size driver. |

Other notable feature chunks:

- `ReadinessHub-DKviLSW1.js` is the largest named app chunk outside the vendor/runtime bundles.
- `HandoffTab-Be8JDfpn.js`, `SessionsTab-Dt_sRaV9.js`, and `ApprovalsTab-7JtdjNkv.js` are each in the range where code-splitting decisions matter.

## Historical Trend

I searched `CHANGELOG.md` for published bundle-size numbers and did not find an earlier `kB` baseline to compare against.

- The only bundle-related historical note in the changelog is `PR #9 scope-bundle + executor.release@1.0.0 profile`.
- That entry does not publish a numeric bundle size, so there is no repo-local historical `kB` trend line to quote.

## Recommendations

1. Keep `@xterm/xterm` lazy-loaded. It is already split out, and it remains the biggest single chunk by a wide margin.
2. Keep the markdown worker isolated. It is large, but the worker split is doing real work for the main bundle.
3. Audit `ReadinessHub`, `HandoffTab`, and `SessionsTab` for any accidental imports from `xterm` or markdown helpers that can be pushed behind the lazy boundary.
4. Watch `react-Bi_azaFt.js` as a proxy for shared framework growth. React itself should stay shared; if this grows much more, it usually means too much framework-adjacent code is getting pulled into the core shell.
5. If a future bundle budget becomes Phase 3 work, target the `xterm` surface first, then the markdown worker, then the largest app feature chunks.

## Phase 3 Relevance

Bundle reduction is a plausible Phase 3 candidate, but it is lower leverage than the runtime and coverage work tracked in the other audit branches.

The most realistic Phase 3 wins are:

- further isolating the `xterm` shell/editor surface
- keeping the markdown worker fully off the eager path
- trimming imports in `ReadinessHub` and the other top-level feature chunks

## UX Impact

None. This is an audit-only branch.

The current bundle remains inside budget at `127.85 kB` gzip, so there is no immediate user-facing regression signal from this deep-dive.
