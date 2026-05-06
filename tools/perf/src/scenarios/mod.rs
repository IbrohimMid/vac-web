//! Phase 2 perf scenarios — real per-subsystem drivers.
//!
//! Each submodule implements one driver that produces a `Measurement` for the
//! corresponding subsystem listed in `config/slo-budgets.yaml`. Drivers are
//! gated behind the `real_scenarios` Cargo feature so Phase 1 synthetic
//! measurements remain the default in CI until Phase 2 lands.
//!
//! Phase 2 acceptance (deferred from `remaining-work-execution-plan-2026-05-06.md`):
//! - Each driver spawns or attaches to a real local-bridge instance.
//! - Each driver emits realistic command/event payloads.
//! - Each driver measures end-to-end latency with adequate sample counts.
//! - After 2 weeks of real baseline data, flip CI default from
//!   `--measurement-only` to `--strict`.

pub mod command_ack;
pub mod command_manifest_refresh;
pub mod persisted_event_write;
pub mod topbar_interaction;
pub mod websocket_event_delivery;
