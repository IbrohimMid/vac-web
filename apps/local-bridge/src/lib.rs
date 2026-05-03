//! vac-bridge library surface (tested + reusable parts).
//!
//! Transport, session management, translator, enforcement, auth, audit.
//! `main.rs` composes these into the runnable daemon.

pub mod agent_runtime;
pub mod audit;
pub mod auth;
pub mod capabilities;
pub mod config;
pub mod generated;
pub mod handoff;
pub mod notify;
pub mod observability;
pub mod profile_layer;
pub mod server;
pub mod session;
pub mod storage;
pub mod translator;
pub mod tunnel;
pub mod workflows;
pub mod ws;

pub use server::{build_app, AppState, AppStateHandle};
