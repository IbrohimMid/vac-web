# Test Runtime Profile - 2026-05-09

## Method

- Rust timing came from `cargo +nightly test --workspace -- -Z unstable-options --report-time` plus `/usr/bin/time` for wall clock.
- Web timing came from `pnpm -F web test --reporter=verbose` plus `/usr/bin/time` for wall clock.
- Vitest per-test ranking came from `pnpm -F web exec vitest run --reporter=json --outputFile=/tmp/web-vitest.json`.

## Pipeline Summary

| Pipeline | Declared tests | Executed tests | Passed | Ignored | Failed | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rust | 634 | 629 | 629 | 5 | 0 | 14.53s |
| Web | 687 | 687 | 687 | 0 | 0 | 15.57s |

## Rust

- Median positive per-test duration: `0.009s`
- Outlier threshold: `0.045s` (`5x` median)
- Sum of top 20 test durations: `17.142s`
- The raw median rounds to `0.000s` because many tests complete below millisecond precision; the positive median is the more useful signal.

### Top 20 Slowest Cargo Tests

| Rank | Test | Duration |
| --- | --- | ---: |
| 1 | `apps/local-bridge/tests/acp_driver.rs::x5c1_invalid_override_does_not_disarm_timeout` | `10.098s` |
| 2 | `apps/local-bridge/tests/session_resume_native.rs::x6_native_resume_acp_load_success_replays_updates` | `0.825s` |
| 3 | `apps/local-bridge/tests/session_resume_native.rs::x6_native_or_replay_unsupported_falls_back_to_replay` | `0.824s` |
| 4 | `apps/local-bridge/tests/acp_driver.rs::x5c1_no_duplicate_pending_event_after_invalid_override` | `0.735s` |
| 5 | `apps/local-bridge/tests/session_resume_native.rs::x6_acp_load_unsupported_hard_fails` | `0.575s` |
| 6 | `apps/local-bridge/tests/session_resume_modes.rs::x6_b43_acp_load_without_persistence_disabled` | `0.505s` |
| 7 | `apps/local-bridge/tests/session_resume_modes.rs::x6_b43_replay_only_still_works_after_matrix` | `0.505s` |
| 8 | `apps/local-bridge/tests/session_resume_modes.rs::x6_b43_native_or_replay_without_persistence_disabled` | `0.504s` |
| 9 | `apps/local-bridge/tests/ws_assessment.rs::assessment_run_with_file_persistence_uses_index_for_list_runs_and_event_log_for_report_replay` | `0.486s` |
| 10 | `apps/local-bridge/tests/acp_driver.rs::x5c2_tool_failed_audit_row_is_warn_not_error` | `0.295s` |
| 11 | `apps/local-bridge/tests/session_authenticate.rs::x5d_authenticate_stale_session_id_returns_session_not_found_without_event` | `0.268s` |
| 12 | `apps/local-bridge/tests/audit.rs::audit_writes_jsonl` | `0.202s` |
| 13 | `apps/local-bridge/tests/ws_assessment.rs::assessment_run_surfaces_worker_output_rejections` | `0.196s` |
| 14 | `apps/local-bridge/tests/acp_driver.rs::x5c1_explicit_allow_option_on_reject_is_kind_mismatch` | `0.176s` |
| 15 | `apps/local-bridge/tests/acp_driver.rs::x5c1_approval_pending_emitted_then_approve_resolves_prompt` | `0.173s` |
| 16 | `apps/local-bridge/tests/session_lifecycle.rs::session_resume_replays_history_and_switches_session` | `0.168s` |
| 17 | `apps/local-bridge/tests/ws_assessment.rs::assessment_run_with_file_persistence_falls_back_to_event_log_without_index` | `0.161s` |
| 18 | `apps/local-bridge/tests/acp_driver.rs::x5c1_reject_sends_reject_option_and_completes_prompt` | `0.154s` |
| 19 | `apps/local-bridge/tests/audit.rs::audit_separate_files_per_session` | `0.153s` |
| 20 | `apps/local-bridge/tests/acp_driver.rs::x5c2_edit_tool_update_fallback_correlates_by_approval_tool_call_hash` | `0.139s` |

### Outliers

All 20 rows above exceed `5x` the positive median. The tail is dominated by:

- One intentional timeout-style case at `10.098s`
- A cluster of session resume and ACP load/replay tests in the `0.5s` to `0.8s` band
- A few persistence and audit-path checks in the `0.15s` to `0.30s` band

### Rust Recommendations

- Move `apps/local-bridge/tests/acp_driver.rs::x5c1_invalid_override_does_not_disarm_timeout` to a slow/nightly-only bucket if the 10 second wait is intentional. It is the single largest Rust tail item by a wide margin.
- Split the `session_resume_native.rs` and `session_resume_modes.rs` setup paths so they reuse one bootstrapped fixture instead of paying repeated startup cost per case.
- Keep `ws_assessment.rs` and `audit.rs` on the main lane, but separate pure validation cases from persistence-heavy cases so the runtime-heavy scenarios can be isolated.
- Preserve `acp_driver.rs` as a focused integration suite, but split the slowest timeout and resume cases into their own files if you want Cargo's file-level parallelism to help more.

