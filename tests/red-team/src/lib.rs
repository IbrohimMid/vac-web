//! Red-team test harness for vac-web.
//!
//! Phase 0.5 layer: profile enforcement (Layer 1) testable without a running
//! bridge. Tests here exercise `profile-core` directly against the real
//! `packages/protocol/v1/profiles/*.yaml` catalog, simulating compromised
//! agents by calling `enforce_tool`/`enforce_shell`/`enforce_fs_*`/`enforce_network`
//! with hostile inputs.
//!
//! Later phases (Plan 04 Stage S3+) add:
//!   - BridgeFixture (in-process axum + mock engine)
//!   - AgentInjector (crafted WS envelopes)
//!   - Cross-layer assertions (bridge + engine both deny)
//!
//! See docs/red-team-test-plan.md for the full 67-case matrix. This phase
//! wires the foundational 5 cases (RT-001, RT-003, RT-009, RT-018, RT-033).

pub mod harness;

pub use harness::{profiles_dir, TestCaseMeta};
