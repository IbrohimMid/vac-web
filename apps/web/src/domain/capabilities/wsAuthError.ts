// WebSocket / auth error classification (slice 21).
//
// The bridge emits a small, stable set of error codes for auth and
// envelope failures (apps/local-bridge/src/ws/handler.rs +
// apps/local-bridge/src/session/handle.rs). The cockpit must distinguish
// connection-level failures (close the socket, prompt for token) from
// session-level failures (keep the socket, mark the session needs reauth)
// from envelope/protocol failures (developer error, surface a toast).
//
// This module is the single source of truth for that classification. UI
// surfaces (Topbar, ReauthAction, Sidebar, ConnectionBanner) should call
// `classifyWsAuthError(code)` instead of inlining string compares.

export type WsAuthErrorScope =
	| 'connection' // WS itself cannot continue; close + retry with new token.
	| 'session' // Provider auth failed inside an open WS; reauth without reconnect.
	| 'envelope' // Bad JSON / unknown command shape; developer/UX error.
	| 'unknown'; // Code not in the catalog.

export interface WsAuthError {
	readonly code: string;
	readonly scope: WsAuthErrorScope;
	readonly title: string;
	readonly detail: string;
	/** True when the user cannot fix this in-app (e.g. env-var recreate). */
	readonly requiresProcessRestart: boolean;
	/** True when the UI should offer a reauth flow (provider OAuth, terminal). */
	readonly offersReauth: boolean;
}

const FALLBACK: WsAuthError = {
	code: 'unknown',
	scope: 'unknown',
	title: 'Connection issue',
	detail: 'An unrecognized auth or protocol error occurred.',
	requiresProcessRestart: false,
	offersReauth: false,
};

const CATALOG: Record<string, WsAuthError> = {
	'auth.required': {
		code: 'auth.required',
		scope: 'connection',
		title: 'WebSocket auth required',
		detail: 'The bridge requires a pairing token before it will accept commands.',
		requiresProcessRestart: false,
		offersReauth: true,
	},
	'auth.invalid_token': {
		code: 'auth.invalid_token',
		scope: 'connection',
		title: 'WebSocket token rejected',
		detail: 'The pairing token was invalid, expired, or signed by a different bridge.',
		requiresProcessRestart: false,
		offersReauth: true,
	},
	'protocol.bad_envelope': {
		code: 'protocol.bad_envelope',
		scope: 'envelope',
		title: 'Protocol envelope rejected',
		detail: 'A frame did not parse as a valid command/replay envelope.',
		requiresProcessRestart: false,
		offersReauth: false,
	},
	// ACP-provider auth (forwarded session.authenticate response).
	'auth.not_supported': {
		code: 'auth.not_supported',
		scope: 'session',
		title: 'Auth not supported',
		detail: 'The active runtime does not support an auth method on this session.',
		requiresProcessRestart: false,
		offersReauth: false,
	},
	'auth.env_var_recreate_required': {
		code: 'auth.env_var_recreate_required',
		scope: 'session',
		title: 'Restart required to update credentials',
		detail: 'This provider reads credentials from environment variables. The host process must be restarted with new env vars.',
		requiresProcessRestart: true,
		offersReauth: false,
	},
};

/** Classify an error code into its operational scope and curated copy. */
export function classifyWsAuthError(code: string): WsAuthError {
	const hit = CATALOG[code];
	if (hit) return hit;
	return { ...FALLBACK, code };
}

/** True iff the code closes the WS connection (not just the session). */
export function isConnectionLevelAuthError(code: string): boolean {
	return classifyWsAuthError(code).scope === 'connection';
}

/** True iff the UI should offer a reauth flow without reconnecting. */
export function isSessionLevelAuthError(code: string): boolean {
	return classifyWsAuthError(code).scope === 'session';
}

/** Snapshot of catalogued codes (for tests + introspection). */
export const WS_AUTH_ERROR_CODES: ReadonlyArray<string> = Object.freeze(Object.keys(CATALOG));

export { FALLBACK as WS_AUTH_ERROR_FALLBACK };
