// Approval error UX mapping (slice 06).
//
// The bridge surfaces these codes via translator/mod.rs (search for
// `approval.*` strings). This module gives every code a precise,
// operator-facing copy block so ApprovalsTab, MessageRow approval cards,
// and notify-lane toasts render consistent text. Bulk approval / inspect
// are tracked here too so UI surfaces can derive their disabled state.

export interface ApprovalErrorCopy {
	readonly title: string;
	readonly detail: string;
	readonly hint?: string;
	/** When true, the operator can typically retry after fixing inputs. */
	readonly retryable: boolean;
}

const FALLBACK: ApprovalErrorCopy = {
	title: 'Approval failed',
	detail: 'The approval action could not be completed.',
	hint: 'Reload the approval and try again, or check the audit trail for details.',
	retryable: true,
};

const CODES: Record<string, ApprovalErrorCopy> = {
	'approval.not_found': {
		title: 'Approval not found',
		detail: 'The approval id is unknown to this session, or it was already resolved.',
		hint: 'Refresh the approvals tab; the approval may have been resolved by another client.',
		retryable: false,
	},
	'approval.not_acp': {
		title: 'Approval is not ACP-routable',
		detail: 'This session does not run an ACP runtime, so ACP-style approvals do not apply.',
		hint: 'Switch to an ACP-backed session or use the native approval flow.',
		retryable: false,
	},
	'approval.option_not_found': {
		title: 'Approval option missing',
		detail: 'The selected option id was not in the approval\u2019s eligible options list.',
		hint: 'Reload the approval to see current options.',
		retryable: true,
	},
	'approval.option_kind_mismatch': {
		title: 'Approval option kind mismatch',
		detail: 'The selected option does not match the kind expected for this decision (allow vs deny).',
		hint: 'Pick an option that matches the action being approved or rejected.',
		retryable: true,
	},
	'approval.option_forbidden': {
		title: 'Approval option not permitted',
		detail: 'The active capability profile forbids this approval option.',
		hint: 'Switch to a profile that permits this option, or escalate via gate override.',
		retryable: false,
	},
	'approval.expired': {
		title: 'Approval expired',
		detail: 'The approval timed out before a decision was recorded. Bridge cancelled the pending tool call automatically.',
		hint: 'Re-issue the action to get a fresh approval, or extend the approval timeout.',
		retryable: true,
	},
};

export function approvalErrorCopyFor(code: string): ApprovalErrorCopy {
	return CODES[code] ?? FALLBACK;
}

export function isApprovalError(code: string): boolean {
	return typeof code === 'string' && code.startsWith('approval.');
}

export const APPROVAL_ERROR_CODES: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as APPROVAL_ERROR_FALLBACK };