## Web

- Median per-test duration: `1.291ms`
- Outlier threshold: `6.454ms` (`5x` median)
- Sum of top 20 test durations: `2771.439ms`
- Wall time from the verbose run: `15.57s`
- The Vitest JSON ranking confirms the same long tail as the verbose run, but the wall clock is still dominated by shared import and environment cost rather than just the top 20 bodies.

### Top 20 Slowest Vitest Tests

| Rank | Test | Duration |
| --- | --- | ---: |
| 1 | `Composer slash commands › shows ACP commands in slash palette and inserts the slash text without invoking VAC actions` | `659.198ms` |
| 2 | `AssessmentReportDetail › renders a dedicated worker-output rejection banner and replay action` | `238.276ms` |
| 3 | `ApprovalsTab render › sends approval_id on approve` | `152.148ms` |
| 4 | `e2e X25519 + XChaCha20-Poly1305 sealer › round-trips a payload between two parties` | `151.079ms` |
| 5 | `ReadinessHub › surfaces query provenance in the active run header` | `129.641ms` |
| 6 | `PacketDetail render › sends rejector and surfaces reject errors` | `128.658ms` |
| 7 | `TargetCard › reflects the affordance catalog: Deploy button is disabled with the catalog's reason when release.deploy is not_wired` | `121.666ms` |
| 8 | `QuarantineConfirmModal › calls onConfirm when the confirm button is clicked` | `121.601ms` |
| 9 | `SessionPicker provider picker › renders bridge agent warning when no available_agents advertised` | `111.728ms` |
| 10 | `RegistryBrowser › sends registry.sync on mount and renders mixed local + remote entries` | `108.294ms` |
| 11 | `cockpit Topbar › shows ACP auth metadata in the topbar` | `105.410ms` |
| 12 | `FindingCard › shows the associated run query provenance badge` | `100.360ms` |
| 13 | `RunDetailsCard › shows validated and rejected candidate summaries` | `97.719ms` |
| 14 | `PromotionRequestModal › calls onConfirm when the confirm button is clicked` | `94.068ms` |
| 15 | `AssessmentReportDetail › copies a sanitized worker-output diagnostic for redacted samples` | `88.782ms` |
| 16 | `ReleasePanel › shows the empty-targets copy when no targets are configured` | `76.394ms` |
| 17 | `AgentThread renderer › renders thought block collapsed and expandable` | `72.747ms` |
| 18 | `toolActivity store › caps activities at ACTIVITY_CAP (spot check key)` | `71.750ms` |
| 19 | `DeployProgressList › renders the empty-state copy when no deploys are present` | `71.660ms` |
| 20 | `ToolActivityLane DOM rendering › renders "Observed read" for read kind` | `70.259ms` |

### Outliers

All 20 rows above exceed `5x` the median. The longest tests are concentrated in:

- Topbar and slash-command interaction coverage
- Full component render tests that likely pull in heavy app scaffolding
- A single crypto/e2e case that is legitimate but still expensive relative to the suite median

### Web Recommendations

- Break `Composer slash commands` into smaller assertions or a lighter harness. It is the largest Vitest hotspot by far and appears to pay for more app setup than the assertion itself.
- Review `AssessmentReportDetail`, `ApprovalsTab render`, `PacketDetail render`, `ReadinessHub`, `RegistryBrowser`, and `cockpit Topbar` for shared setup that can be moved into cheaper helpers.
- Keep the crypto/e2e sealer test, but isolate it from general DOM suites so it does not share the same expensive environment path.
- Prefer file splits over larger monolithic test files. Vitest already parallelizes by file, so smaller focused files are the easiest way to turn this long tail into useful concurrency.
- The verbose run shows `transform`, `import`, and `environment` overhead is substantial, so cutting shared imports and browser-style setup will usually pay off more than shaving a few milliseconds off individual assertions.

## CI Cost Estimate

The per-test sums below are an upper bound because both Cargo and Vitest parallelize work:

- Rust top 20 sum: `17.142s` per run
- Web top 20 sum: `2771.439ms` per run
- Combined top 20 sum: `19.913s` per run

If the repo runs these suites on every PR, then at `10 PR/day` the upper-bound savings from eliminating or isolating the current top 20 Rust and top 20 Web hotspots would be about `3.32 CI minutes/day`.

That estimate is intentionally conservative on the wall-clock side:

- Rust savings are partly hidden by Cargo's internal parallelism
- Web savings are partly hidden by shared import and environment cost
- Realized savings improve most when the slowest tests are split into separate files or moved to a slower lane instead of simply being made a little faster
