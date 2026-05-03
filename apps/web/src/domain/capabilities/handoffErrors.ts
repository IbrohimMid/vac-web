// Handoff error UX mapping (slice 07).
//
// Mirrors the bridge events emitted from apps/local-bridge/src/translator/mod.rs
// and apps/local-bridge/src/handoff/mod.rs. Every error variant gets a
// curated copy block plus an operator action class so HandoffBuilder /
// PacketDetail / notify-lane can render consistent UX without inline
// string-comparison logic.

export type HandoffActionClass =
	| 'reapprove' // re-issue approval and try again
	| 'recreate' // packet must be rebuilt from scratch
	| 'fix_pin' // pin/version drift; update inputs
	| 'wait' // a server-side condition is transient
	| 'inspect' // read audit/log; no clear next step
	| 'success'; // not an error

export interface HandoffErrorCopy {
	readonly title: string;
	readonly detail: string;
	readonly hint?: string;
	readonly actionClass: HandoffActionClass;
	readonly stickyNotification: boolean;
}

const FALLBACK: HandoffErrorCopy = {
	title: 'Handoff failed',
	detail: 'The handoff event could not be processed.',
	hint: 'Open the audit trail to see what happened.',
	actionClass: 'inspect',
	stickyNotification: false,
};

const CODES: Record<string, HandoffErrorCopy> = {
	'handoff.created': {
		title: 'Handoff created',
		detail: 'The handoff packet is now in draft and ready for approvals.',
		actionClass: 'success',
		stickyNotification: false,
	},
	'handoff.approved': {
		title: 'Handoff approved',
		detail: 'A signer recorded an approval on the packet.',
		actionClass: 'success',
		stickyNotification: false,
	},
	'handoff.rejected': {
		title: 'Handoff rejected',
		detail: 'A signer rejected the packet. The packet is no longer dispatchable.',
		hint: 'Recreate the packet with revised inputs if you still need to dispatch.',
		actionClass: 'recreate',
		stickyNotification: true,
	},
	'handoff.invalid_state': {
		title: 'Handoff is in the wrong state',
		detail: 'The action is not valid for the packet\u2019s current state (e.g. approving a draft, dispatching an unapproved packet).',
		hint: 'Refresh the packet view; another client may have changed its state.',
		actionClass: 'inspect',
		stickyNotification: false,
	},
	'handoff.approve_failed': {
		title: 'Handoff approve failed',
		detail: 'The bridge could not record the approval signature.',
		hint: 'Re-authenticate as the signer and try again.',
		actionClass: 'reapprove',
		stickyNotification: true,
	},
	'handoff.reject_failed': {
		title: 'Handoff reject failed',
		detail: 'The bridge could not record the rejection.',
		hint: 'Try again; if it persists, inspect the audit trail.',
		actionClass: 'inspect',
		stickyNotification: true,
	},
	'handoff.dispatch_rejected': {
		title: 'Handoff dispatch rejected',
		detail: 'The dispatch executor refused the packet (policy or pin drift).',
		hint: 'Check capability profile and pin versions, then re-dispatch.',
		actionClass: 'fix_pin',
		stickyNotification: true,
	},
	'handoff.dispatch_state_error': {
		title: 'Dispatch state error',
		detail: 'The bridge could not transition the packet into a dispatching state.',
		hint: 'Refresh and retry; the packet may have been dispatched concurrently.',
		actionClass: 'wait',
		stickyNotification: false,
	},
	'handoff.execution_bind_failed': {
		title: 'Handoff execution failed to bind',
		detail: 'The dispatcher could not bind the execution context (e.g. missing CLI, bad project root).',
		hint: 'Verify the local CLI/agent is installed and the project root resolves.',
		actionClass: 'fix_pin',
		stickyNotification: true,
	},
	'handoff.execution_failed': {
		title: 'Handoff execution failed',
		detail: 'The dispatched executor exited with a failure.',
		hint: 'Open the execution log in the audit trail; re-dispatch after fixing the underlying error.',
		actionClass: 'inspect',
		stickyNotification: true,
	},
	'handoff.duplicate_signer': {
		title: 'Duplicate signer',
		detail: 'This signer has already recorded a decision on the packet.',
		hint: 'Use a different signer identity, or skip if the existing signature is sufficient.',
		actionClass: 'inspect',
		stickyNotification: false,
	},
};

export function handoffErrorCopyFor(code: string): HandoffErrorCopy {
	return CODES[code] ?? FALLBACK;
}

export function isHandoffEvent(code: string): boolean {
	return typeof code === 'string' && code.startsWith('handoff.');
}

export function shouldStickyNotify(code: string): boolean {
	return handoffErrorCopyFor(code).stickyNotification;
}

export const HANDOFF_EVENT_CODES: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as HANDOFF_ERROR_FALLBACK };
