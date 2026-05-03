// Config reload + validation UX mapping (slice 10).
//
// The bridge surfaces config-validation and config-reload state through
// distinct event_type strings emitted from
// apps/local-bridge/src/translator/mod.rs:
//
//   * config.validate.failed
//   * config.validated
//   * config.reload.started
//   * config.reloaded
//   * config.reload_failed
//
// The cockpit must distinguish three states from the operator's point of
// view: success (validated/reloaded), in-flight (reload.started), and
// failure (validate.failed/reload_failed). The acceptance criterion for
// slice 10 is "User can distinguish validation failure from reload
// failure" — i.e. the UI must keep these as separate buckets, even though
// they share the `config.` prefix.

export type ConfigLifecyclePhase =
	| 'validating'
	| 'validated'
	| 'validate_failed'
	| 'reload_started'
	| 'reloaded'
	| 'reload_failed';

export interface ConfigLifecycleCopy {
	readonly phase: ConfigLifecyclePhase;
	readonly title: string;
	readonly detail: string;
	/** Whether the bridge config is in a usable state after this event. */
	readonly configUsable: boolean;
	/** Whether this transition should be surfaced as a top-level toast. */
	readonly notify: boolean;
	/** Whether the cockpit should refresh capability/registry caches. */
	readonly refreshCaches: boolean;
}

const FALLBACK: ConfigLifecycleCopy = Object.freeze({
	phase: 'validate_failed',
	title: 'Unknown config event',
	detail: 'A config lifecycle event arrived that the cockpit does not recognize.',
	configUsable: true,
	notify: false,
	refreshCaches: false,
});

const CODES: Record<string, ConfigLifecycleCopy> = {
	'config.validate.failed': {
		phase: 'validate_failed',
		title: 'Config validation failed',
		detail: 'The configuration on disk did not pass validation. Live config is unchanged.',
		configUsable: true,
		notify: true,
		refreshCaches: false,
	},
	'config.validated': {
		phase: 'validated',
		title: 'Config validated',
		detail: 'The configuration on disk matches the active runtime snapshot.',
		configUsable: true,
		notify: false,
		refreshCaches: false,
	},
	'config.reload.started': {
		phase: 'reload_started',
		title: 'Reloading config…',
		detail: 'The bridge is re-reading configuration from disk.',
		configUsable: true,
		notify: false,
		refreshCaches: false,
	},
	'config.reloaded': {
		phase: 'reloaded',
		title: 'Config reloaded',
		detail: 'The bridge has installed the new configuration. Capabilities and policy may have changed.',
		configUsable: true,
		notify: true,
		refreshCaches: true,
	},
	'config.reload_failed': {
		phase: 'reload_failed',
		title: 'Config reload failed',
		detail: 'The bridge could not install the new configuration. The previous live config is still in effect.',
		configUsable: true,
		notify: true,
		refreshCaches: false,
	},
};

export function configLifecycleCopyFor(eventType: string): ConfigLifecycleCopy {
	return CODES[eventType] ?? FALLBACK;
}

export function isConfigLifecycleEvent(eventType: string): boolean {
	return typeof eventType === 'string' && eventType in CODES;
}

export const CONFIG_LIFECYCLE_EVENTS: ReadonlyArray<string> = Object.freeze(Object.keys(CODES));

export { FALLBACK as CONFIG_LIFECYCLE_FALLBACK };
