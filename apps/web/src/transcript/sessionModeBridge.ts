// Slice 50 (continuation #4): transport-level bridge from session
// lifecycle frames to the transcript-store rendering pipeline mode.
//
// `applyLifecycleEvent` (in `./modeWiring.ts`) is the pure adapter
// between the `transcriptFreeze.nextMode` capability and the transcript
// store. This module is the optional seam that wires that adapter to
// real WS frames.
//
// Frame mapping (single source of truth, mirrors the events the bridge
// already publishes — see `apps/web/src/domain/sessions/handlers.ts`
// and `apps/web/src/domain/sessions/history.ts`):
//
//   * `session.ready`           → 'session.opened'         (live)
//   * `session.resumed`         → 'session.opened'         (live, post-replay)
//   * `session.resume.started`  → 'session.replay.started' (replay)
//   * `session.closed`          → 'session.closed'         (frozen)
//
// `session.archived` is not a transport frame today; callers that
// archive locally should invoke `applyLifecycleEvent('session.archived')`
// directly. The bridge only translates frames that already exist on the
// wire, so behaviour stays observable.
//
// `attachTranscriptModeBridge` is intentionally not auto-mounted.
// Production callers (e.g. cockpit bootstrap) opt in by calling it with
// the live transport handle; the function returns an unsubscribe so the
// caller can tear it down on transport.close().

import { applyLifecycleEvent, type TranscriptLifecycleEvent } from './modeWiring';

// Local structural shape for the transport seam. We deliberately DO NOT
// import `TransportHandle` from `../transport` so the transcript
// (rendering) layer keeps its zero-dep posture against transport per
// `scripts/check-architecture-boundaries.mjs`. Any object that exposes a
// compatible `on` method satisfies this contract — the production
// `TransportHandle` does, and so do the queue/relay/test fakes.
export interface TranscriptModeTransport {
	on(type: string, handler: (frame: { readonly type: string; readonly payload: unknown }) => void): () => void;
}

export interface TranscriptModeBridgeOptions {
	/**
	 * Optional logger for diagnostics. Called with the inbound frame type
	 * and the lifecycle event the bridge dispatched. Useful for tests and
	 * for tracing in development; production callers can leave it
	 * undefined.
	 */
	readonly onDispatch?: ((frameType: string, event: TranscriptLifecycleEvent) => void) | undefined;
}

/**
 * Subscribe to the transport's session-lifecycle frames and forward
 * them to the transcript store via `applyLifecycleEvent`. Returns an
 * unsubscribe function that detaches every handler.
 *
 * Idempotent per call site: each invocation registers its own
 * subscriptions and the returned function only tears down its own.
 */
export function attachTranscriptModeBridge(
	transport: TranscriptModeTransport,
	options: TranscriptModeBridgeOptions = {},
): () => void {
	const dispatch = (frameType: string, event: TranscriptLifecycleEvent): void => {
		applyLifecycleEvent(event);
		options.onDispatch?.(frameType, event);
	};

	const offs: Array<() => void> = [
		transport.on('session.ready', () => dispatch('session.ready', 'session.opened')),
		transport.on('session.resumed', () => dispatch('session.resumed', 'session.opened')),
		transport.on('session.resume.started', () => dispatch('session.resume.started', 'session.replay.started')),
		transport.on('session.closed', () => dispatch('session.closed', 'session.closed')),
	];

	return () => {
		for (const off of offs) off();
	};
}

/**
 * Static map of WS frame types to the lifecycle events this bridge
 * dispatches. Exported so tests and downstream tooling (e.g. an
 * eventCatalog parity check) can assert the mapping without
 * re-deriving it.
 */
export const TRANSCRIPT_MODE_FRAME_MAP: Readonly<Record<string, TranscriptLifecycleEvent>> = Object.freeze({
	'session.ready': 'session.opened',
	'session.resumed': 'session.opened',
	'session.resume.started': 'session.replay.started',
	'session.closed': 'session.closed',
});
