# Rustdoc Coverage Audit - 2026-05-09

## Method

- Ran `RUSTDOCFLAGS='-Z unstable-options --show-coverage -W missing_docs' cargo +nightly doc --workspace --no-deps`.
- The first stable attempt failed because `--show-coverage` requires `-Z unstable-options`; the final audit data below comes from the nightly run.
- Total warning count from the final log: `1525`.
- Coverage percentages below come from rustdoc's `--show-coverage` tables.
- `Estimated total public items` is inferred from rustdoc's documented count and percentage, so the numbers are approximate but consistent enough for ranking.

## Crate Coverage

| Crate | Documented | Estimated total public items | Missing docs | Coverage |
| --- | ---: | ---: | ---: | ---: |
| `protocol-rs` | 2 | 222 | 220 | 0.9% |
| `codegen` | 2 | 26 | 24 | 7.7% |
| `bridge-core` | 14 | 95 | 81 | 14.7% |
| `perf` | 4 | 24 | 20 | 16.7% |
| `relay-service` | 16 | 79 | 63 | 20.3% |
| `mock-engine` | 21 | 93 | 72 | 22.6% |
| `red-team` | 5 | 20 | 15 | 25.0% |
| `local-bridge` | 368 | 1443 | 1075 | 25.5% |
| `profile-core` | 30 | 116 | 86 | 25.9% |
| `vac-integration` | 2 | 7 | 5 | 28.6% |

Notes:

- `local-bridge` is the largest absolute gap by far: 1075 estimated undocumented public items.
- `protocol-rs` is the lowest percentage gap and is mostly generated surface, so it should be fixed at the generator/template layer.
- `mock-acp` is not in the worst 10; its coverage is materially better than the crates above.

## Highest-Impact Files

These are the files with the most missing-doc warnings in the final log.

| File | Missing-doc warnings |
| --- | ---: |
| `apps/local-bridge/src/handoff/packet.rs` | 107 |
| `apps/local-bridge/src/agent_runtime/acp/types.rs` | 86 |
| `apps/local-bridge/src/handoff/mod.rs` | 84 |
| `packages/profile-core/src/profile.rs` | 57 |
| `apps/local-bridge/src/storage/assessment_index.rs` | 45 |
| `apps/local-bridge/src/session/handle.rs` | 44 |
| `apps/local-bridge/src/ws/envelope.rs` | 44 |
| `apps/local-bridge/src/agent_runtime/errors.rs` | 33 |
| `apps/local-bridge/src/agent_runtime/acp/tool_activity.rs` | 32 |
| `apps/local-bridge/src/config/resume_policy.rs` | 32 |

High-leverage files outside the raw top 10:

- `tools/perf/src/main.rs` is the public entrypoint for perf measurements and should stay documented even though its warning volume is lower.
- `apps/relay-service/src/main.rs` is another public entrypoint and should not be left as a doc afterthought.
- `tests/integration/src/lib.rs` is a test harness surface, but it still benefits from docs because other crates depend on it operationally.

## Recommended Rollout

1. Fix the shared foundations first: `protocol-rs`, `bridge-core`, and `profile-core`.
2. For generated surfaces under `packages/protocol-rs/src/v1/generated/*` and `apps/local-bridge/src/generated/*`, update the generator or templates. Do not hand-edit generated output.
3. Attack the `local-bridge` public API next, starting with `handoff/*`, `agent_runtime/*`, `session/*`, `storage/*`, and `ws/*`.
4. Document the entrypoints `tools/perf/src/main.rs` and `apps/relay-service/src/main.rs` once the shared surfaces are stabilized.
5. Leave test harness crates and lower-level support files for last, unless they are the only remaining source of a public API.

## UX Impact

None. This is a docs-only audit.

The practical user-facing upside is indirect: clearer public API docs reduce review cost and make it easier to spot accidental behavior changes before they land.
