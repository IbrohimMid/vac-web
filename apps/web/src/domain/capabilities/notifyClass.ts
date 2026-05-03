// Notify-lane error classifier (slice 29: audit_observability).
//
// The local-bridge surfaces three structurally distinct kinds of negative
// outcomes through the same `notify.event` / RPC error channel:
//
//   1. Profile denials   — `profile.*` codes from packages/profile-core
//   2. Feature stubs     — `feature.not_wired` for commands the runtime
//                          does not yet implement
//   3. Wire / transport  — protocol envelope errors, auth failures, bad
//                          payloads, RPC-side errors not tied to a
//                          domain (`protocol.bad_envelope`, `auth.*`,
//                          `rpc.*`, etc.)
//   4. Domain failures   — domain-specific lifecycle codes already covered
//                          by approvalErrors / handoffErrors /
//                          sessionLifecycle.
//
// The cockpit must render these classes distinctly: profile denials get a
// gated banner with override hint, feature stubs get a neutral “coming
// soon” chip, and wire errors get a transient red toast. Without this
// classifier each surface re-implements `code.startsWith('profile.')`
// inline, which drifts every time a new code is added.
//
// This module is the single classifier; UI surfaces should call
// `classifyNotifyError(code)` and key their rendering off `kind`.

import { isProfileDenial } from './profileDenial';
import { isApprovalError } from './approvalErrors';
import { isHandoffEvent } from './handoffErrors';
import { isSessionLifecycleEvent } from './sessionLifecycle';
import { isConnectionLevelAuthError, isSessionLevelAuthError } from './wsAuthError';

export type NotifyErrorKind =
	| 'profile_denial'
	| 'feature_not_wired'
	| 'wire_error'
	| 'approval_error'
	| 'handoff_event'
	| 'session_lifecycle'
	| 'auth_error'
	| 'audit_write_failed'
	| 'unknown';

export interface NotifyClassification {
	readonly code: string;
	readonly kind: NotifyErrorKind;
	/** True if the cockpit should render a sticky banner / requires action. */
	readonly sticky: boolean;
	/** True if the underlying capability is simply unimplemented. */
	readonly isStub: boolean;
	/** True if the failure is a transport/protocol concern, not a domain one. */
	readonly isTransport: boolean;
}

const FALLBACK: NotifyClassification = Object.freeze({
	code: '',
	kind: 'unknown',
	sticky: false,
	isStub: false,
	isTransport: false,
});

/**
 * Classify an event-type / error-code into one of the notify-lane buckets.
 *
 * Order matters: more specific predicates must run before broader ones, so
 * `feature.not_wired` is detected before being miscategorized as a
 * generic wire error.
 */
export function classifyNotifyError(code: string): NotifyClassification {
	if (typeof code !== 'string' || code.length === 0) {
		return FALLBACK;
	}

	if (code === 'feature.not_wired') {
		return {
			code,
			kind: 'feature_not_wired',
			sticky: false,
			isStub: true,
			isTransport: false,
		};
	}

	if (code === 'audit.write_failed') {
		return {
			code,
			kind: 'audit_write_failed',
			sticky: true,
			isStub: false,
			isTransport: false,
		};
	}

	if (isProfileDenial(code)) {
		return {
			code,
			kind: 'profile_denial',
			sticky: true,
			isStub: false,
			isTransport: false,
		};
	}

	if (isApprovalError(code)) {
		return {
			code,
			kind: 'approval_error',
			sticky: false,
			isStub: false,
			isTransport: false,
		};
	}

	if (isHandoffEvent(code)) {
		return {
			code,
			kind: 'handoff_event',
			sticky: false,
			isStub: false,
			isTransport: false,
		};
	}

	// Session lifecycle events are emitted as `session.<phase>` event_type
	// strings; isSessionLifecycleEvent already handles the prefix.
	if (isSessionLifecycleEvent(code)) {
		return {
			code,
			kind: 'session_lifecycle',
			sticky: false,
			isStub: false,
			isTransport: false,
		};
	}

	if (isConnectionLevelAuthError(code) || isSessionLevelAuthError(code)) {
		return {
			code,
			kind: 'auth_error',
			sticky: true,
			isStub: false,
			isTransport: true,
		};
	}

	if (
		code.startsWith('protocol.') ||
		code.startsWith('rpc.') ||
		code.startsWith('transport.') ||
		code.startsWith('ws.')
	) {
		return {
			code,
			kind: 'wire_error',
			sticky: false,
			isStub: false,
			isTransport: true,
		};
	}

	return { ...FALLBACK, code };
}

/** Convenience predicate. */
export function isFeatureStub(code: string): boolean {
	return classifyNotifyError(code).kind === 'feature_not_wired';
}

/** Convenience predicate. */
export function isWireError(code: string): boolean {
	return classifyNotifyError(code).isTransport;
}

export { FALLBACK as NOTIFY_ERROR_FALLBACK };
