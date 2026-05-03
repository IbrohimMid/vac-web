// Overlay / workbench / plan ownership classifier (slice 17).
//
// Acceptance:
//   * Frontend-owned commands do not cross bridge.
//   * Plan mutation controls are hidden or disabled unless bridge owns
//     plan state.
//   * No generic workbench backend escape hatch.

export type CommandOwnership = 'frontend_only' | 'bridge_owned' | 'unmapped';

export interface CommandOwnershipDecision {
	readonly command: string;
	readonly ownership: CommandOwnership;
	/** True iff the cockpit must NOT send this command over the WebSocket. */
	readonly localOnly: boolean;
	/** True iff this command is unmapped and must be disabled. */
	readonly disabled: boolean;
}

const FRONTEND_ONLY_COMMANDS = new Set<string>([
	'overlay.open',
	'overlay.dismiss',
	'overlay.dismiss_all',
	'workbench.select_tab',
]);

const BRIDGE_OWNED_COMMANDS = new Set<string>([
	'plan.open', // observed plan; opening a plan view
]);

/** workbench.invoke is intentionally NOT mapped — acceptance #3. */
const UNMAPPED_COMMANDS = new Set<string>([
	'workbench.invoke',
]);

export function classifyCommandOwnership(command: string): CommandOwnershipDecision {
	if (FRONTEND_ONLY_COMMANDS.has(command)) {
		return { command, ownership: 'frontend_only', localOnly: true, disabled: false };
	}
	if (BRIDGE_OWNED_COMMANDS.has(command)) {
		return { command, ownership: 'bridge_owned', localOnly: false, disabled: false };
	}
	if (UNMAPPED_COMMANDS.has(command)) {
		return { command, ownership: 'unmapped', localOnly: false, disabled: true };
	}
	return { command, ownership: 'unmapped', localOnly: false, disabled: true };
}

export interface PlanAffordance {
	readonly canEdit: boolean;
	readonly canApprove: boolean;
	readonly canReject: boolean;
	readonly readOnlyReason?: string | undefined;
}

export function planAffordanceFor(opts: { bridgeOwnsPlanState: boolean }): PlanAffordance {
	if (!opts.bridgeOwnsPlanState) {
		return {
			canEdit: false,
			canApprove: false,
			canReject: false,
			readOnlyReason: 'Bridge does not own plan state; plan is read-only.',
		};
	}
	return { canEdit: true, canApprove: true, canReject: true };
}
