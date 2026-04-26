//! VIL-style workflow process — per-session background task.
//!
//! Stays alive for the entire session lifetime. Starts a new
//! WorkflowExecutor run on each PromptSubmitted signal. This supports
//! multi-turn sessions where the user sends multiple prompts.
//!
//! workflow.started is NOT emitted at session spawn — it fires the moment
//! the first message.submit arrives (via workflow.input.message_submit).

use super::{
    adapters::{classify_bridge_event, WorkflowAdvance},
    executor::WorkflowExecutor,
    spec::WorkflowSpec,
};
use crate::ws::envelope::ServerEvent;
use bridge_core::EventRing;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, warn};

/// Spawn the workflow process for a session. Returns immediately.
/// The task lives until the broadcast channel closes (session ends).
pub fn start_workflow_process(
    session_id: String,
    ring: Arc<RwLock<EventRing<ServerEvent>>>,
    bcast_tx: broadcast::Sender<ServerEvent>,
    bcast_rx: broadcast::Receiver<ServerEvent>,
    spec: WorkflowSpec,
) {
    tokio::spawn(run(session_id, ring, bcast_tx, bcast_rx, spec));
}

async fn run(
    session_id: String,
    ring: Arc<RwLock<EventRing<ServerEvent>>>,
    bcast_tx: broadcast::Sender<ServerEvent>,
    mut bcast_rx: broadcast::Receiver<ServerEvent>,
    spec: WorkflowSpec,
) {
    // No workflow run until PromptSubmitted.
    let mut current_run: Option<WorkflowExecutor> = None;

    loop {
        match bcast_rx.recv().await {
            Ok(ev) => {
                let Some(signal) = classify_bridge_event(&ev.event_type, &ev.payload) else {
                    continue;
                };

                // On PromptSubmitted: start a new run if no active one (or previous completed).
                if matches!(signal, WorkflowAdvance::PromptSubmitted) {
                    let need_new_run = current_run
                        .as_ref()
                        .map(|r| r.is_terminal())
                        .unwrap_or(true);

                    if need_new_run {
                        let mut new_run = WorkflowExecutor::new(session_id.clone(), spec.clone());
                        for ev in new_run.start_run_events() {
                            emit_to(&ring, &bcast_tx, ev).await;
                        }
                        // Advance the new run with PromptSubmitted.
                        for ev in new_run.advance(signal) {
                            emit_to(&ring, &bcast_tx, ev).await;
                        }
                        current_run = Some(new_run);
                        debug!(session = %session_id, "workflow process: new run started");
                        continue;
                    }
                }

                // Forward signal to current run.
                if let Some(run) = current_run.as_mut() {
                    let new_events = run.advance(signal);
                    for wf_ev in new_events {
                        emit_to(&ring, &bcast_tx, wf_ev).await;
                    }
                    // Do NOT exit when terminal — stay alive for next prompt.
                    debug!(
                        session = %session_id,
                        is_terminal = run.is_terminal(),
                        "workflow process: advanced"
                    );
                }
            }
            Err(broadcast::error::RecvError::Closed) => {
                debug!(session = %session_id, "workflow process: broadcast closed, exiting");
                break;
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!(
                    session = %session_id,
                    lagged = n,
                    "workflow process: broadcast lagged"
                );
            }
        }
    }
}

/// Push event to ring (for replay) and broadcast (for live clients).
async fn emit_to(
    ring: &Arc<RwLock<EventRing<ServerEvent>>>,
    bcast: &broadcast::Sender<ServerEvent>,
    event: ServerEvent,
) {
    let seq = {
        let mut r = ring.write().await;
        r.push(event.clone())
    };
    let mut with_seq = event;
    with_seq.seq = seq;
    let _ = bcast.send(with_seq);
}
