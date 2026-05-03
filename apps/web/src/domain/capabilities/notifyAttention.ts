// Notify lane attention level (slice 23).
//
// Maps a notify event/error code (already classified by `notifyClass`)
// onto the cockpit's three attention surfaces:
//
//   inline   — rendered next to the affordance that triggered it; no
//              top-level toast.
//   sticky   — stays in the notify lane until the operator acks.
//   overlay  — modal/blocking overlay (e.g. auth required).
//
// Acceptance (slice 23):
//   * No domain uses alert/toast ad hoc.
//   * Operator attention level follows ux-grammar.
//   * Not-wired copy does not spam notification lane.

import { classifyNotifyError, type NotifyErrorKind } from './notifyClass';

export type AttentionLevel = 'silent' | 'inline' | 'sticky' | 'overlay';

export interface AttentionDecision {
	readonly code: string;
	readonly kind: NotifyErrorKind;
	readonly level: AttentionLevel;
}

/**
 * Classify a notify code into an attention level following ux-grammar.
 *
 *   feature_not_wired  → inline (low-noise, never sticky)
 *   profile_denial     → sticky (operator must understand the block)
 *   audit_write_failed → sticky
 *   auth_error         → overlay (cannot proceed without auth)
 *   wire_error         → inline (transient transport)
 *   approval_error     → inline
 *   handoff_event      → inline
 *   session_lifecycle  → silent (status, not error)
 *   unknown            → inline
 */
export function attentionLevelFor(code: string): AttentionDecision {
	const c = classifyNotifyError(code);
	let level: AttentionLevel;
	switch (c.kind) {
		case 'feature_not_wired':
			level = 'inline';
			break;
		case 'profile_denial':
			level = 'sticky';
			break;
		case 'audit_write_failed':
			level = 'sticky';
			break;
		case 'auth_error':
			level = 'overlay';
			break;
		case 'wire_error':
			level = 'inline';
			break;
		case 'approval_error':
			level = 'inline';
			break;
		case 'handoff_event':
			level = 'inline';
			break;
		case 'session_lifecycle':
			level = 'silent';
			break;
		default:
			level = 'inline';
			break;
	}
	return { code: c.code, kind: c.kind, level };
}
