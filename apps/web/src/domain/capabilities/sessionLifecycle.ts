// Session lifecycle event UX mapping (slice 09).
//
// Mirrors the canonical session.* event_type strings emitted by
// apps/local-bridge/src/translator/mod.rs. The cockpit Sessions tab,
// SessionPicker, and notify-lane should use this catalog instead of
// inline string comparisons so close vs forget vs resume.* surface
// distinct copy and visible state transitions.

export type SessionLifecyclePhase =
	| 'resume_initializing'
	| 'resume_started'
	| 'resume_warning'
	| 'resume_failed'
	| 'resumed'
	| 'closed'
	| 'history_listed'
	| 'history_forgotten'
	| 'renamed';

export interface SessionLifecycleCopy {
	readonly phase: SessionLifecyclePhase;
	readonly title: string;
	readonly detail: string;
	/** True when the session can still receive commands. */
	readonly sessionUsable: boolean;
	/** True when the cockpit should surface a notification (vs. silent state update). */
	readonly notify: boolean;
}

const FALLBACK: SessionLifecycleCopy = {
	phase: 'closed',
	title: 'Session lifecycle event',
	detail: 'An unrecognized session lifecycle event was received.',
	sessionUsable: false,
	notify: false,
};

const CODES: Record<string, SessionLifecycleCopy> = {
	'session.resume.initializing': {
		phase: 'resume_initializing',
		title: 'Session is initializing',
		detail: 'The bridge is preparing to replay this session\u2019s history. Streaming events will follow.',
		sessionUsable: false,
		notify: false,
	},
	'session.resume.started': {
		phase: 'resume_started',
		title: 'Session resume started',
		detail: 'Replay has begun. The cockpit will show progress until session.resumed.',
		sessionUsable: false,
		notify: false,
	},
	'session.resume.warning': {
		phase: 'resume_warning',
		title: 'Session resumed with warnings',
		detail: 'Replay completed but some non-fatal drift was detected (e.g. MCP advertise differences).',
		sessionUsable: true,
		notify: true,
	},
	'session.resume.failed': {
		phase: 'resume_failed',
		title: 'Session resume failed',
		detail: 'The session could not be resumed. Use session.create to start a fresh session, or address the failure reason and retry.',
		sessionUsable: false,
		notify: true,
	},
	'session.resumed': {
		phase: 'resumed',
		title: 'Session resumed',
		detail: 'Replay completed successfully. The session is now live.',
		sessionUsable: true,
		notify: false,
	},
	'session.closed': {
		phase: 'closed',
		title: 'Session closed',
		detail: 'The session is no longer active. Persisted history is still available via session.history.list.',
		sessionUsable: false,
		notify: false,
	},
	'session.history.listed': {
		phase: 'history_listed',
		title: 'Session history listed',
		detail: 'The bridge returned the persisted session list.',
		sessionUsable: false,
		notify: false,
	},
	'session.history.forgotten': {
		phase: 'history_forgotten',
		title: 'Session forgotten',
		detail: 'The session\u2019s persisted history was deleted. This is permanent and cannot be undone.',
		sessionUsable: false,
		notify: true,
	},
	'session.renamed': {
		phase: 'renamed',
		title: 'Session renamed',
		detail: 'The session label was updated. The new label persists across history listings.',
		sessionUsable: true,
		notify: false,
	},
};

export function sessionLifecycleCopyFor(eventType: string): SessionLifecycleCopy {
	return CODES[eventType] ?? FALLBACK;
}

export function isSessionLifecycleEvent(eventType: string): boolean {
	return typeof eventType === 'string' && eventType.startsWith('session.');
}

export const SESSION_LIFECYCLE_EVENTS: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as SESSION_LIFECYCLE_FALLBACK };
