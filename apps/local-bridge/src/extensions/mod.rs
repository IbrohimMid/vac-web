//! Extensions surface (F5b — 2026-05-07): trust-config aware list +
//! update_trust handlers. Layer 1 of the extension-trust model.
//!
//! Wire path:
//! - WS client sends `extensions.list` -> translator dispatches into
//!   `handlers::handle_list` -> returns ack + `extensions.list_response`
//!   event with one entry per declared extension and its enforced tier.
//! - WS client sends `extensions.update_trust` -> mutates
//!   `config/extension-trust.yaml` on disk -> emits `extensions.updated`.
//!
//! The on-disk path is overridable via `VAC_EXTENSION_TRUST_PATH` env;
//! default is `<cwd>/config/extension-trust.yaml`.

pub mod handlers;
pub mod store;
