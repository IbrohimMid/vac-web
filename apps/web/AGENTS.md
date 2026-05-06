# apps/web

React + Vite UI cockpit. Browser-side control plane.

## Layout

- `src/domain/` — domain logic, state machines, capability classifiers (`src/domain/capabilities/`).
- `src/components/` — UI components grouped by surface (Topbar, Workbench, Approvals, Review, Sessions, Runtime, Connectors, Mention).
- `src/transport/` — WS client + reconnect.
- `src/notify/` — notify lane wiring (transient / persistent / sticky, slice 24).

## Hard rules

- All cross-layer imports validated by `scripts/check-architecture-boundaries.mjs` (slice 37).
- DOMPurify is the only sanitizer; no `dangerouslySetInnerHTML` outside the sanitized renderer.
- Bundle budget enforced by `size-limit` config in `package.json`; bumps require a measured improvement or PR justification.
- Capability classifiers under `src/domain/capabilities/` use the canonical export shape (`classify<Name>`, `is<Name>Event`, `<NAME>_CODES`, `<NAME>_FALLBACK`); scaffold new ones with `node scripts/vac-capability-new.mjs <name>`.
- Surfaces consume health states from a capability module — never invent local states.

## Tests

- `pnpm --filter @vac-web/web test -- --run` — vitest unit + component (>550 tests as of 2026-05-06).
- `pnpm --filter @vac-web/web typecheck` — strict TS.
- `pnpm --filter @vac-web/web lint`.

## Anti-patterns

- Logging without `event` + `severity` keys.
- Inventing health states locally instead of consuming a capability module.
- Returning a fresh array from a Zustand selector each render (causes re-render churn — see Phase 4 audit hardening notes).
