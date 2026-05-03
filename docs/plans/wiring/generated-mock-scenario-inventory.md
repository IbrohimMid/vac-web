# Mock scenario inventory (slice 34)

_Manual inventory of scenarios currently encoded in `tools/mock-engine/src/scenarios.rs`. Each row records whether the scenario uses canonical event IDs or is legacy mock-only._

| Scenario | Status | Canonical events | Notes |
| --- | --- | --- | --- |
| `assessment_index_rebuild` | canonical | `assessment.index.rebuild_started`, `assessment.index.rebuild_progress`, `assessment.index.rebuilt`, `assessment.index.rebuild_failed` | Mirrors slice 04 acceptance. |
| `review_changeset_basic` | canonical | `review.changeset_updated`, `review.file_diff_chunk` | Replaces legacy `changeset.*`. |
| `changeset_legacy_compat` | legacy_mock_only | `changeset.updated` | Adapter for tests that still subscribe to the legacy event. Replacement = `review.changeset_updated`. See `tools/mock-engine/scenarios/changeset-legacy-adapter.yaml`. |
| `shell_basic_output` | future_when_backend_lands | `shell.started`, `shell.output` | Mock-only until shell executor lands. See `tools/mock-engine/scenarios/shell-basic-output.yaml`. |
| `handoff_progress` | canonical | `handoff.execution_progress`, `handoff.completed` | |
| `workflow_step_progression` | canonical | `workflow.started`, `workflow.step.*`, `workflow.completed` | |
| `runtime_job_lifecycle` | canonical | `runtime.job_started`, `runtime.job_completed` | |
| `terminal_activity_log` | canonical | `terminal.activity` | Read-only surface. |

## Acceptance check

* Every scenario has a status. ✓
* Every `legacy_mock_only` scenario records a `replacement`. ✓
* `changeset.*` scenarios are scoped to compatibility tests, not production review surface. ✓
* At least one YAML scenario (`shell-basic-output.yaml`, `changeset-legacy-adapter.yaml`) is on disk and validates against `schema/mock-scenario.schema.json`. ✓

## Follow-ups

1. Generate `tools/mock-engine/src/generated/scenario_catalog.rs` from the YAML directory.
2. Add a parity test that asserts every `event` in YAML scenarios is present in `config/control-plane/event-catalog.yaml` (or marked `legacy_mock_only` with a replacement).
3. Port the remaining scenarios from `scenarios.rs` to YAML files in batches of two.
