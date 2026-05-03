// Migration / continuous config hold (slice 15).
//
// Acceptance:
//   * No migration action is partially enabled.
//   * UI explains why migration is held.
//   * No config write path can corrupt current runtime config.
//
// `migrationHoldFor()` returns a single decision. The migration tab must
// surface ALL migration actions as either fully enabled or fully held;
// partial enablement is forbidden by acceptance #1.

export interface MigrationCapabilities {
	readonly persistenceWired: boolean;
	readonly rollbackWired: boolean;
	readonly schemaValidationWired: boolean;
	readonly executorWired: boolean;
}

export interface MigrationHoldDecision {
	readonly held: boolean;
	readonly reason?: string | undefined;
	/** Set true iff every migration action is enabled together. */
	readonly canCreateDraft: boolean;
	readonly canDryRun: boolean;
	readonly canVerifyReversibility: boolean;
	readonly canDispatch: boolean;
	readonly canWriteContinuousConfig: boolean;
}

export function migrationHoldFor(caps: MigrationCapabilities): MigrationHoldDecision {
	const allReady =
		caps.persistenceWired &&
		caps.rollbackWired &&
		caps.schemaValidationWired &&
		caps.executorWired;

	if (!allReady) {
		let reason = 'Migration is held until persistence, rollback, schema validation, and executor are wired.';
		if (!caps.persistenceWired) reason = 'Migration requires persistence; this profile has it disabled.';
		else if (!caps.rollbackWired) reason = 'Migration requires rollback semantics; rollback is not wired.';
		else if (!caps.schemaValidationWired) reason = 'Migration requires config schema validation; not wired.';
		else if (!caps.executorWired) reason = 'Migration executor is not wired.';
		return {
			held: true,
			reason,
			canCreateDraft: false,
			canDryRun: false,
			canVerifyReversibility: false,
			canDispatch: false,
			canWriteContinuousConfig: false,
		};
	}
	return {
		held: false,
		canCreateDraft: true,
		canDryRun: true,
		canVerifyReversibility: true,
		canDispatch: true,
		canWriteContinuousConfig: true,
	};
}
