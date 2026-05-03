// Slice 50: transcript freeze capability.
//
// The transcript pipeline operates in three modes:
//   * `live`     — active session, content streams in.
//   * `frozen`   — session closed: content is immutable, rendered HTML
//                  is cached, and no new edits are accepted. New events
//                  for a closed session must be rejected (or routed to
//                  a replay buffer for a different session) so the
//                  cold message UI guarantees frame-stability per the
//                  ColdMessage component contract.
//   * `replay`   — reconstructed from the event log; treated like
//                  `frozen` for write purposes but tagged so the UI
//                  can show a replay badge.
//
// This module is the deterministic decision engine that the transcript
// store consults before applying an upsert/append. It is intentionally
// pure: no React, no zustand, no transport.
//
// Acceptance (slice 50):
//   * Markdown/highlight/transcript modules have documented ownership.
//   * Rendering capabilities are declarative and testable without
//     agent runtime.
//   * Workers have explicit input/output contracts.

export type TranscriptMode = 'live' | 'frozen' | 'replay';

export type TranscriptFreezeReason =
	| 'session_closed'
	| 'session_replay'
	| 'session_archived'
	| 'mode_override';

export interface TranscriptSessionState {
	readonly sessionId: string;
	readonly mode: TranscriptMode;
	/** ISO-8601 timestamp at which the session transitioned to `frozen`. */
	readonly closedAt?: string | undefined;
	/** True if the session is being replayed from the event log. */
	readonly replaying?: boolean | undefined;
	/** True if the operator explicitly archived the session. */
	readonly archived?: boolean | undefined;
}

export interface TranscriptEdit {
	readonly sessionId: string;
	/** ISO-8601 timestamp on the inbound event. */
	readonly eventTimestamp?: string | undefined;
	/** Origin of the edit; replay events are allowed in replay mode only. */
	readonly origin: 'live_stream' | 'replay' | 'user_local' | 'system';
}

export interface FreezeDecision {
	readonly accepted: boolean;
	readonly mode: TranscriptMode;
	readonly reason?: TranscriptFreezeReason | undefined;
	readonly detail?: string | undefined;
}

/**
 * Decide whether a transcript edit should be applied given the current
 * session state. Pure function — the caller (transcript store) is
 * responsible for actually mutating state when `accepted` is true.
 */
export function evaluateFreeze(
	state: TranscriptSessionState,
	edit: TranscriptEdit,
): FreezeDecision {
	if (state.sessionId !== edit.sessionId) {
		return {
			accepted: false,
			mode: state.mode,
			reason: 'mode_override',
			detail: 'edit.sessionId does not match transcript session state',
		};
	}

	if (state.archived === true) {
		return {
			accepted: false,
			mode: 'frozen',
			reason: 'session_archived',
			detail: 'archived sessions are read-only',
		};
	}

	switch (state.mode) {
		case 'live':
			// Replay events should never reach a live session; accept all
			// other origins.
			if (edit.origin === 'replay') {
				return {
					accepted: false,
					mode: 'live',
					reason: 'mode_override',
					detail: 'replay events not accepted in live mode',
				};
			}
			return { accepted: true, mode: 'live' };

		case 'replay':
			// Only replay-origin events may be applied while the session
			// reconstruction is in flight.
			if (edit.origin !== 'replay') {
				return {
					accepted: false,
					mode: 'replay',
					reason: 'session_replay',
					detail: `${edit.origin} events not accepted while replaying`,
				};
			}
			return { accepted: true, mode: 'replay' };

		case 'frozen':
			return {
				accepted: false,
				mode: 'frozen',
				reason: 'session_closed',
				detail: state.closedAt
					? `transcript frozen at ${state.closedAt}`
					: 'transcript frozen',
			};
	}
}

/**
 * Compute the next transcript mode given a session lifecycle event.
 * The transcript store calls this on every session-lifecycle frame so the
 * mode transition is deterministic and unit-testable.
 */
export function nextMode(
	current: TranscriptMode,
	event:
		| { type: 'session.opened' }
		| { type: 'session.replay.started' }
		| { type: 'session.replay.finished' }
		| { type: 'session.closed' }
		| { type: 'session.archived' },
): TranscriptMode {
	switch (event.type) {
		case 'session.opened':
			// A live session always overrides any prior frozen/replay mode.
			return 'live';
		case 'session.replay.started':
			return 'replay';
		case 'session.replay.finished':
			// Once replay finishes, the transcript becomes frozen. The
			// caller may explicitly transition to live afterwards if the
			// session is still open and accepts new events.
			return 'frozen';
		case 'session.closed':
		case 'session.archived':
			return 'frozen';
	}
	// Fallback (unreachable with current event union, but keeps the
	// function total under exactOptionalPropertyTypes).
	return current;
}

export interface RenderingPipelineMode {
	readonly mode: TranscriptMode;
	readonly mutable: boolean;
	readonly cacheRenderedHtml: boolean;
	readonly description: string;
}

// Declarative rendering-pipeline catalog (slice 50). Surfaces consume
// this catalog instead of repeating mode → behavior logic so the
// transcript freeze contract is auditable and testable.
const PIPELINE_MODES: ReadonlyArray<RenderingPipelineMode> = Object.freeze([
	{
		mode: 'live',
		mutable: true,
		cacheRenderedHtml: false,
		description: 'Active streaming session; renders incrementally.',
	},
	{
		mode: 'replay',
		mutable: true,
		cacheRenderedHtml: false,
		description: 'Reconstructing transcript from the event log.',
	},
	{
		mode: 'frozen',
		mutable: false,
		cacheRenderedHtml: true,
		description: 'Closed session; rendered HTML cached, content immutable.',
	},
]);

export function listRenderingPipelineModes(): ReadonlyArray<RenderingPipelineMode> {
	return PIPELINE_MODES;
}

export function pipelineModeFor(mode: TranscriptMode): RenderingPipelineMode {
	const found = PIPELINE_MODES.find((m) => m.mode === mode);
	if (!found) {
		throw new Error(`unknown transcript mode: ${mode}`);
	}
	return found;
}
