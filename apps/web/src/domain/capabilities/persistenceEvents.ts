// Persistence / replay / redaction UX mapping (slice 22).
//
// The bridge emits the following event_type values on the notify lane:
//   * session.persistence_degraded   (apps/local-bridge/src/session/persistence/sink.rs:240)
//   * session.history.listed         (apps/local-bridge/src/translator/mod.rs)
//   * session.history.forgotten      (apps/local-bridge/src/translator/mod.rs)
//
// History list/forgotten are already covered by sessionLifecycle.ts; this
// module focuses on the persistence-degraded UX and the replay/live
// distinction acceptance criterion ("Replay cannot be mistaken for live
// agent output").
//
// `persistenceEventCopyFor()` is the single source of truth for the
// degraded-state copy. `replayBadgeFor()` is a small helper that returns
// the metadata cockpit needs to render replayed transcript rows
// distinctly from live ones (slice 22, step 04).

export type PersistencePhase =
	| 'degraded'
	| 'recovered'
	| 'replay_started'
	| 'replay_finished';

export interface PersistenceCopy {
	readonly phase: PersistencePhase;
	readonly title: string;
	readonly detail: string;
	readonly hint?: string;
	/** True when persistence is currently NOT writing (degraded). */
	readonly degraded: boolean;
	/** True when the cockpit should sticky-notify the operator. */
	readonly sticky: boolean;
}

const FALLBACK: PersistenceCopy = Object.freeze({
	phase: 'degraded',
	title: 'Unknown persistence event',
	detail: 'A persistence lifecycle event arrived that the cockpit does not recognize.',
	degraded: false,
	sticky: false,
});

const CODES: Record<string, PersistenceCopy> = {
	'session.persistence_degraded': {
		phase: 'degraded',
		title: 'Session persistence degraded',
		detail: 'The bridge could not append events to durable storage. Live session continues; history may be incomplete.',
		hint: 'Check disk space and storage permissions, then reload the bridge.',
		degraded: true,
		sticky: true,
	},
	'session.persistence_recovered': {
		phase: 'recovered',
		title: 'Session persistence recovered',
		detail: 'Storage writes are working again. New events will be persisted normally.',
		degraded: false,
		sticky: false,
	},
	'session.replay.started': {
		phase: 'replay_started',
		title: 'Replaying session…',
		detail: 'The cockpit is replaying persisted events. These rows are historical, not live agent output.',
		degraded: false,
		sticky: false,
	},
	'session.replay.finished': {
		phase: 'replay_finished',
		title: 'Replay finished',
		detail: 'All persisted events have been replayed. New rows will be live.',
		degraded: false,
		sticky: false,
	},
};

export function persistenceEventCopyFor(eventType: string): PersistenceCopy {
	return CODES[eventType] ?? FALLBACK;
}

export function isPersistenceEvent(eventType: string): boolean {
	return typeof eventType === 'string' && eventType in CODES;
}

export function isPersistenceDegraded(eventType: string): boolean {
	return persistenceEventCopyFor(eventType).degraded;
}

export interface ReplayBadge {
	readonly badge: 'replay' | 'live';
	/** True when this row should render with the dimmed/historical styling. */
	readonly isHistorical: boolean;
	/** Tooltip explaining why the row looks different. */
	readonly tooltip: string;
}

/**
 * Returns the badge metadata for a transcript row.
 *
 * Slice 22 acceptance: "Replay cannot be mistaken for live agent output."
 * The cockpit calls this once per row and uses the result to set the row
 * badge + dimming.
 */
export function replayBadgeFor(args: { isReplay: boolean }): ReplayBadge {
	if (args.isReplay) {
		return {
			badge: 'replay',
			isHistorical: true,
			tooltip: 'Replayed from session history. Not live agent output.',
		};
	}
	return {
		badge: 'live',
		isHistorical: false,
		tooltip: 'Live agent output.',
	};
}

export const PERSISTENCE_EVENT_CODES: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as PERSISTENCE_EVENT_FALLBACK };
