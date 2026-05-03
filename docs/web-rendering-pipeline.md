# Web rendering, markdown, highlight, transcript, and worker pipeline (slice 50)

This doc captures the rules for the supporting web modules that broader
slices reference: composer internals, markdown rendering, syntax
highlighting, transcript freeze behavior, workers, main bootstrap, and
Vite env types.

## Modules in scope

```
apps/web/src/composer/        # Composer internals (selection, slash, mention)
apps/web/src/highlight/       # Syntax highlighting (Shiki / lazy-loaded)
apps/web/src/markdown/        # Markdown rendering + sanitize
apps/web/src/transcript/      # Transcript freeze + virtualization
apps/web/src/workers/         # Web workers (parser, highlight, etc.)
apps/web/src/main.tsx         # Entry
apps/web/src/vite-env.d.ts    # Vite type augmentation
apps/web/src/scripts/         # One-off browser-side scripts
```

## Rules

1. **Sanitization is mandatory.** `markdown/sanitize.ts` is the only
   sanitizer. Components must not call `dangerouslySetInnerHTML` outside
   it. Tests live in `markdown/sanitize.test.ts`.
2. **Highlighting runs in a worker.** UI components import the
   highlight client; the heavy theme/grammar load happens off the main
   thread.
3. **Transcript virtualization.** Long transcripts are rendered through
   the transcript module's virtualization layer; never map over the
   whole event list in a component.
4. **Transcript freeze.** Once a session is closed, the transcript is
   frozen: write paths are gated by capability checks. The freeze rule
   is enforced in `transcript/freeze.ts` (planned) with tests.
5. **Workers are pure.** A worker entry must not import from
   `apps/web/src/components` or `apps/web/src/stores`. Workers
   communicate via typed message contracts under
   `apps/web/src/workers/messages.ts` (planned).
6. **Main bootstrap is minimal.** `main.tsx` mounts the root component
   and wires the transport. No domain logic.
7. **Vite env types** live in `vite-env.d.ts`. New env vars require an
   ADR if they affect runtime behavior in production builds.

## Performance budgets

| Surface | Budget |
| --- | --- |
| First paint | < 1.0s on dev hardware. |
| Highlight render for a 200-line snippet | < 50ms on the worker. |
| Transcript scroll | 60fps with 5000 events virtualized. |
| Markdown sanitize round-trip | < 5ms per block at p95. |

Measured with `tools/perf/web-budgets.mjs` (planned).

## Validation gates

* `pnpm --filter @vac-web/web test -- --run` covers sanitize, composer,
  transcript, and worker contracts.
* `pnpm --filter @vac-web/web typecheck` enforces strict mode +
  `exactOptionalPropertyTypes`.
* `pnpm --filter @vac-web/web build` must produce a single deterministic
  bundle (CI compares hashes across runs).

## Anti-patterns to refuse

* Adding HTML-emitting code paths outside the markdown sanitizer.
* Importing components into workers.
* Letting the transcript map over an unbounded event array on the main
  thread.
* Hard-coding theme colors instead of using the design tokens.
