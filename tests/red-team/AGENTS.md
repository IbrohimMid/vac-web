# tests/red-team

Red-team tests. Adversarial inputs against translator, profile, auth, and DOMPurify rendering.

## Run

- Rust side: `cargo test -p red-team-tests`.
- UI XSS suite: `pnpm --filter @vac-web/web test -- --run` (vectors live under `apps/web/src/**/*.redteam.test.ts`).

## Coverage

- 13 DOMPurify XSS vectors (slice 2.6) — all green.
- 7 predicate parser fuzz cases (slice 2.6).
- Profile escalation attempts (slice 20).
- WS auth bypass attempts (slice 21).
- Handoff signer-spoof / pin-tamper attempts (Pass E1).

## Notes

- Adding a new red-team vector: add the failing case first, fix the runtime, then commit both. Never weaken the assertion to make the test pass.
