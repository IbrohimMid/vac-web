// Shell vs ACP-terminal boundary classifier (slice 08).
//
// The bridge emits two distinct families of “terminal-ish” events:
//
//   shell.*    — user-facing local shell sessions controlled from the
//                cockpit's ShellDrawer. The user can type into them.
//   terminal.* — ACP terminal observations attached to a provider/agent
//                runtime. These are read-only activity surfaces; the
//                cockpit must NOT enable a typeable input for them.
//
// Acceptance (slice 08):
//   * ShellDrawer availability follows shell.* implementation status.
//   * Provider terminal observations are labeled provider/runtime activity.
//   * User cannot type into a provider terminal observation as if it were
//     a local shell.
//
// `classifyTerminalEvent()` is the single source of truth for that
// distinction. UI surfaces should call this and key affordances off the
// returned `surface` field.

export type TerminalSurface =
	| 'cockpit_shell' // local shell pane, typeable when bridge is wired
	| 'runtime_activity' // ACP-driven provider observation, read-only
	| 'unknown';

export interface TerminalEventClassification {
	readonly eventType: string;
	readonly surface: TerminalSurface;
	/** True only when this event drives the local-shell pane. */
	readonly drivesShellDrawer: boolean;
	/** True only when this event drives the runtime activity log. */
	readonly drivesActivityLog: boolean;
	/** True only when the surface accepts typed input from the user. */
	readonly typeable: boolean;
	/** Human-readable label for the surface. */
	readonly label: string;
}

const FALLBACK: TerminalEventClassification = Object.freeze({
	eventType: '',
	surface: 'unknown',
	drivesShellDrawer: false,
	drivesActivityLog: false,
	typeable: false,
	label: 'Unknown terminal event',
});

/**
 * Slice 08 routing rules.
 *
 * Note: even when the cockpit-shell event is recognized, `typeable` is
 * still gated by the manifest — if `shell.*` commands are
 * `feature.not_wired`, the ShellDrawer must remain read-only. Callers
 * combine `drivesShellDrawer && manifestKnowsShellWired` to enable input.
 */
export function classifyTerminalEvent(
	eventType: string,
	opts?: { shellWired?: boolean },
): TerminalEventClassification {
	if (typeof eventType !== 'string' || eventType.length === 0) {
		return FALLBACK;
	}
	const shellWired = opts?.shellWired ?? false;

	if (eventType.startsWith('shell.')) {
		return {
			eventType,
			surface: 'cockpit_shell',
			drivesShellDrawer: true,
			drivesActivityLog: false,
			typeable: shellWired,
			label: shellWired ? 'Cockpit shell' : 'Cockpit shell (read-only — not wired)',
		};
	}
	if (eventType.startsWith('terminal.')) {
		return {
			eventType,
			surface: 'runtime_activity',
			drivesShellDrawer: false,
			drivesActivityLog: true,
			typeable: false,
			label: 'Runtime activity',
		};
	}
	return { ...FALLBACK, eventType };
}

/** True iff a terminal observation must remain read-only. */
export function isReadOnlyTerminalSurface(eventType: string): boolean {
	const c = classifyTerminalEvent(eventType, { shellWired: true });
	return c.surface === 'runtime_activity';
}

export { FALLBACK as TERMINAL_EVENT_FALLBACK };
