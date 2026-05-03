// Slice 50 (continuation #2): glue between session lifecycle events
// and the transcript store's rendering pipeline mode.
//
// `nextMode` lives in the `transcriptFreeze` capability and computes
// the new mode purely from `(currentMode, event)`. This module wraps
// that with a small adapter that pushes the result into the
// transcript store via `setMode`. The adapter is intentionally a thin
// glue layer so it stays trivial to verify and easy to call from
// session lifecycle handlers when they migrate.
//
// Today no production caller is wired; the helper is the safe
// adoption target for future per-handler migration.

import { nextMode } from '../domain/capabilities/transcriptFreeze';
import { useTranscript, type TranscriptRenderMode } from '../stores/transcript';

export type TranscriptLifecycleEvent =
	| 'session.opened'
	| 'session.replay.started'
	| 'session.replay.finished'
	| 'session.closed'
	| 'session.archived';

/**
 * Apply a session lifecycle event to the transcript store. Reads the
 * current mode, computes the new mode through the catalog, and pushes
 * it back via `setMode` (a no-op when the mode is unchanged).
 *
 * @returns the new mode that was applied.
 */
export function applyLifecycleEvent(
	event: TranscriptLifecycleEvent,
): TranscriptRenderMode {
	const current = useTranscript.getState().mode;
	const next = nextMode(current, { type: event });
	if (next !== current) {
		useTranscript.getState().setMode(next);
	}
	return next;
}
