// Frontend declarative affordance helper.
//
// Slice 33 (wiring.frontend_declarative_affordances): centralizes the rules
// for whether a UI control mapped to a command is executable, what disabled
// copy to show, and how the operator-facing reason is derived.
//
// Source of truth: the generated command catalog (apps/web/src/generated/commandCatalog.ts),
// which itself is derived from config/control-plane/command-manifest.yaml.
// Components must NOT spell command status logic inline; route through here
// so disabled/enabled state is consistent across CommandPalette, Topbar,
// ReleaseTab, ConnectorsTab, Gates, Review, RuntimeTab, etc.

import {
	COMMAND_BY_ID,
	commandStatus,
	isKnownCommand,
	isImplemented,
	isNotWired,
	type CommandEntry,
	type CommandId,
	type CommandStatus,
} from '../../generated/commandCatalog';

export interface AffordanceState {
	readonly commandId: string;
	readonly known: boolean;
	readonly status: CommandStatus | undefined;
	readonly enabled: boolean;
	/** True when the catalog explicitly marks the command as not_wired. */
	readonly notWired: boolean;
	/** Human-readable reason. Empty when enabled. */
	readonly disabledReason: string;
	/** Underlying catalog entry, when known. */
	readonly entry?: CommandEntry;
}

const DEFAULT_DISABLED_COPY: Record<CommandStatus, string> = {
	implemented: '',
	not_wired: 'This action is not wired to a backend executor yet.',
	frontend_owned: '',
	protocol_only: 'This event is read-only.',
	internal: 'This action is reserved for internal use.',
	deprecated: 'This action is deprecated and no longer accepted.',
};

/**
 * Resolve the affordance state for a command id.
 *
 * Components should pass this through their disabled/enabled props rather
 * than deriving status locally. Unknown command ids return `known: false`
 * and are treated as disabled with a generic reason — catching stale
 * frontend wiring before a stale wire-level command leaks to the bridge.
 */
export function affordanceFor(commandId: string): AffordanceState {
	const known = isKnownCommand(commandId);
	if (!known) {
		return {
			commandId,
			known: false,
			status: undefined,
			enabled: false,
			notWired: false,
			disabledReason: `Command '${commandId}' is not in the catalog.`,
		};
	}
	const id = commandId as CommandId;
	const entry = COMMAND_BY_ID.get(id)!;
	const status = entry.status;
	const enabled = status === 'implemented' || status === 'frontend_owned';
	const reason = entry.ui?.reason ?? DEFAULT_DISABLED_COPY[status];
	return {
		commandId: id,
		known: true,
		status,
		enabled,
		notWired: status === 'not_wired',
		disabledReason: enabled ? '' : reason,
		entry,
	};
}

/** Convenience: true iff the command can be executed against the backend. */
export function canExecute(commandId: string): boolean {
	return isImplemented(commandId);
}

/** Convenience: returns the catalog status string or undefined. */
export function statusOf(commandId: string): CommandStatus | undefined {
	return commandStatus(commandId);
}

/** Convenience: returns the operator-facing reason a control is disabled. */
export function disabledReasonFor(commandId: string): string {
	return affordanceFor(commandId).disabledReason;
}

/**
 * Type guard helpers re-exported so consumers don't need a second import.
 */
export { isImplemented, isNotWired, isKnownCommand, commandStatus };
export type { CommandId, CommandStatus, CommandEntry };
